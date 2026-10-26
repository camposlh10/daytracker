package com.daytracker.covers;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Looks up cover candidates and downloads cover images from Open Library
 * (openlibrary.org, run by the Internet Archive). Only fixed URLs are built
 * here, from a numeric cover id; redirects are followed by hand and only to
 * Open Library and Internet Archive hosts, so no user input can steer a request
 * elsewhere. The network is used only when the user asks for a cover.
 */
@Component
public class OpenLibraryClient {

	private static final Logger log = LoggerFactory.getLogger(OpenLibraryClient.class);

	public enum Size {

		SMALL("S"), MEDIUM("M"), LARGE("L");

		private final String code;

		Size(String code) {
			this.code = code;
		}

	}

	/** Where a cover image comes from. */
	public enum CoverSource {

		/** An Open Library cover id. */
		OPEN_LIBRARY,

		/**
		 * An ISBN looked up on Google Books, used only when Open Library has no
		 * cover. Google answers unknown ISBNs with some other book's cover, so these
		 * are always shown for the user to confirm, never applied unseen.
		 */
		GOOGLE_BOOKS

	}

	/** One search result that has a cover. */
	public record Candidate(CoverSource source, String sourceId, String title, String author,
			Integer firstPublishYear) {
	}

	/**
	 * A book suggested while a title is typed. {@code totalPages} is the median
	 * page count across the work's editions, so it is only a starting value.
	 * {@code publisher} is set only when one of the work's publishers is a known
	 * technical publisher, such as O'Reilly.
	 */
	public record Suggestion(String title, String author, String publisher, Integer firstPublishYear,
			Integer totalPages, CoverSource coverSource, String coverId) {
	}

	/** Subjects that mark a work as a technical book. */
	private static final String TECH_SUBJECTS = "(subject:programming OR subject:computers OR "
			+ "subject:\"computer science\" OR subject:software OR subject:\"computer networks\" OR "
			+ "subject:\"computer security\" OR subject:databases OR subject:\"data processing\")";

	/** Technical publishers as Open Library spells them in part, and the name to show. */
	private static final List<String[]> TECH_PUBLISHERS = List.of(new String[] { "o'reilly", "O'Reilly" },
			new String[] { "oreilly", "O'Reilly" }, new String[] { "manning", "Manning" },
			new String[] { "packt", "Packt" }, new String[] { "pragmatic", "Pragmatic Bookshelf" },
			new String[] { "no starch", "No Starch Press" }, new String[] { "addison", "Addison-Wesley" },
			new String[] { "apress", "Apress" }, new String[] { "microsoft press", "Microsoft Press" },
			new String[] { "prentice hall", "Prentice Hall" }, new String[] { "mit press", "MIT Press" },
			new String[] { "wiley", "Wiley" }, new String[] { "sitepoint", "SitePoint" });

	/** The cover service could not be reached or answered unusably. */
	public static class UnavailableException extends RuntimeException {

		public UnavailableException(String message, Throwable cause) {
			super(message, cause);
		}

	}

	private static final int MAX_REDIRECTS = 4;

	private static final int MAX_CANDIDATES = 12;

	private static final String USER_AGENT = "DayTracker/0.1 (personal desktop reading tracker)";

	private final HttpClient http = HttpClient.newBuilder()
		.connectTimeout(Duration.ofSeconds(5))
		.followRedirects(HttpClient.Redirect.NEVER)
		.build();

	private final ObjectMapper json;

	private final URI searchBase;

	private final URI coversBase;

	private final URI googleBooksBase;

	private final Set<String> allowedHosts;

	public OpenLibraryClient(ObjectMapper json,
			@Value("${daytracker.covers.search-base-url:https://openlibrary.org}") String searchBase,
			@Value("${daytracker.covers.image-base-url:https://covers.openlibrary.org}") String coversBase,
			@Value("${daytracker.covers.google-books-base-url:https://books.google.com}") String googleBooksBase) {
		this.json = json;
		this.searchBase = URI.create(searchBase);
		this.coversBase = URI.create(coversBase);
		this.googleBooksBase = URI.create(googleBooksBase);
		this.allowedHosts = Set.copyOf(
				List.of(this.searchBase.getHost(), this.coversBase.getHost(), this.googleBooksBase.getHost()));
	}

