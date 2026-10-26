package com.daytracker.covers;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.util.UUID;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.util.FileSystemUtils;

/** Covers over HTTP, against a local stand-in for Open Library. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "daytracker.data-dir=" + CoverApiTest.DATA_DIR, "daytracker.launch-token=" + CoverApiTest.TOKEN })
class CoverApiTest {

	static final String DATA_DIR = "target/test-data/cover-api";

	static final String TOKEN = "test-launch-token-0123456789abcdef0123456789";

	private static final FakeOpenLibrary FAKE;

	// An isolated database for this class; never the user's application data.
	static {
		try {
			FileSystemUtils.deleteRecursively(Path.of(DATA_DIR));
			FAKE = new FakeOpenLibrary();
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

	@DynamicPropertySource
	static void openLibrary(DynamicPropertyRegistry registry) {
		registry.add("daytracker.covers.search-base-url", FAKE::baseUrl);
		registry.add("daytracker.covers.image-base-url", FAKE::baseUrl);
		registry.add("daytracker.covers.google-books-base-url", FAKE::baseUrl);
	}

	@AfterAll
	static void stopFake() {
		FAKE.close();
	}

	private final HttpClient http = HttpClient.newHttpClient();

	@Value("${local.server.port}")
	int port;

	private HttpRequest.Builder request(String path) {
		return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
			.header("Authorization", "Bearer " + TOKEN);
	}

	private HttpResponse<String> text(HttpRequest.Builder request) throws Exception {
		return http.send(request.build(), HttpResponse.BodyHandlers.ofString());
	}

	private UUID createBook(String title) throws Exception {
		UUID id = UUID.randomUUID();
		HttpResponse<String> created = text(request("/api/v1/books").header("Content-Type", "application/json")
			.POST(HttpRequest.BodyPublishers.ofString(
					"{\"id\":\"" + id + "\",\"title\":\"" + title + "\",\"author\":\"Frank Herbert\",\"totalPages\":612}")));
		assertThat(created.statusCode()).isEqualTo(201);
		assertThat(created.body()).contains("\"coverUpdatedAt\":null");
		return id;
	}

	@Test
	void searchChooseServeAndRemoveACover() throws Exception {
		UUID id = createBook("Dune");

		HttpResponse<String> candidates = text(request("/api/v1/books/" + id + "/cover-candidates").GET());
		assertThat(candidates.statusCode()).isEqualTo(200);
		assertThat(candidates.body()).isEqualTo("[{\"source\":\"OPEN_LIBRARY\",\"sourceId\":\"111\",\"title\":\"Dune\","
				+ "\"author\":\"Frank Herbert\",\"firstPublishYear\":1965},{\"source\":\"OPEN_LIBRARY\",\"sourceId\":\"222\","
				+ "\"title\":\"Dune Messiah\",\"author\":null,\"firstPublishYear\":null}]");

		HttpResponse<byte[]> preview = http.send(request("/api/v1/cover-candidates/open-library/111/image").GET().build(),
				HttpResponse.BodyHandlers.ofByteArray());
		assertThat(preview.statusCode()).isEqualTo(200);
		assertThat(preview.headers().firstValue("Content-Type")).contains("image/jpeg");
		assertThat(preview.body()).isEqualTo(FakeOpenLibrary.JPEG);

		HttpResponse<String> chosen = text(request("/api/v1/books/" + id + "/cover")
			.header("Content-Type", "application/json")
			.PUT(HttpRequest.BodyPublishers.ofString("{\"sourceId\":\"111\"}")));
		assertThat(chosen.statusCode()).isEqualTo(200);
		assertThat(chosen.body()).containsPattern("\"coverUpdatedAt\":\"\\d{4}-");

		HttpResponse<byte[]> cover = http.send(request("/api/v1/books/" + id + "/cover").GET().build(),
				HttpResponse.BodyHandlers.ofByteArray());
		assertThat(cover.statusCode()).isEqualTo(200);
		assertThat(cover.headers().firstValue("Content-Type")).contains("image/jpeg");
		assertThat(cover.headers().firstValue("X-Content-Type-Options")).contains("nosniff");
		assertThat(cover.body()).isEqualTo(FakeOpenLibrary.JPEG);

		assertThat(text(request("/api/v1/books/" + id + "/cover").DELETE()).statusCode()).isEqualTo(204);
		assertThat(text(request("/api/v1/books/" + id + "/cover").GET()).statusCode()).isEqualTo(404);
		assertThat(text(request("/api/v1/books/" + id).GET()).body()).contains("\"coverUpdatedAt\":null");
	}

	@Test
	void aGoogleBooksCoverCanBePreviewedAndChosen() throws Exception {
		UUID id = createBook("Real-World Software Development");

		assertThat(text(request("/api/v1/books/" + id + "/cover-candidates").GET()).body())
			.isEqualTo("[{\"source\":\"GOOGLE_BOOKS\",\"sourceId\":\"9781491967171\","
					+ "\"title\":\"Real-World Software Development\",\"author\":\"Raoul-Gabriel Urma\","
					+ "\"firstPublishYear\":null}]");
		HttpResponse<byte[]> preview = http.send(
				request("/api/v1/cover-candidates/google-books/9781491967171/image").GET().build(),
				HttpResponse.BodyHandlers.ofByteArray());
		assertThat(preview.statusCode()).isEqualTo(200);
		assertThat(preview.body()).isEqualTo(FakeOpenLibrary.JPEG);
		assertThat(text(request("/api/v1/cover-candidates/google-books/9780000000002/image").GET()).statusCode())
			.isEqualTo(404);

		HttpResponse<String> chosen = text(request("/api/v1/books/" + id + "/cover")
			.header("Content-Type", "application/json")
			.PUT(HttpRequest.BodyPublishers.ofString("{\"source\":\"GOOGLE_BOOKS\",\"sourceId\":\"9781491967171\"}")));
		assertThat(chosen.statusCode()).isEqualTo(200);
		assertThat(chosen.body()).containsPattern("\"coverUpdatedAt\":\"\\d{4}-");
		assertThat(text(request("/api/v1/books/" + id + "/cover").header("Content-Type", "application/json")
			.PUT(HttpRequest.BodyPublishers.ofString("{\"source\":\"AMAZON\",\"sourceId\":\"1\"}"))).statusCode())
			.isEqualTo(400);
	}

	@Test
	void anImageFileCanBeUploaded() throws Exception {
		UUID id = createBook("Upload");

		HttpResponse<String> uploaded = text(request("/api/v1/books/" + id + "/cover/file")
			.header("Content-Type", "application/octet-stream")
			.PUT(HttpRequest.BodyPublishers.ofByteArray(FakeOpenLibrary.PNG)));
		assertThat(uploaded.statusCode()).isEqualTo(200);
		assertThat(uploaded.body()).containsPattern("\"coverUpdatedAt\":\"\\d{4}-");

		HttpResponse<String> notImage = text(request("/api/v1/books/" + id + "/cover/file")
			.header("Content-Type", "application/octet-stream")
			.PUT(HttpRequest.BodyPublishers.ofString("plain text")));
		assertThat(notImage.statusCode()).isEqualTo(400);
		assertThat(notImage.body()).contains("JPEG, PNG, or WebP");
	}

	@Test
	void suggestsBooksWhileATitleIsTyped() throws Exception {
		HttpResponse<String> found = text(request("/api/v1/book-suggestions?q=project%20hail").GET());
		assertThat(found.statusCode()).isEqualTo(200);
		assertThat(found.body()).startsWith("[{\"title\":\"Project Hail Mary\",\"author\":\"Andy Weir\","
				+ "\"publisher\":null,\"firstPublishYear\":2021,\"totalPages\":496,\"coverSource\":\"OPEN_LIBRARY\","
				+ "\"coverId\":\"111\"}");
		assertThat(text(request("/api/v1/book-suggestions?q=learning%20go&tech=true").GET()).body())
			.startsWith("[{\"title\":\"Learning Go\",\"author\":\"Jon Bodner\",\"publisher\":\"O'Reilly\",");

		assertThat(text(request("/api/v1/book-suggestions?q=du").GET()).statusCode()).isEqualTo(400);
		assertThat(text(request("/api/v1/book-suggestions").GET()).statusCode()).isEqualTo(400);
		HttpResponse<String> broken = text(request("/api/v1/book-suggestions?q=broken").GET());
		assertThat(broken.statusCode()).isEqualTo(502);
		assertThat(broken.body()).contains("\"code\":\"COVER_SOURCE_UNAVAILABLE\"");
	}

	@Test
	void failuresHaveClearStatuses() throws Exception {
		UUID id = createBook("Dune");

		HttpResponse<String> serverError = text(request("/api/v1/books/" + id + "/cover")
			.header("Content-Type", "application/json")
			.PUT(HttpRequest.BodyPublishers.ofString("{\"sourceId\":\"666\"}")));
		assertThat(serverError.statusCode()).isEqualTo(502);
		assertThat(serverError.body()).contains("\"code\":\"COVER_SOURCE_UNAVAILABLE\"");

		assertThat(text(request("/api/v1/books/" + id + "/cover").header("Content-Type", "application/json")
			.PUT(HttpRequest.BodyPublishers.ofString("{\"sourceId\":\"abc\"}"))).statusCode()).isEqualTo(400);
		assertThat(text(request("/api/v1/books/" + UUID.randomUUID() + "/cover-candidates").GET()).statusCode())
			.isEqualTo(404);
		assertThat(text(request("/api/v1/cover-candidates/open-library/777/image").GET()).statusCode()).isEqualTo(404);
		assertThat(http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/books/" + id + "/cover"))
			.GET()
			.build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(401);
	}

}
