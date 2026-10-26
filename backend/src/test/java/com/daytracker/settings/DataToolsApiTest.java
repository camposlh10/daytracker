package com.daytracker.settings;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.util.FileSystemUtils;

/** Settings, CSV exports, and backups over HTTP, against an isolated database. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "daytracker.data-dir=" + DataToolsApiTest.DATA_DIR,
				"daytracker.launch-token=" + DataToolsApiTest.TOKEN })
class DataToolsApiTest {

	static final String DATA_DIR = "target/test-data/data-tools-api";

	static final String TOKEN = "test-launch-token-0123456789abcdef0123456789";

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
		return http.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
	}

	private void createTask(String title) throws Exception {
		HttpResponse<String> response = send("POST", "/api/v1/tasks",
				"{\"id\":\"" + UUID.randomUUID() + "\",\"title\":\"" + title + "\",\"plannedDate\":\"2026-10-20\"}");
		assertThat(response.statusCode()).isEqualTo(201);
	}

	@Test
	void settingsHaveStoredDefaultsAndAreUpdatedPartially() throws Exception {
		HttpResponse<String> first = send("GET", "/api/v1/settings", null);
		assertThat(first.statusCode()).isEqualTo(200);
		assertThat(first.body()).contains("\"displayName\":\"\"")
			.containsPattern("\"timezone\":\"[A-Za-z_]+(/[A-Za-z0-9_+-]+)*\"")
			.contains("\"weekStart\":1")
			.contains("\"timeFormat\":\"H12\"");

		HttpResponse<String> changed = send("PATCH", "/api/v1/settings",
				"{\"displayName\":\"Ana\",\"timezone\":\"Europe/Lisbon\",\"weekStart\":0,\"timeFormat\":\"H24\"}");
		assertThat(changed.statusCode()).isEqualTo(200);
		assertThat(changed.body()).isEqualTo(
				"{\"displayName\":\"Ana\",\"timezone\":\"Europe/Lisbon\",\"weekStart\":0,\"timeFormat\":\"H24\"}");

		assertThat(send("PATCH", "/api/v1/settings", "{\"weekStart\":3}").body()).contains("\"weekStart\":3")
			.contains("\"displayName\":\"Ana\"");
		assertThat(send("GET", "/api/v1/settings", null).body()).contains("\"timezone\":\"Europe/Lisbon\"");
	}

	@Test
	void invalidSettingsAreRejected() throws Exception {
		for (String body : new String[] { "{\"timezone\":\"Mars/Olympus\"}", "{\"timezone\":\"+03:00\"}", "{\"weekStart\":9}",
				"{\"timeFormat\":\"H99\"}", "{\"displayName\":\"" + "x".repeat(61) + "\"}" }) {
			assertThat(send("PATCH", "/api/v1/settings", body).statusCode()).as(body).isEqualTo(400);
		}
	}

	@Test
	void taskExportIsCsvWithAnAttachmentNameAndNeutralizedFormulas() throws Exception {
		createTask("=cmd|' /C calc'!A0");
		createTask("Buy milk, eggs");

		HttpResponse<String> response = send("GET", "/api/v1/exports/tasks", null);

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(response.headers().firstValue("Content-Type")).hasValueSatisfying(type -> assertThat(type).startsWith("text/csv"));
		assertThat(response.headers().firstValue("Content-Disposition")).hasValueSatisfying(
				value -> assertThat(value).startsWith("attachment").contains("tasks-").contains(".csv"));
		String body = response.body();
		assertThat(body).contains("'=cmd|' /C calc'!A0").contains("\"Buy milk, eggs\"").contains("\r\n");
		assertThat(body).doesNotContain(",=cmd").doesNotContain("\r\n=cmd");
	}

	@Test
	void everyDatasetExportsAndUnknownOnesAreNotFound() throws Exception {
		for (String dataset : new String[] { "tasks", "reading-sessions", "appointments" }) {
			HttpResponse<String> response = send("GET", "/api/v1/exports/" + dataset, null);
			assertThat(response.statusCode()).as(dataset).isEqualTo(200);
			assertThat(response.body()).as(dataset).isNotEmpty();
		}
		HttpResponse<String> summaries = send("GET", "/api/v1/exports/summaries?from=2026-10-01&to=2026-10-08", null);
		assertThat(summaries.statusCode()).isEqualTo(200);
		assertThat(summaries.body().lines().count()).isEqualTo(8);
		assertThat(send("GET", "/api/v1/exports/passwords", null).statusCode()).isEqualTo(404);
		assertThat(send("GET", "/api/v1/exports/summaries?from=2020-01-01&to=2026-01-01", null).statusCode()).isEqualTo(400);
	}

	@Test
	void backupsAreCreatedListedAndReportedWithTheirLocation() throws Exception {
		HttpResponse<String> created = send("POST", "/api/v1/backups", "");
		assertThat(created.statusCode()).isEqualTo(201);
		assertThat(created.body()).contains("\"kind\":\"MANUAL\"").contains("\"verified\":true");

		HttpResponse<String> status = send("GET", "/api/v1/backups", null);
		assertThat(status.statusCode()).isEqualTo(200);
		assertThat(status.body()).contains("\"directory\":").contains("manual-").contains("\"ok\":true");
	}

	@Test
	void restoreChecksRefuseNamesOutsideTheStagingArea() throws Exception {
		for (String name : new String[] { "../daytracker.db", "other.db", "C:\\\\x.db" }) {
			HttpResponse<String> response = send("POST", "/api/v1/lifecycle/restore/validate", "{\"fileName\":\"" + name + "\"}");
			assertThat(response.statusCode()).as(name).isEqualTo(400);
			assertThat(response.body()).contains("RESTORE_REJECTED");
		}
		Path staged = Path.of(DATA_DIR, "restore-staging");
		Files.createDirectories(staged);
		Files.writeString(staged.resolve("staged-1.db"), "not a database ".repeat(100));
		HttpResponse<String> junk = send("POST", "/api/v1/lifecycle/restore/validate", "{\"fileName\":\"staged-1.db\"}");
		assertThat(junk.statusCode()).isEqualTo(400);
		assertThat(junk.body()).contains("RESTORE_REJECTED");
	}

	@Test
	void aSafetyBackupCanBeRequestedBeforeARestore() throws Exception {
		HttpResponse<String> response = send("POST", "/api/v1/lifecycle/restore/safety-backup", "");

		assertThat(response.statusCode()).isIn(200, 201);
		assertThat(response.body()).contains("\"kind\":\"SAFETY\"");
	}

}
