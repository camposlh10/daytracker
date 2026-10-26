package com.daytracker.covers;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * A local stand-in for Open Library, so tests never use the network.
 * Cover ids: 111 large JPEG behind a redirect, 222 only a medium PNG, 333 not an
 * image, 444 redirects off-site, 555 too large, 666 a server error.
 */
final class FakeOpenLibrary implements AutoCloseable {

	static final byte[] JPEG = { (byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 1, 2, 3, 4 };

	static final byte[] PNG = { (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 9, 9 };

	private final HttpServer server;

	/** How many search requests arrived, to check caching. */
	final java.util.concurrent.atomic.AtomicInteger searches = new java.util.concurrent.atomic.AtomicInteger();

	FakeOpenLibrary() throws IOException {
		server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		server.createContext("/", this::handle);
		server.start();
	}

	String baseUrl() {
		return "http://127.0.0.1:" + server.getAddress().getPort();
	}

	private void handle(HttpExchange exchange) throws IOException {
		String path = exchange.getRequestURI().getPath();
		if (path.equals("/search.json")) {
			searches.incrementAndGet();
		}
		String query = exchange.getRequestURI().getRawQuery();
		switch (path) {
			case "/search.json" -> {
				String decoded = query == null ? "" : java.net.URLDecoder.decode(query, StandardCharsets.UTF_8);
				if (decoded.contains("q=real world software (subject:programming")
						|| decoded.contains("title=Real-World Software Development")) {
					send(exchange, 200, "application/json", """
							{"docs":[{"title":"Real-World Software Development","author_name":["Raoul-Gabriel Urma"],
							  "publisher":["O'Reilly Media"],"isbn":["149196717X","9781491967171"]}]}"""
						.getBytes(StandardCharsets.UTF_8));
					return;
				}
				if (decoded.contains("q=learning go (subject:programming")) {
					send(exchange, 200, "application/json", """
							{"docs":[
							  {"title":"Learning Go","author_name":["Jon Bodner"],"publisher":["Shroff","O'Reilly Media"],
							   "first_publish_year":2021,"number_of_pages_median":374,"cover_i":111},
							  {"title":"Learning Go programming","author_name":["Vladimir Vivien"],
							   "publisher":["Packt Publishing - ebooks Account"]}
							]}""".getBytes(StandardCharsets.UTF_8));
					return;
				}
				if (decoded.contains("q=learning go")) {
					send(exchange, 200, "application/json", """
							{"docs":[{"title":"Never Let Me Go","author_name":["Kazuo Ishiguro"],"publisher":["Knopf"]}]}"""
						.getBytes(StandardCharsets.UTF_8));
					return;
				}
				if (decoded.endsWith("q=C programming tips")) {
					send(exchange, 200, "application/json",
							"{\"docs\":[{\"title\":\"C Programming Tips\"}]}".getBytes(StandardCharsets.UTF_8));
					return;
				}
				if (query != null && query.toLowerCase(java.util.Locale.ROOT).contains("q=project+hail")) {
					send(exchange, 200, "application/json", """
							{"docs":[
							  {"title":"Project Hail Mary","author_name":["Andy Weir"],"first_publish_year":2021,
							   "number_of_pages_median":496,"cover_i":111},
							  {"title":"Summary of Project Hail Mary","author_name":["Someone"]},
							  {"title":"","author_name":["Nobody"]}
							]}""".getBytes(StandardCharsets.UTF_8));
					return;
				}
				if (query != null && query.contains("q=broken")) {
					send(exchange, 200, "application/json", "not json".getBytes(StandardCharsets.UTF_8));
					return;
				}
				boolean dune = query != null && query.contains("title=Dune");
				String body = dune ? """
						{"docs":[
						  {"key":"/works/1","title":"Dune","author_name":["Frank Herbert"],"first_publish_year":1965,"cover_i":111},
						  {"key":"/works/2","title":"Dune (no cover)","author_name":["Frank Herbert"]},
						  {"key":"/works/3","title":"Dune Messiah","cover_i":222}
						]}""" : "{\"docs\":[]}";
				send(exchange, 200, "application/json", body.getBytes(StandardCharsets.UTF_8));
			}
			case "/b/id/111-L.jpg" -> redirect(exchange, "/stored/111-L.jpg");
			case "/stored/111-L.jpg", "/b/id/111-M.jpg" -> send(exchange, 200, "image/jpeg", JPEG);
			case "/b/id/222-M.jpg" -> send(exchange, 200, "image/png", PNG);
			case "/b/id/333-L.jpg" -> send(exchange, 200, "image/jpeg", "<html>nope</html>".getBytes(StandardCharsets.UTF_8));
			case "/b/id/444-L.jpg" -> redirect(exchange, "https://example.com/elsewhere.jpg");
			case "/b/id/555-L.jpg" -> {
				byte[] huge = Arrays.copyOf(JPEG, CoverImage.MAX_BYTES + 10);
				send(exchange, 200, "image/jpeg", huge);
			}
			case "/b/id/666-L.jpg" -> send(exchange, 500, "text/plain", "boom".getBytes(StandardCharsets.UTF_8));
			case "/books/content" -> {
				if (query != null && query.contains("vid=ISBN9781491967171") && query.contains("zoom=1")) {
					send(exchange, 200, "image/jpeg", JPEG);
				}
				else {
					send(exchange, 200, "image/png", PNG);
				}
			}
			default -> send(exchange, 404, "text/plain", "missing".getBytes(StandardCharsets.UTF_8));
		}
	}

	private static void redirect(HttpExchange exchange, String location) throws IOException {
		exchange.getResponseHeaders().add("Location", location);
		exchange.sendResponseHeaders(302, -1);
		exchange.close();
	}

	private static void send(HttpExchange exchange, int status, String type, byte[] body) throws IOException {
		exchange.getResponseHeaders().add("Content-Type", type);
		exchange.sendResponseHeaders(status, body.length);
		try (OutputStream out = exchange.getResponseBody()) {
			out.write(body);
		}
	}

	@Override
	public void close() {
		server.stop(0);
	}

}
