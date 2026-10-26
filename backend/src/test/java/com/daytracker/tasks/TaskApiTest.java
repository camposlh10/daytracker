package com.daytracker.tasks;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.util.FileSystemUtils;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "daytracker.data-dir=" + TaskApiTest.DATA_DIR, "daytracker.launch-token=" + TaskApiTest.TOKEN })
class TaskApiTest {

	static final String DATA_DIR = "target/test-data/task-api";

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

	private HttpResponse<String> send(String method, String path, String token, String json) throws Exception {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path));
		if (token != null) {
			request.header("Authorization", "Bearer " + token);
		}
		if (json != null) {
			request.header("Content-Type", "application/json");
			request.method(method, HttpRequest.BodyPublishers.ofString(json));
		}
		else {
			request.method(method, HttpRequest.BodyPublishers.noBody());
		}
		return http.send(request.build(), HttpResponse.BodyHandlers.ofString());
	}

	private static String taskJson(UUID id, String title) {
		return "{\"id\":\"" + id + "\",\"title\":\"" + title + "\",\"plannedDate\":\"2026-10-05\"}";
	}

	@Test
	void rejectsRequestsWithoutTheLaunchToken() throws Exception {
		for (String path : new String[] { "/api/v1/health", "/api/v1/tasks", "/error", "/unknown" }) {
			assertThat(send("GET", path, null, null).statusCode()).as(path).isEqualTo(401);
			assertThat(send("GET", path, "wrong-token", null).statusCode()).as(path).isEqualTo(401);
		}
		HttpResponse<String> response = send("POST", "/api/v1/tasks", null, taskJson(UUID.randomUUID(), "Nope"));
		assertThat(response.statusCode()).isEqualTo(401);
		assertThat(response.body()).contains("\"code\":\"UNAUTHORIZED\"").contains("correlationId");
	}

	@Test
	void healthReportsReadinessAndApiVersion() throws Exception {
		HttpResponse<String> response = send("GET", "/api/v1/health", TOKEN, null);

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(response.body()).isEqualTo("{\"status\":\"READY\",\"apiVersion\":\"v1\"}");
	}

	@Test
	void createsATaskAndReturnsItFromListAndDetail() throws Exception {
		UUID id = UUID.randomUUID();

		HttpResponse<String> created = send("POST", "/api/v1/tasks", TOKEN, taskJson(id, "  Plan the week  "));

		assertThat(created.statusCode()).isEqualTo(201);
		assertThat(created.body()).contains("\"id\":\"" + id + "\"")
			.contains("\"title\":\"Plan the week\"")
			.contains("\"status\":\"PENDING\"")
			.contains("\"priority\":\"MEDIUM\"")
			.contains("\"plannedDate\":\"2026-10-05\"")
			.contains("\"completedAt\":null")
			.contains("\"version\":1")
			.containsPattern("\"createdAt\":\"\\d{4}-\\d{2}-\\d{2}T[0-9:.]+Z\"");

		HttpResponse<String> detail = send("GET", "/api/v1/tasks/" + id, TOKEN, null);
		assertThat(detail.statusCode()).isEqualTo(200);
		assertThat(detail.body()).isEqualTo(created.body());

		HttpResponse<String> list = send("GET", "/api/v1/tasks", TOKEN, null);
		assertThat(list.statusCode()).isEqualTo(200);
		assertThat(list.body()).contains("\"id\":\"" + id + "\"").contains("\"page\":0").contains("\"size\":50");
	}

	@Test
	void replayedCreateIsIdempotentAndDifferentPayloadConflicts() throws Exception {
		UUID id = UUID.randomUUID();
		HttpResponse<String> first = send("POST", "/api/v1/tasks", TOKEN, taskJson(id, "Read chapter 3"));

		HttpResponse<String> replay = send("POST", "/api/v1/tasks", TOKEN, taskJson(id, "Read chapter 3"));
		HttpResponse<String> different = send("POST", "/api/v1/tasks", TOKEN, taskJson(id, "Read chapter 4"));

		assertThat(first.statusCode()).isEqualTo(201);
		assertThat(replay.statusCode()).isEqualTo(200);
		assertThat(replay.body()).isEqualTo(first.body());
		assertThat(different.statusCode()).isEqualTo(409);
		assertThat(different.body()).contains("\"code\":\"CONFLICT\"");
	}

	@Test
	void rejectsInvalidInput() throws Exception {
		HttpResponse<String> blankTitle = send("POST", "/api/v1/tasks", TOKEN, taskJson(UUID.randomUUID(), "   "));
		assertThat(blankTitle.statusCode()).isEqualTo(400);
		assertThat(blankTitle.body()).contains("\"code\":\"VALIDATION_FAILED\"").contains("\"field\":\"title\"");

		HttpResponse<String> longTitle = send("POST", "/api/v1/tasks", TOKEN,
				taskJson(UUID.randomUUID(), "x".repeat(201)));
		assertThat(longTitle.statusCode()).isEqualTo(400);

		HttpResponse<String> missingId = send("POST", "/api/v1/tasks", TOKEN, "{\"title\":\"No id\"}");
		assertThat(missingId.statusCode()).isEqualTo(400);
		assertThat(missingId.body()).contains("\"field\":\"id\"");

		HttpResponse<String> badEnum = send("POST", "/api/v1/tasks", TOKEN,
				"{\"id\":\"" + UUID.randomUUID() + "\",\"title\":\"Bad\",\"priority\":\"URGENT\"}");
		assertThat(badEnum.statusCode()).isEqualTo(400);
		assertThat(badEnum.body()).contains("\"code\":\"INVALID_REQUEST\"").doesNotContain("Exception");

		assertThat(send("GET", "/api/v1/tasks?size=500", TOKEN, null).statusCode()).isEqualTo(400);
		assertThat(send("GET", "/api/v1/tasks/not-a-uuid", TOKEN, null).statusCode()).isEqualTo(400);
	}

	@Test
	void unknownTaskAndUnknownRouteAreNotFound() throws Exception {
		HttpResponse<String> task = send("GET", "/api/v1/tasks/" + UUID.randomUUID(), TOKEN, null);
		assertThat(task.statusCode()).isEqualTo(404);
		assertThat(task.body()).contains("\"code\":\"NOT_FOUND\"");

		assertThat(send("GET", "/api/v1/nothing-here", TOKEN, null).statusCode()).isEqualTo(404);
	}

}