	/** Works matching the title and author that have a cover, best matches first. */
	public List<Candidate> search(String title, String author) {
		StringBuilder query = new StringBuilder("/search.json?fields=key,title,author_name,first_publish_year,cover_i,isbn")
			.append("&limit=").append(MAX_CANDIDATES * 2)
			.append("&title=").append(encode(title));
		if (author != null && !author.isBlank()) {
			query.append("&author=").append(encode(author));
		}
		byte[] body = get(searchBase.resolve(query.toString()), 512 * 1024, "application/json");
		List<Candidate> candidates = new ArrayList<>();
		try {
			for (JsonNode doc : json.readTree(body).path("docs")) {
				String coverId = openLibraryCoverId(doc);
				String isbn = coverId == null ? isbn(doc) : null;
				if (coverId == null && isbn == null) {
					continue;
				}
				JsonNode authors = doc.path("author_name");
				candidates.add(new Candidate(coverId != null ? CoverSource.OPEN_LIBRARY : CoverSource.GOOGLE_BOOKS,
						coverId != null ? coverId : isbn, doc.path("title").asString(""),
						authors.isArray() && !authors.isEmpty() ? authors.get(0).asString("") : null,
						doc.path("first_publish_year").isIntegralNumber() ? doc.path("first_publish_year").asInt()
								: null));
				if (candidates.size() == MAX_CANDIDATES) {
					break;
				}
			}
		}
		catch (RuntimeException ex) {
			throw new UnavailableException("Open Library returned an unreadable search result.", ex);
		}
		return candidates;
	}

	/**
	 * Works whose title or author matches what was typed, best matches first;
	 * with {@code techOnly}, only works filed under computing subjects.
	 */
	public List<Suggestion> suggest(String query, int limit, boolean techOnly) {
		// The text is used as plain words, never as search syntax.
		String words = query.replaceAll("[\\p{Punct}&&[^'.]]", " ").replaceAll("\\s+", " ").strip();
		String q = techOnly ? words + " " + TECH_SUBJECTS : words;
		String path = "/search.json?fields=title,author_name,publisher,first_publish_year,number_of_pages_median,cover_i,isbn"
				+ "&limit=" + limit + "&q=" + encode(q);
		byte[] body = get(searchBase.resolve(path), 512 * 1024, "application/json");
		List<Suggestion> suggestions = new ArrayList<>();
		try {
			for (JsonNode doc : json.readTree(body).path("docs")) {
				String title = doc.path("title").asString("");
				if (title.isBlank()) {
					continue;
				}
				JsonNode authors = doc.path("author_name");
				JsonNode pages = doc.path("number_of_pages_median");
				String coverId = openLibraryCoverId(doc);
				String isbn = coverId == null ? isbn(doc) : null;
				suggestions.add(new Suggestion(title, authors.isArray() && !authors.isEmpty() ? authors.get(0).asString("") : null,
						techPublisher(doc.path("publisher")),
						doc.path("first_publish_year").isIntegralNumber() ? doc.path("first_publish_year").asInt() : null,
						pages.isIntegralNumber() && pages.asInt() > 0 ? pages.asInt() : null,
						coverId != null ? CoverSource.OPEN_LIBRARY : isbn != null ? CoverSource.GOOGLE_BOOKS : null,
						coverId != null ? coverId : isbn));
			}
		}
		catch (RuntimeException ex) {
			throw new UnavailableException("Open Library returned an unreadable search result.", ex);
		}
		return suggestions;
	}

	private static String openLibraryCoverId(JsonNode doc) {
		JsonNode cover = doc.path("cover_i");
		return cover.isIntegralNumber() && cover.asLong() > 0 ? String.valueOf(cover.asLong()) : null;
	}

	/** An ISBN-13 of the work if it has one, else an ISBN-10. */
	private static String isbn(JsonNode doc) {
		String fallback = null;
		for (JsonNode value : doc.path("isbn")) {
			String isbn = value.asString("");
			if (isbn.matches("97[89]\\d{10}")) {
				return isbn;
			}
			if (fallback == null && isbn.matches("\\d{9}[\\dX]")) {
				fallback = isbn;
			}
		}
		return fallback;
	}

	private static String techPublisher(JsonNode publishers) {
		if (!publishers.isArray()) {
			return null;
		}
		for (String[] known : TECH_PUBLISHERS) {
			for (JsonNode publisher : publishers) {
				if (publisher.asString("").toLowerCase(Locale.ROOT).contains(known[0])) {
					return known[1];
				}
			}
		}
		return null;
	}

