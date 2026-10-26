package com.daytracker.calendar;

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
		properties = { "daytracker.data-dir=" + CalendarApiTest.DATA_DIR,
				"daytracker.launch-token=" + CalendarApiTest.TOKEN })
class CalendarApiTest {

	static final String DATA_DIR = "target/test-data/calendar-api";

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

	private HttpResponse<String> get(String path, String token) throws Exception {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).GET();
		if (token != null) {
			request.header("Authorization", "Bearer " + token);
		}
		return http.send(request.build(), HttpResponse.BodyHandlers.ofString());
	}

	private UUID createTask(String title, String plannedDate) throws Exception {
		UUID id = UUID.randomUUID();
		String planned = plannedDate == null ? "null" : "\"" + plannedDate + "\"";
		String json = "{\"id\":\"" + id + "\",\"title\":\"" + title + "\",\"plannedDate\":" + planned + "}";
		HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/tasks"))
			.header("Authorization", "Bearer " + TOKEN)
			.header("Content-Type", "application/json")
			.POST(HttpRequest.BodyPublishers.ofString(json))
			.build();
		assertThat(http.send(request, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(201);
		return id;
	}

	@Test
	void rangeIncludesTheStartDateAndExcludesTheEndDate() throws Exception {
		UUID first = createTask("On the start date", "2031-03-01");
		UUID last = createTask("On the last included date", "2031-03-31");
		UUID end = createTask("On the exclusive end date", "2031-04-01");
		UUID before = createTask("Before the range", "2031-02-28");

		HttpResponse<String> response = get("/api/v1/calendar?from=2031-03-01&to=2031-04-01", TOKEN);

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(response.body()).startsWith("{\"from\":\"2031-03-01\",\"to\":\"2031-04-01\",\"items\":[")
			.contains("{\"type\":\"TASK\",\"id\":\"" + first + "\",\"date\":\"2031-03-01\","
					+ "\"title\":\"On the start date\",\"status\":\"PENDING\",\"priority\":\"MEDIUM\",\"pagesRead\":null"
					+ ",\"allDay\":null,\"startsAt\":null,\"endsAt\":null,\"continued\":null,\"overlapsAnother\":null,\"bookId\":null,\"coverUpdatedAt\":null}")
			.contains(last.toString())
			.doesNotContain(end.toString())
			.doesNotContain(before.toString());
		assertThat(response.body().indexOf(first.toString())).isLessThan(response.body().indexOf(last.toString()));
	}

	@Test
	void rangeCrossesAYearBoundaryAndSkipsUnscheduledTasks() throws Exception {
		UUID december = createTask("New Year's Eve", "2032-12-31");
		UUID january = createTask("New Year's Day", "2033-01-01");
		UUID unscheduled = createTask("Someday", null);

		HttpResponse<String> response = get("/api/v1/calendar?from=2032-12-28&to=2033-01-04", TOKEN);

		assertThat(response.body()).contains(december.toString())
			.contains(january.toString())
			.doesNotContain(unscheduled.toString());
	}

	@Test
	void rangeIsBoundedAndValidated() throws Exception {
		assertThat(get("/api/v1/calendar?from=2031-01-01&to=2031-04-04", TOKEN).statusCode()).isEqualTo(200);

		HttpResponse<String> tooLong = get("/api/v1/calendar?from=2031-01-01&to=2031-04-05", TOKEN);
		assertThat(tooLong.statusCode()).isEqualTo(400);
		assertThat(tooLong.body()).contains("\"code\":\"VALIDATION_FAILED\"").contains("93 days");

		assertThat(get("/api/v1/calendar?from=2031-01-02&to=2031-01-02", TOKEN).statusCode()).isEqualTo(400);
		assertThat(get("/api/v1/calendar?from=2031-01-02&to=2031-01-01", TOKEN).statusCode()).isEqualTo(400);
		assertThat(get("/api/v1/calendar?from=2031-01-01", TOKEN).statusCode()).isEqualTo(400);
		assertThat(get("/api/v1/calendar?from=2031-02-30&to=2031-03-01", TOKEN).statusCode()).isEqualTo(400);
		assertThat(get("/api/v1/calendar?from=2031-01-01&to=2031-02-01", null).statusCode()).isEqualTo(401);
	}

	@Test
	void dayReturnsTheFullTasksPlannedForThatDate() throws Exception {
		UUID leapDay = createTask("Leap day task", "2032-02-29");
		UUID nextDay = createTask("First of March", "2032-03-01");

		HttpResponse<String> response = get("/api/v1/days/2032-02-29", TOKEN);

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(response.body()).startsWith("{\"date\":\"2032-02-29\",\"tasks\":[")
			.contains(leapDay.toString())
			.contains("\"plannedDate\":\"2032-02-29\"")
			.contains("\"version\":1")
			.doesNotContain(nextDay.toString());

		assertThat(get("/api/v1/days/2035-06-15", TOKEN).body()).isEqualTo("{\"date\":\"2035-06-15\",\"tasks\":[],\"carryOver\":[],\"readingSessions\":[],"
				+ "\"pagesRead\":0,\"readingGoal\":{\"targetPages\":30,\"effectiveDate\":null},\"events\":[],\"review\":null}");
		assertThat(get("/api/v1/days/2031-02-29", TOKEN).statusCode()).isEqualTo(400);
		assertThat(get("/api/v1/days/tomorrow", TOKEN).statusCode()).isEqualTo(400);
	}

}
