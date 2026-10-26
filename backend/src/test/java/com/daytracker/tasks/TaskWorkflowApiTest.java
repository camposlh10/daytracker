package com.daytracker.tasks;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.util.FileSystemUtils;

/** The task and category workflow over HTTP: JSON shapes, status codes, and partial updates. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "daytracker.data-dir=" + TaskWorkflowApiTest.DATA_DIR,
				"daytracker.launch-token=" + TaskWorkflowApiTest.TOKEN })
class TaskWorkflowApiTest {

	static final String DATA_DIR = "target/test-data/task-workflow-api";

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

	private UUID createTask(String title, String extraJson) throws Exception {
		UUID id = UUID.randomUUID();
		HttpResponse<String> response = send("POST", "/api/v1/tasks",
				"{\"id\":\"" + id + "\",\"title\":\"" + title + "\"" + extraJson + "}");
		assertThat(response.statusCode()).isEqualTo(201);
		return id;
	}

	private static String field(String json, String name) {
		Matcher matcher = Pattern.compile("\"" + name + "\":(\"[^\"]*\"|null|\\d+)").matcher(json);
		assertThat(matcher.find()).as(name + " in " + json).isTrue();
		return matcher.group(1).replace("\"", "");
	}

	@Test
	void completeRepeatReopenAndCompleteAgain() throws Exception {
		UUID id = createTask("Ship release", ",\"plannedDate\":\"2026-10-05\"");
		String path = "/api/v1/tasks/" + id;

		HttpResponse<String> done = send("PATCH", path, "{\"version\":1,\"status\":\"DONE\"}");
		assertThat(done.statusCode()).isEqualTo(200);
		assertThat(field(done.body(), "status")).isEqualTo("DONE");
		assertThat(field(done.body(), "version")).isEqualTo("2");
		String completedAt = field(done.body(), "completedAt");
		assertThat(completedAt).matches("\\d{4}-\\d{2}-\\d{2}T.+Z");

		// Replaying the original request is refused; repeating it with the current version changes nothing.
		HttpResponse<String> stale = send("PATCH", path, "{\"version\":1,\"status\":\"DONE\"}");
		assertThat(stale.statusCode()).isEqualTo(409);
		assertThat(stale.body()).contains("\"code\":\"CONFLICT\"");
		HttpResponse<String> repeat = send("PATCH", path, "{\"version\":2,\"status\":\"DONE\"}");
		assertThat(repeat.statusCode()).isEqualTo(200);
		assertThat(field(repeat.body(), "completedAt")).isEqualTo(completedAt);
		assertThat(field(repeat.body(), "version")).isEqualTo("2");

		HttpResponse<String> reopened = send("PATCH", path, "{\"version\":2,\"status\":\"IN_PROGRESS\"}");
		assertThat(field(reopened.body(), "completedAt")).isEqualTo("null");
		assertThat(field(reopened.body(), "version")).isEqualTo("3");

		HttpResponse<String> doneAgain = send("PATCH", path, "{\"version\":3,\"status\":\"DONE\"}");
		assertThat(field(doneAgain.body(), "completedAt")).isNotEqualTo("null");

		HttpResponse<String> activity = send("GET", path + "/activity", null);
		assertThat(activity.statusCode()).isEqualTo(200);
		assertThat(activity.body()).containsSubsequence("\"action\":\"CREATED\"", "\"action\":\"COMPLETED\"",
				"\"action\":\"REOPENED\"", "\"action\":\"COMPLETED\"");
	}

	@Test
	void partialUpdateDistinguishesOmittedFromNull() throws Exception {
		UUID id = createTask("Taxes", ",\"description\":\"Receipts\",\"plannedDate\":\"2026-10-10\","
				+ "\"deadlineDate\":\"2026-10-31\",\"priority\":\"HIGH\"");
		String path = "/api/v1/tasks/" + id;

		// Only the title is present: everything else is kept.
		HttpResponse<String> renamed = send("PATCH", path, "{\"version\":1,\"title\":\"  File taxes  \"}");
		assertThat(renamed.statusCode()).isEqualTo(200);
		assertThat(renamed.body()).contains("\"title\":\"File taxes\"")
			.contains("\"description\":\"Receipts\"")
			.contains("\"plannedDate\":\"2026-10-10\"")
			.contains("\"deadlineDate\":\"2026-10-31\"")
			.contains("\"priority\":\"HIGH\"");

		// An explicit null clears the planned date and leaves the deadline alone.
		HttpResponse<String> cleared = send("PATCH", path, "{\"version\":2,\"plannedDate\":null}");
		assertThat(cleared.body()).contains("\"plannedDate\":null").contains("\"deadlineDate\":\"2026-10-31\"");

		assertThat(send("GET", "/api/v1/tasks?scheduled=false", null).body()).contains(id.toString());
		assertThat(send("GET", "/api/v1/tasks?scheduled=true", null).body()).doesNotContain(id.toString());
	}

	@Test
	void updateValidatesInput() throws Exception {
		UUID id = createTask("Valid", "");
		String path = "/api/v1/tasks/" + id;

		assertThat(send("PATCH", path, "{\"status\":\"DONE\"}").statusCode()).isEqualTo(400);
		assertThat(send("PATCH", path, "{\"version\":1,\"title\":\"  \"}").statusCode()).isEqualTo(400);
		assertThat(send("PATCH", path, "{\"version\":1,\"status\":null}").statusCode()).isEqualTo(400);
		assertThat(send("PATCH", path, "{\"version\":1,\"status\":\"FINISHED\"}").statusCode()).isEqualTo(400);
		assertThat(send("PATCH", path, "{\"version\":1,\"plannedDate\":\"2026-02-30\"}").statusCode())
			.isEqualTo(400);
		HttpResponse<String> badCategory = send("PATCH", path,
				"{\"version\":1,\"categoryId\":\"" + UUID.randomUUID() + "\"}");
		assertThat(badCategory.statusCode()).isEqualTo(400);
		assertThat(badCategory.body()).contains("\"field\":\"categoryId\"");
		assertThat(send("PATCH", "/api/v1/tasks/" + UUID.randomUUID(), "{\"version\":1,\"title\":\"x\"}").statusCode())
			.isEqualTo(404);
		assertThat(send("GET", "/api/v1/tasks/" + UUID.randomUUID() + "/activity", null).statusCode())
			.isEqualTo(404);

		assertThat(field(send("GET", path, null).body(), "version")).isEqualTo("1");
	}

	@Test
	void archiveHidesFromTheListAndFiltersNarrowIt() throws Exception {
		String marker = "zebra" + UUID.randomUUID().toString().substring(0, 8);
		UUID keep = createTask(marker + " keep", ",\"priority\":\"LOW\"");
		UUID gone = createTask(marker + " archive me", "");

		assertThat(send("PATCH", "/api/v1/tasks/" + gone, "{\"version\":1,\"archived\":true}").body())
			.containsPattern("\"archivedAt\":\"\\d{4}");

		String active = send("GET", "/api/v1/tasks?q=" + marker, null).body();
		assertThat(active).contains(keep.toString()).doesNotContain(gone.toString()).contains("\"total\":1");
		String archived = send("GET", "/api/v1/tasks?archived=true&q=" + marker, null).body();
		assertThat(archived).contains(gone.toString()).doesNotContain(keep.toString());
		assertThat(send("GET", "/api/v1/tasks?q=" + marker + "&priority=HIGH", null).body())
			.contains("\"total\":0");
		assertThat(send("GET", "/api/v1/tasks?q=" + marker + "&priority=LOW&status=PENDING", null).body())
			.contains("\"total\":1");
		assertThat(send("GET", "/api/v1/tasks?status=NOPE", null).statusCode()).isEqualTo(400);
	}

	@Test
	void categoriesAreCreatedListedAssignedAndUpdated() throws Exception {
		UUID categoryId = UUID.randomUUID();
		String name = "Work " + categoryId.toString().substring(0, 8);
		String create = "{\"id\":\"" + categoryId + "\",\"name\":\"" + name + "\",\"color\":\"#668be8\"}";

		HttpResponse<String> created = send("POST", "/api/v1/categories", create);
		assertThat(created.statusCode()).isEqualTo(201);
		assertThat(created.body()).contains("\"name\":\"" + name + "\"")
			.contains("\"color\":\"#668BE8\"")
			.contains("\"archivedAt\":null")
			.contains("\"version\":1");
		assertThat(send("POST", "/api/v1/categories", create).statusCode()).isEqualTo(200);
		HttpResponse<String> duplicate = send("POST", "/api/v1/categories", "{\"id\":\"" + UUID.randomUUID()
				+ "\",\"name\":\"" + name.toUpperCase() + "\",\"color\":\"#000000\"}");
		assertThat(duplicate.statusCode()).isEqualTo(409);
		assertThat(send("POST", "/api/v1/categories",
				"{\"id\":\"" + UUID.randomUUID() + "\",\"name\":\"Bad color\",\"color\":\"red\"}")
			.statusCode()).isEqualTo(400);

		UUID taskId = createTask("Categorised", ",\"categoryId\":\"" + categoryId + "\"");
		assertThat(send("GET", "/api/v1/tasks?categoryId=" + categoryId, null).body()).contains(taskId.toString())
			.contains("\"total\":1");

		HttpResponse<String> updated = send("PATCH", "/api/v1/categories/" + categoryId,
				"{\"version\":1,\"name\":\"" + name + " renamed\",\"archived\":true}");
		assertThat(updated.statusCode()).isEqualTo(200);
		assertThat(updated.body()).contains("renamed").containsPattern("\"archivedAt\":\"\\d{4}");
		assertThat(send("PATCH", "/api/v1/categories/" + categoryId, "{\"version\":1,\"name\":\"Stale\"}")
			.statusCode()).isEqualTo(409);
		assertThat(send("GET", "/api/v1/categories", null).body()).contains(categoryId.toString());
		// The archived category is preserved on the task.
		assertThat(send("GET", "/api/v1/tasks/" + taskId, null).body())
			.contains("\"categoryId\":\"" + categoryId + "\"");
	}

	@Test
	void progressReturnsTotalsAndADailySeries() throws Exception {
		HttpResponse<String> response = send("GET", "/api/v1/progress?from=2031-05-01&to=2031-05-04", null);

		assertThat(response.statusCode()).isEqualTo(200);
		// A period that has not begun shows its targets but no invented rates.
		assertThat(response.body()).startsWith("{\"from\":\"2031-05-01\",\"to\":\"2031-05-04\",\"today\":\"")
			.contains("\"tasksCompleted\":0,\"tasksPlanned\":0,\"pagesRead\":0,\"readingDays\":0,\"elapsedDays\":0")
			.contains("{\"date\":\"2031-05-01\",\"tasksCompleted\":0,\"pagesRead\":0,\"targetPages\":30,")
			.contains("\"future\":true")
			.doesNotContain("\"future\":false")
			.contains("\"completedTasks\":[],\"books\":[]");
		assertThat(send("GET", "/api/v1/progress?from=2031-05-01&to=2031-05-01", null).statusCode()).isEqualTo(400);
		assertThat(send("GET", "/api/v1/progress?from=2031-05-01", null).statusCode()).isEqualTo(400);
	}

}