	/** The cover image with this Open Library cover id. */
	public CoverImage image(String coverId, Size size) {
		if (!coverId.matches("\\d{1,12}")) {
			throw new IllegalArgumentException("Cover ids are numeric.");
		}
		// default=false makes a missing cover a 404 instead of a blank placeholder image.
		byte[] data = get(coversBase.resolve("/b/id/" + coverId + "-" + size.code + ".jpg?default=false"),
				CoverImage.MAX_BYTES, "image/*");
		return CoverImage.of(data, "sourceId");
	}

	/**
	 * The front cover Google Books shows for an ISBN, in the one size that is a
	 * real cover. Its "image not available" placeholders are PNG files, so only a
	 * JPEG is accepted.
	 */
	public CoverImage googleBooksImage(String isbn) {
		if (!isbn.matches("\\d{9}[\\dX]|\\d{13}")) {
			throw new IllegalArgumentException("Not an ISBN.");
		}
		byte[] data = get(googleBooksBase.resolve("/books/content?vid=ISBN" + isbn + "&printsec=frontcover&img=1&zoom=1"),
				CoverImage.MAX_BYTES, "image/jpeg");
		CoverImage image = CoverImage.of(data, "sourceId");
		if (!"image/jpeg".equals(image.contentType())) {
			throw new NotFoundException();
		}
		return image;
	}

	private byte[] get(URI uri, int maxBytes, String accept) {
		URI current = uri;
		for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
			requireAllowed(current);
			HttpRequest request = HttpRequest.newBuilder(current)
				.timeout(Duration.ofSeconds(15))
				.header("User-Agent", USER_AGENT)
				.header("Accept", accept)
				.GET()
				.build();
			HttpResponse<InputStream> response;
			try {
				response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
			}
			catch (IOException ex) {
				throw new UnavailableException("Open Library could not be reached.", ex);
			}
			catch (InterruptedException ex) {
				Thread.currentThread().interrupt();
				throw new UnavailableException("The request to Open Library was interrupted.", ex);
			}
			int status = response.statusCode();
			if (status >= 300 && status < 400) {
				closeQuietly(response.body());
				String location = response.headers().firstValue("Location").orElse(null);
				if (location == null) {
					throw new UnavailableException("Open Library sent a redirect without a target.", null);
				}
				current = current.resolve(location);
				continue;
			}
			try (InputStream body = response.body()) {
				if (status == 404) {
					throw new NotFoundException();
				}
				if (status != 200) {
					throw new UnavailableException("Open Library answered with status " + status + ".", null);
				}
				byte[] data = body.readNBytes(maxBytes + 1);
				if (data.length > maxBytes) {
					throw new UnavailableException("The response from Open Library was too large.", null);
				}
				return data;
			}
			catch (IOException ex) {
				throw new UnavailableException("The response from Open Library was interrupted.", ex);
			}
		}
		throw new UnavailableException("Open Library redirected too many times.", null);
	}

	/** Thrown when Open Library has no image for a cover id. */
	public static class NotFoundException extends RuntimeException {

		NotFoundException() {
			super("Open Library has no image for this cover.");
		}

	}

	private void requireAllowed(URI uri) {
		String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
		boolean archive = host.equals("archive.org") || host.endsWith(".archive.org")
				|| host.endsWith(".googleusercontent.com");
		boolean configured = allowedHosts.contains(host);
		boolean loopback = host.equals("127.0.0.1") || host.equals("localhost");
		// Plain http only for a loopback test server.
		boolean schemeOk = "https".equals(uri.getScheme()) || ("http".equals(uri.getScheme()) && loopback);
		if (!(archive || configured) || !schemeOk) {
			log.warn("Refused a cover request to an unexpected location: {}://{}", uri.getScheme(), host);
			throw new UnavailableException("Open Library redirected to an unexpected location.", null);
		}
	}

	private static String encode(String value) {
		return URLEncoder.encode(value, StandardCharsets.UTF_8);
	}

	private static void closeQuietly(InputStream stream) {
		try {
			stream.close();
		}
		catch (IOException ex) {
			// Nothing to do: the body of a redirect is not needed.
		}
	}

}
