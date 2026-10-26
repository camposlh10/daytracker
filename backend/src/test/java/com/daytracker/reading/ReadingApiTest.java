package com.daytracker.reading;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.util.FileSystemUtils;

/** Books, reading sessions, and goals over HTTP: JSON shapes, status codes, and partial updates. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "daytracker.data-dir=" + ReadingApiTest.DATA_DIR,
				"daytracker.launch-token=" + ReadingApiTest.TOKEN })
class ReadingApiTest {

	static final String DATA_DIR = "target/test-data/reading-api";

	static final String TOKEN = "test-launch-token-0123456789abcdef0123456789";

	// An isolated database for this class; never the user's application data.
	static {
		try {
			FileSystemUtils.deleteRecursively(Path.of(DATA_DIR));
		}
		catch (IOException ex) {
			throw new IllegalStateException(ex);
		}
	}

	private final HttpClient http = HttpClient.newHttpClient();

	@Value("${local.server.port}")
	int port;

	private HttpResponse<String> send(String method, String path, String json) throws Exception {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
			.header("Authorization", "Bearer " + TOKEN);
		if (json != null) {
			request.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(json));
		}
		else {
			request.method(method, HttpRequest.BodyPublishers.noBody());
		}
		return http.send(request.build(), HttpResponse.BodyHandlers.ofString());
	}

	private UUID createBook(String title, int totalPages) throws Exception {
		UUID id = UUID.randomUUID();
		HttpResponse<String> response = send("POST", "/api/v1/books", "{\"id\":\"" + id + "\",\"title\":\"" + title
				+ "\",\"author\":\"A. Writer\",\"totalPages\":" + totalPages + ",\"status\":\"READING\"}");
		assertThat(response.statusCode()).isEqualTo(201);
		return id;
	}

	private static String session(UUID id, UUID bookId, String date, int pages, String endingPage) {
		return "{\"id\":\"" + id + "\",\"bookId\":\"" + bookId + "\",\"activityDate\":\"" + date + "\",\"pagesRead\":"
				+ pages + ",\"endingPage\":" + endingPage + "}";
	}

	@Test
	void bookLifecycle() throws Exception {
		UUID id = UUID.randomUUID();
		String create = "{\"id\":\"" + id + "\",\"title\":\"Middlemarch\",\"author\":\"George Eliot\","
				+ "\"totalPages\":880,\"initialPage\":40}";

		HttpResponse<String> created = send("POST", "/api/v1/books", create);
		assertThat(created.statusCode()).isEqualTo(201);
		assertThat(created.body()).contains("\"title\":\"Middlemarch\"")
			.contains("\"author\":\"George Eliot\"")
			.contains("\"totalPages\":880")
			.contains("\"initialPage\":40")
			.contains("\"status\":\"TO_READ\"")
			.contains("\"currentPage\":40")
			.contains("\"pagesReadTotal\":0")
			.contains("\"archivedAt\":null")
			.contains("\"version\":1");
		assertThat(send("POST", "/api/v1/books", create).statusCode()).isEqualTo(200);

		HttpResponse<String> finished = send("PATCH", "/api/v1/books/" + id, "{\"version\":1,\"status\":\"FINISHED\"}");
		assertThat(finished.statusCode()).isEqualTo(200);
		assertThat(finished.body()).contains("\"status\":\"FINISHED\"").contains("\"version\":2");
		assertThat(send("PATCH", "/api/v1/books/" + id, "{\"version\":1,\"title\":\"Stale\"}").statusCode())
			.isEqualTo(409);
		assertThat(send("GET", "/api/v1/books/" + id, null).body()).isEqualTo(finished.body());
		assertThat(send("GET", "/api/v1/books", null).body()).contains(id.toString());

		assertThat(send("PATCH", "/api/v1/books/" + id, "{\"version\":2,\"archived\":true}").statusCode())
			.isEqualTo(200);
		assertThat(send("GET", "/api/v1/books", null).body()).doesNotContain(id.toString());
		assertThat(send("GET", "/api/v1/books?archived=true", null).body()).contains(id.toString());

		assertThat(send("POST", "/api/v1/books",
				"{\"id\":\"" + UUID.randomUUID() + "\",\"title\":\"No pages\",\"totalPages\":0}")
			.statusCode()).isEqualTo(400);
		assertThat(send("POST", "/api/v1/books", "{\"id\":\"" + UUID.randomUUID() + "\",\"title\":\"Missing total\"}")
			.statusCode()).isEqualTo(400);
		assertThat(send("PATCH", "/api/v1/books/" + id, "{\"version\":3,\"status\":\"LOST\"}").statusCode())
			.isEqualTo(400);
		assertThat(send("GET", "/api/v1/books/" + UUID.randomUUID(), null).statusCode()).isEqualTo(404);
	}

	@Test
	void sessionLifecycleUpdatesTheBookTheDayAndTheCalendar() throws Exception {
		UUID bookId = createBook("Session book", 300);
		UUID sessionId = UUID.randomUUID();
		String path = "/api/v1/reading-sessions/" + sessionId;

		HttpResponse<String> created = send("POST", "/api/v1/reading-sessions",
				session(sessionId, bookId, "2020-03-10", 25, "25"));
		assertThat(created.statusCode()).isEqualTo(201);
		assertThat(created.body()).contains("\"bookTitle\":\"Session book\"")
			.contains("\"activityDate\":\"2020-03-10\"")
			.contains("\"pagesRead\":25")
			.contains("\"endingPage\":25")
			.contains("\"notes\":null")
			.contains("\"version\":1");
		assertThat(send("POST", "/api/v1/reading-sessions", session(sessionId, bookId, "2020-03-10", 25, "25"))
			.statusCode()).isEqualTo(200);

		assertThat(send("GET", "/api/v1/books/" + bookId, null).body()).contains("\"currentPage\":25")
			.contains("\"pagesReadTotal\":25");
		String day = send("GET", "/api/v1/days/2020-03-10", null).body();
		assertThat(day).contains("\"readingSessions\":[{\"id\":\"" + sessionId + "\"")
			.contains("\"pagesRead\":25,\"readingGoal\":{\"targetPages\":");
		assertThat(send("GET", "/api/v1/calendar?from=2020-03-01&to=2020-04-01", null).body())
			.contains("{\"type\":\"READING\",\"id\":\"reading-2020-03-10-" + bookId + "\",\"date\":\"2020-03-10\","
					+ "\"title\":\"Session book\",\"status\":null,\"priority\":null,\"pagesRead\":25"
					+ ",\"allDay\":null,\"startsAt\":null,\"endsAt\":null,\"continued\":null,\"overlapsAnother\":null,"
					+ "\"bookId\":\"" + bookId + "\",\"coverUpdatedAt\":null}");

		// An omitted ending page is kept; an explicit null removes it.
		HttpResponse<String> morePages = send("PATCH", path, "{\"version\":1,\"pagesRead\":40,\"notes\":\"Recount\"}");
		assertThat(morePages.statusCode()).isEqualTo(200);
		assertThat(morePages.body()).contains("\"pagesRead\":40")
			.contains("\"endingPage\":25")
			.contains("\"notes\":\"Recount\"")
			.contains("\"version\":2");
		assertThat(send("PATCH", path, "{\"version\":2,\"endingPage\":null}").body()).contains("\"endingPage\":null");
		assertThat(send("GET", "/api/v1/books/" + bookId, null).body()).contains("\"currentPage\":0")
			.contains("\"pagesReadTotal\":40");
		assertThat(send("PATCH", path, "{\"version\":1,\"pagesRead\":41}").statusCode()).isEqualTo(409);

		String list = send("GET", "/api/v1/reading-sessions?bookId=" + bookId, null).body();
		assertThat(list).contains(sessionId.toString()).contains("\"total\":1");
		assertThat(send("GET", "/api/v1/reading-sessions?bookId=" + bookId + "&from=2020-03-11", null).body())
			.contains("\"total\":0");

		assertThat(send("DELETE", path, null).statusCode()).isEqualTo(400);
		assertThat(send("DELETE", path + "?version=1", null).statusCode()).isEqualTo(409);
		assertThat(send("DELETE", path + "?version=3", null).statusCode()).isEqualTo(204);
		assertThat(send("DELETE", path + "?version=3", null).statusCode()).isEqualTo(204);
		assertThat(send("GET", "/api/v1/books/" + bookId, null).body()).contains("\"pagesReadTotal\":0");
		assertThat(send("GET", "/api/v1/days/2020-03-10", null).body()).contains("\"readingSessions\":[]");
		assertThat(send("PATCH", path, "{\"version\":4,\"pagesRead\":1}").statusCode()).isEqualTo(404);
	}

	@Test
	void sessionsAreValidatedOverHttp() throws Exception {
		UUID bookId = createBook("Validation book", 100);
		String tomorrow = LocalDate.now().plusDays(2).toString();

		HttpResponse<String> future = send("POST", "/api/v1/reading-sessions",
				session(UUID.randomUUID(), bookId, tomorrow, 5, "null"));
		assertThat(future.statusCode()).isEqualTo(400);
		assertThat(future.body()).contains("\"field\":\"activityDate\"");
		assertThat(send("POST", "/api/v1/reading-sessions", session(UUID.randomUUID(), bookId, "2020-01-01", 0, "null"))
			.statusCode()).isEqualTo(400);
		HttpResponse<String> pastEnd = send("POST", "/api/v1/reading-sessions",
				session(UUID.randomUUID(), bookId, "2020-01-01", 5, "101"));
		assertThat(pastEnd.statusCode()).isEqualTo(400);
		assertThat(pastEnd.body()).contains("\"field\":\"endingPage\"");
		assertThat(send("POST", "/api/v1/reading-sessions",
				session(UUID.randomUUID(), UUID.randomUUID(), "2020-01-01", 5, "null"))
			.statusCode()).isEqualTo(400);
		assertThat(send("POST", "/api/v1/reading-sessions", "{\"id\":\"" + UUID.randomUUID() + "\"}").statusCode())
			.isEqualTo(400);
		assertThat(send("GET", "/api/v1/books/" + bookId, null).body()).contains("\"pagesReadTotal\":0");
	}

	@Test
	void goalsAreStoredByEffectiveDate() throws Exception {
		HttpResponse<String> set = send("PUT", "/api/v1/reading-goals/2019-06-01", "{\"targetPages\":45}");
		assertThat(set.statusCode()).isEqualTo(200);
		assertThat(set.body()).startsWith("{\"effectiveDate\":\"2019-06-01\",\"targetPages\":45,\"updatedAt\":\"");
		assertThat(send("PUT", "/api/v1/reading-goals/2019-06-01", "{\"targetPages\":50}").statusCode())
			.isEqualTo(200);

		assertThat(send("GET", "/api/v1/reading-goals", null).body())
			.contains("{\"effectiveDate\":\"2019-06-01\",\"targetPages\":50,");
		assertThat(send("GET", "/api/v1/days/2019-05-31", null).body())
			.contains("\"readingGoal\":{\"targetPages\":30,\"effectiveDate\":null}");
		assertThat(send("GET", "/api/v1/days/2019-06-01", null).body())
			.contains("\"readingGoal\":{\"targetPages\":50,\"effectiveDate\":\"2019-06-01\"}");
		assertThat(send("GET", "/api/v1/progress?from=2019-05-31&to=2019-06-02", null).body())
			.contains("{\"date\":\"2019-05-31\",\"tasksCompleted\":0,\"pagesRead\":0,\"targetPages\":30,\"targetPercent\":0,\"future\":false}")
			.contains("{\"date\":\"2019-06-01\",\"tasksCompleted\":0,\"pagesRead\":0,\"targetPages\":50,\"targetPercent\":0,\"future\":false}");

		assertThat(send("PUT", "/api/v1/reading-goals/2019-06-01", "{\"targetPages\":0}").statusCode())
			.isEqualTo(400);
		assertThat(send("PUT", "/api/v1/reading-goals/2019-06-01", "{}").statusCode()).isEqualTo(400);
		assertThat(send("PUT", "/api/v1/reading-goals/not-a-date", "{\"targetPages\":10}").statusCode())
			.isEqualTo(400);
	}

}
