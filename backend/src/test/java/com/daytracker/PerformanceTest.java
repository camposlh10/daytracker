package com.daytracker;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import java.util.function.Supplier;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.FileSystemUtils;

/**
 * Measures the acceptance targets of the specification against a real SQLite
 * file holding 10,000 tasks, 10,000 reading sessions and 5,000 appointments.
 * Excluded from the normal build because it takes a while and its timings depend
 * on the machine; run it with
 *
 * <pre>./mvnw test -Dtest=PerformanceTest -Dtest.excluded.groups=</pre>
 *
 * The report is printed and written to target/performance-report.txt.
 */
@Tag("performance")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "daytracker.data-dir=" + PerformanceTest.DATA_DIR,
				"daytracker.launch-token=" + PerformanceTest.TOKEN })
class PerformanceTest {

	static final String DATA_DIR = "target/test-data/performance";

	static final String TOKEN = "test-launch-token-0123456789abcdef0123456789";

	private static final int TASKS = 10_000;

	private static final int SESSIONS = 10_000;

	private static final int EVENTS = 5_000;

	private static final int WARM_UP = 5;

	private static final int RUNS = 25;

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

	@Autowired
	JdbcClient jdbc;

	@Autowired
	TransactionTemplate transaction;

	private final List<String> bookIds = new ArrayList<>();

	private record Result(String name, long median, long worst, int status) {
	}

