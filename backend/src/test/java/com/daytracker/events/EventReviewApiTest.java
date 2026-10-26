package com.daytracker.events;

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

/** Appointments and reviews over HTTP: JSON shapes and status codes. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "daytracker.data-dir=" + EventReviewApiTest.DATA_DIR,
				"daytracker.launch-token=" + EventReviewApiTest.TOKEN })
class EventReviewApiTest {

	static final String DATA_DIR = "target/test-data/event-review-api";

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

	@Test
	void timedEventLifecycle() throws Exception {
		UUID id = UUID.randomUUID();
		String create = "{\"id\":\"" + id + "\",\"title\":\"Dentist\",\"allDay\":false,\"start\":\"2030-03-04T09:00\","
				+ "\"end\":\"2030-03-04T10:15\",\"timezone\":\"Europe/Lisbon\"}";

		HttpResponse<String> created = send("POST", "/api/v1/events", create);
		assertThat(created.statusCode()).isEqualTo(201);
		assertThat(created.body()).contains("\"title\":\"Dentist\"")
			.contains("\"allDay\":false")
			.contains("\"startsAt\":\"2030-03-04T09:00:00Z\"")
			.contains("\"endsAt\":\"2030-03-04T10:15:00Z\"")
			.contains("\"timezone\":\"Europe/Lisbon\"")
			.contains("\"localStart\":\"2030-03-04T09:00:00\"")
			.contains("\"localEnd\":\"2030-03-04T10:15:00\"")
			.contains("\"startDate\":null")
			.contains("\"overlapsAnother\":false")
			.contains("\"version\":1");
		assertThat(send("POST", "/api/v1/events", create).statusCode()).isEqualTo(200);
		assertThat(send("GET", "/api/v1/events?from=2030-03-01&to=2030-03-31", null).body()).contains(id.toString());
		assertThat(send("GET", "/api/v1/events/" + id, null).statusCode()).isEqualTo(200);

		HttpResponse<String> moved = send("PATCH", "/api/v1/events/" + id, "{\"version\":1,\"title\":\"Dentist\","
				+ "\"allDay\":true,\"startDate\":\"2030-03-05\",\"endDateExclusive\":\"2030-03-06\"}");
		assertThat(moved.statusCode()).isEqualTo(200);
		assertThat(moved.body()).contains("\"allDay\":true")
			.contains("\"startsAt\":null")
			.contains("\"startDate\":\"2030-03-05\"")
			.contains("\"endDateExclusive\":\"2030-03-06\"")
			.contains("\"version\":2");

		assertThat(send("DELETE", "/api/v1/events/" + id + "?version=1", null).statusCode()).isEqualTo(409);
		assertThat(send("DELETE", "/api/v1/events/" + id + "?version=2", null).statusCode()).isEqualTo(204);
		assertThat(send("DELETE", "/api/v1/events/" + id + "?version=2", null).statusCode()).isEqualTo(404);
		assertThat(send("GET", "/api/v1/events/" + id, null).statusCode()).isEqualTo(404);
	}

	@Test
	void eventsAppearInTheCalendarAndTheDay() throws Exception {
		UUID id = UUID.randomUUID();
		assertThat(send("POST", "/api/v1/events", "{\"id\":\"" + id + "\",\"title\":\"Retreat\",\"allDay\":true,"
				+ "\"startDate\":\"2031-07-30\",\"endDateExclusive\":\"2031-08-02\"}")
			.statusCode()).isEqualTo(201);

		String range = send("GET", "/api/v1/calendar?from=2031-07-27&to=2031-08-03", null).body();
		assertThat(range).contains("{\"type\":\"EVENT\",\"id\":\"" + id + "\",\"date\":\"2031-07-30\",\"title\":\"Retreat\","
				+ "\"status\":null,\"priority\":null,\"pagesRead\":null,\"allDay\":true,\"startsAt\":null,\"endsAt\":null,"
				+ "\"continued\":false,\"overlapsAnother\":false,\"bookId\":null,\"coverUpdatedAt\":null}")
			.contains("\"date\":\"2031-08-01\",\"title\":\"Retreat\"")
			.doesNotContain("\"date\":\"2031-08-02\",\"title\":\"Retreat\"");
		assertThat(send("GET", "/api/v1/days/2031-08-01", null).body()).contains("\"events\":[{\"id\":\"" + id + "\"");
	}

	@Test
	void eventsAreValidatedOverHttp() throws Exception {
		HttpResponse<String> backwards = send("POST", "/api/v1/events", "{\"id\":\"" + UUID.randomUUID()
				+ "\",\"title\":\"X\",\"allDay\":false,\"start\":\"2030-03-04T10:00\",\"end\":\"2030-03-04T09:00\","
				+ "\"timezone\":\"Europe/Lisbon\"}");
		assertThat(backwards.statusCode()).isEqualTo(400);
		assertThat(backwards.body()).contains("\"field\":\"end\"");
		HttpResponse<String> zone = send("POST", "/api/v1/events", "{\"id\":\"" + UUID.randomUUID()
				+ "\",\"title\":\"X\",\"allDay\":false,\"start\":\"2030-03-04T09:00\",\"end\":\"2030-03-04T10:00\","
				+ "\"timezone\":\"Nowhere/Land\"}");
		assertThat(zone.body()).contains("\"field\":\"timezone\"");
		assertThat(send("POST", "/api/v1/events", "{\"id\":\"" + UUID.randomUUID()
				+ "\",\"title\":\"X\",\"allDay\":false,\"start\":\"not a time\"}").statusCode()).isEqualTo(400);
		assertThat(send("GET", "/api/v1/events?from=2030-01-01&to=2030-12-31", null).statusCode()).isEqualTo(400);
		assertThat(send("PATCH", "/api/v1/events/" + UUID.randomUUID(), "{\"version\":1,\"title\":\"X\",\"allDay\":true,"
				+ "\"startDate\":\"2030-03-05\",\"endDateExclusive\":\"2030-03-06\"}").statusCode()).isEqualTo(404);
	}

	@Test
	void reviewLifecycle() throws Exception {
		String path = "/api/v1/reviews/2026-01-15";
		assertThat(send("GET", path, null).statusCode()).isEqualTo(404);

		HttpResponse<String> created = send("PUT", path,
				"{\"wins\":\"Finished the draft\",\"obstacles\":\"\",\"tomorrowPriority\":\"Send it\"}");
		assertThat(created.statusCode()).isEqualTo(200);
		assertThat(created.body()).contains("\"reviewDate\":\"2026-01-15\"")
			.contains("\"wins\":\"Finished the draft\"")
			.contains("\"obstacles\":\"\"")
			.contains("\"tomorrowPriority\":\"Send it\"")
			.contains("\"version\":1");
		assertThat(send("GET", path, null).body()).isEqualTo(created.body());
		assertThat(send("GET", "/api/v1/days/2026-01-15", null).body()).contains("\"review\":{");

		assertThat(send("PUT", path, "{\"version\":1,\"wins\":\"Finished\",\"obstacles\":\"Noise\","
				+ "\"tomorrowPriority\":\"Send it\"}").body()).contains("\"version\":2");
		assertThat(send("PUT", path, "{\"version\":1,\"wins\":\"Stale\"}").statusCode()).isEqualTo(409);
		assertThat(send("PUT", path, "{\"wins\":\"Second first save\"}").statusCode()).isEqualTo(409);

		String future = LocalDate.now().plusDays(2).toString();
		assertThat(send("PUT", "/api/v1/reviews/" + future, "{\"wins\":\"Too soon\"}").statusCode()).isEqualTo(400);
		assertThat(send("PUT", "/api/v1/reviews/2026-02-30", "{\"wins\":\"Bad date\"}").statusCode()).isEqualTo(400);
	}

}