	private HttpResponse<String> send(String method, String path, String json) {
		try {
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
		catch (Exception ex) {
			throw new IllegalStateException(ex);
		}
	}

	private Result measure(String name, Supplier<HttpResponse<String>> call) {
		for (int i = 0; i < WARM_UP; i++) {
			call.get();
		}
		List<Long> times = new ArrayList<>();
		int status = 0;
		for (int i = 0; i < RUNS; i++) {
			long start = System.nanoTime();
			HttpResponse<String> response = call.get();
			times.add((System.nanoTime() - start) / 1_000_000);
			status = response.statusCode();
			assertThat(status).as(name).isBetween(200, 201);
		}
		times.sort(Long::compare);
		return new Result(name, times.get(times.size() / 2), times.get(times.size() - 1), status);
	}

	private String newBookId() {
		String id = UUID.randomUUID().toString();
		bookIds.add(id);
		return id;
	}

	private void seed() {
		Random random = new Random(42);
		LocalDate first = LocalDate.of(2024, 1, 1);
		int span = 1000;
		String now = Instant.now().toString();
		transaction.executeWithoutResult(status -> {
			for (int i = 0; i < 20; i++) {
				jdbc.sql("INSERT INTO books (id, title, author, total_pages, initial_page, status, created_at, updated_at) "
						+ "VALUES (:id, :title, 'An Author', 600, 0, 'READING', :now, :now)")
					.param("id", newBookId())
					.param("title", "Book number " + i)
					.param("now", now)
					.update();
			}
			for (int i = 0; i < TASKS; i++) {
				LocalDate planned = first.plusDays(random.nextInt(span));
				boolean done = random.nextInt(100) < 60;
				jdbc.sql("INSERT INTO tasks (id, title, priority, status, planned_date, completed_at, created_at, updated_at) "
						+ "VALUES (:id, :title, :priority, :status, :planned, :completed, :now, :now)")
					.param("id", UUID.randomUUID().toString())
					.param("title", "Task " + i + " about " + (i % 7 == 0 ? "reports" : "planning"))
					.param("priority", new String[] { "LOW", "MEDIUM", "HIGH" }[random.nextInt(3)])
					.param("status", done ? "DONE" : "PENDING")
					.param("planned", planned.toString())
					.param("completed", done ? planned.atTime(14, 0).toInstant(java.time.ZoneOffset.UTC).toString() : null)
					.param("now", now)
					.update();
			}
			for (int i = 0; i < SESSIONS; i++) {
				jdbc.sql("INSERT INTO reading_sessions (id, book_id, activity_date, pages_read, ending_page, created_at, updated_at) "
						+ "VALUES (:id, :book, :date, :pages, :ending, :now, :now)")
					.param("id", UUID.randomUUID().toString())
					.param("book", bookIds.get(random.nextInt(20)))
					.param("date", first.plusDays(random.nextInt(span)).toString())
					.param("pages", 1 + random.nextInt(40))
					.param("ending", 1 + random.nextInt(600))
					.param("now", now)
					.update();
			}
			for (int i = 0; i < EVENTS; i++) {
				LocalDate day = first.plusDays(random.nextInt(span));
				if (i % 4 == 0) {
					jdbc.sql("INSERT INTO calendar_events (id, title, all_day, start_date, end_date_exclusive, created_at, updated_at) "
							+ "VALUES (:id, :title, 1, :start, :end, :now, :now)")
						.param("id", UUID.randomUUID().toString())
						.param("title", "All day " + i)
						.param("start", day.toString())
						.param("end", day.plusDays(1 + random.nextInt(3)).toString())
						.param("now", now)
						.update();
				}
				else {
					Instant start = day.atTime(8 + random.nextInt(10), 0).toInstant(java.time.ZoneOffset.UTC);
					jdbc.sql("INSERT INTO calendar_events (id, title, all_day, starts_at, ends_at, timezone, created_at, updated_at) "
							+ "VALUES (:id, :title, 0, :start, :end, 'UTC', :now, :now)")
						.param("id", UUID.randomUUID().toString())
						.param("title", "Meeting " + i)
						.param("start", start.toString())
						.param("end", start.plusSeconds(3600L * (1 + random.nextInt(3))).toString())
						.param("now", now)
						.update();
				}
			}
		});
		jdbc.sql("ANALYZE").update();
	}

	@Test
	void measuresTheAcceptanceTargets() throws Exception {
		long seedStart = System.currentTimeMillis();
		seed();
		System.out.println("Seeded in " + (System.currentTimeMillis() - seedStart) + " ms");

		List<Result> results = new ArrayList<>();
		// The busiest kind of month: 42 days of the grid inside the seeded years.
		results.add(measure("Calendar range, month grid (42 days)",
				() -> send("GET", "/api/v1/calendar?from=2025-09-29&to=2025-11-10", null)));
		results.add(measure("Calendar range, 93 days (the maximum)",
				() -> send("GET", "/api/v1/calendar?from=2025-08-01&to=2025-11-02", null)));
		results.add(measure("Selected day", () -> send("GET", "/api/v1/days/2025-10-15", null)));
		results.add(measure("Progress, one month", () -> send("GET", "/api/v1/progress?from=2025-10-01&to=2025-11-01", null)));
		results.add(measure("Progress, one year (366 days)", () -> send("GET", "/api/v1/progress?from=2025-01-01&to=2026-01-01", null)));
		results.add(measure("Task list, first page", () -> send("GET", "/api/v1/tasks?size=50", null)));
		results.add(measure("Task search by text", () -> send("GET", "/api/v1/tasks?q=reports&size=50", null)));
		results.add(measure("Reading sessions, one book", () -> send("GET", "/api/v1/reading-sessions?bookId=" + bookIds.get(3) + "&size=50", null)));
		results.add(measure("Save: create a task", () -> send("POST", "/api/v1/tasks",
				"{\"id\":\"" + UUID.randomUUID() + "\",\"title\":\"Saved during measurement\",\"plannedDate\":\"2025-10-15\"}")));
		results.add(measure("Save: log a reading session", () -> send("POST", "/api/v1/reading-sessions",
				"{\"id\":\"" + UUID.randomUUID() + "\",\"bookId\":\"" + bookIds.get(3) + "\",\"activityDate\":\"2025-10-15\",\"pagesRead\":10}")));
		results.add(measure("Save: create an appointment", () -> send("POST", "/api/v1/events",
				"{\"id\":\"" + UUID.randomUUID() + "\",\"title\":\"Measured\",\"allDay\":true,\"startDate\":\"2025-10-15\",\"endDateExclusive\":\"2025-10-16\"}")));
		results.add(measure("Export tasks as CSV (10,000+ rows)", () -> send("GET", "/api/v1/exports/tasks", null)));
		results.add(measure("Backup now (VACUUM INTO)", () -> send("POST", "/api/v1/backups", null)));

		StringBuilder report = new StringBuilder("Fixture: %d tasks, %d reading sessions, %d appointments; %d runs each after %d warm-up runs (HTTP, localhost)%n%n"
			.formatted(TASKS, SESSIONS, EVENTS, RUNS, WARM_UP));
		report.append(String.format("%-46s %10s %10s%n", "Operation", "median ms", "worst ms"));
		for (Result result : results) {
			report.append(String.format("%-46s %10d %10d%n", result.name(), result.median(), result.worst()));
		}
		System.out.println(report);
		Files.writeString(Path.of("target", "performance-report.txt"), report.toString());

		// The specification's targets, with room for a slower machine.
		assertThat(results.get(0).median()).as("calendar month query").isLessThan(300);
		assertThat(results.get(1).median()).as("calendar 93-day query").isLessThan(300);
		for (Result result : results.subList(8, 11)) {
			assertThat(result.worst()).as(result.name()).isLessThan(500);
		}
	}

}
