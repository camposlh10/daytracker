package com.daytracker.database;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.stream.Stream;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.simple.JdbcClient;

class MigrationRunnerTest {

	private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-04T12:00:00Z"), ZoneOffset.UTC);

	private static final MigrationScript V1 = MigrationScript.fromFile("V001__first.sql",
			"CREATE TABLE one (id INTEGER PRIMARY KEY);\nINSERT INTO one (id) VALUES (1);\n");

	private static final MigrationScript V2 = MigrationScript.fromFile("V002__second.sql",
			"-- adds a table\nCREATE TABLE two (id INTEGER PRIMARY KEY);\n");

	@TempDir
	Path tempDir;

	private HikariDataSource dataSource;

	private JdbcClient jdbc;

	@BeforeEach
	void openDatabase() {
		dataSource = DatabaseConfig.createDataSource(tempDir.resolve("db").resolve("test.db"));
		jdbc = JdbcClient.create(dataSource);
	}

	@AfterEach
	void closeDatabase() {
		dataSource.close();
	}

	private MigrationRunner runner(MigrationScript... scripts) {
		return new MigrationRunner(dataSource, tempDir.resolve("backups"), CLOCK, List.of(scripts));
	}

	private List<Integer> appliedVersions() {
		return jdbc.sql("SELECT version FROM schema_migrations ORDER BY version").query(Integer.class).list();
	}

	private boolean tableExists(String name) {
		return jdbc.sql("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?")
			.param(name)
			.query(Integer.class)
			.single() == 1;
	}

	@Test
	void appliesPendingScriptsInOrderAndIsRepeatable() {
		runner(V1, V2).migrate();
		runner(V1, V2).migrate();

		assertThat(appliedVersions()).containsExactly(1, 2);
		assertThat(jdbc.sql("SELECT COUNT(*) FROM one").query(Integer.class).single()).isEqualTo(1);
		assertThat(tableExists("two")).isTrue();
	}

	@Test
	void shippedSchemaAppliesToAnEmptyDatabase() {
		List<MigrationScript> shipped = MigrationScript.loadAll(DatabaseConfig.MIGRATION_LOCATION);
		assertThat(shipped).isNotEmpty();

		new MigrationRunner(dataSource, tempDir.resolve("backups"), CLOCK, shipped).migrate();

		for (String table : List.of("categories", "tasks", "task_activity", "books", "reading_sessions",
				"reading_goals", "calendar_events", "daily_reviews", "settings", "book_covers", "schema_migrations")) {
			assertThat(tableExists(table)).as(table).isTrue();
		}
	}

	@Test
	void theCoverTableRebuildKeepsExistingCovers() {
		List<MigrationScript> shipped = MigrationScript.loadAll(DatabaseConfig.MIGRATION_LOCATION);
		List<MigrationScript> upToCovers = shipped.stream().filter(script -> script.version() <= 2).toList();
		new MigrationRunner(dataSource, tempDir.resolve("backups"), CLOCK, upToCovers).migrate();
		jdbc.sql("INSERT INTO books (id, title, total_pages, initial_page, status, created_at, updated_at) "
				+ "VALUES ('b1', 'Dune', 600, 0, 'READING', 'now', 'now')").update();
		jdbc.sql("INSERT INTO book_covers (book_id, content_type, data, source, source_id, sha256, updated_at) "
				+ "VALUES ('b1', 'image/jpeg', X'FFD8FF', 'OPEN_LIBRARY', '111', 'abc', 'now')").update();

		new MigrationRunner(dataSource, tempDir.resolve("backups"), CLOCK, shipped).migrate();

		assertThat(jdbc.sql("SELECT source_id FROM book_covers WHERE book_id = 'b1'").query(String.class).single())
			.isEqualTo("111");
		jdbc.sql("UPDATE book_covers SET source = 'GOOGLE_BOOKS' WHERE book_id = 'b1'").update();
		assertThat(jdbc.sql("SELECT source FROM book_covers").query(String.class).single()).isEqualTo("GOOGLE_BOOKS");
	}

	@Test
	void abortsWhenAnAppliedScriptWasModified() {
		runner(V1).migrate();
		MigrationScript tampered = MigrationScript.fromFile("V001__first.sql", V1.sql() + "\n-- edited\n");

		assertThatThrownBy(() -> runner(tampered, V2).migrate()).isInstanceOf(MigrationException.class)
			.hasMessageContaining("Checksum mismatch");
		assertThat(appliedVersions()).containsExactly(1);
	}

	@Test
	void abortsWhenTheDatabaseIsNewerThanTheApplication() {
		runner(V1, V2).migrate();

		assertThatThrownBy(() -> runner(V1).migrate()).isInstanceOf(MigrationException.class)
			.hasMessageContaining("newer than this application supports");
	}

	@Test
	void rollsBackAFailedScriptCompletely() {
		runner(V1).migrate();
		MigrationScript broken = MigrationScript.fromFile("V002__broken.sql",
				"CREATE TABLE half_done (id INTEGER PRIMARY KEY);\nINSERT INTO missing_table (id) VALUES (1);\n");

		assertThatThrownBy(() -> runner(V1, broken).migrate()).isInstanceOf(MigrationException.class)
			.hasMessageContaining("rolled back");
		assertThat(tableExists("half_done")).isFalse();
		assertThat(appliedVersions()).containsExactly(1);
	}

	@Test
	void backsUpAnExistingDatabaseBeforeUpgrading() throws IOException {
		runner(V1).migrate();
		assertThat(tempDir.resolve("backups")).doesNotExist();

		runner(V1, V2).migrate();

		try (Stream<Path> backups = Files.list(tempDir.resolve("backups"))) {
			List<Path> files = backups.toList();
			assertThat(files).hasSize(1);
			assertThat(files.get(0).getFileName().toString()).startsWith("pre-migration-v1-");
			try (HikariDataSource backup = DatabaseConfig.createDataSource(files.get(0))) {
				JdbcClient backupJdbc = JdbcClient.create(backup);
				assertThat(backupJdbc.sql("SELECT COUNT(*) FROM one").query(Integer.class).single()).isEqualTo(1);
				assertThat(backupJdbc.sql("SELECT COUNT(*) FROM sqlite_master WHERE name = 'two'")
					.query(Integer.class)
					.single()).isZero();
			}
		}
	}

	/** One row of everything the first release stored, written at schema version 1. */
	private void populateVersionOne() {
		jdbc.sql("INSERT INTO categories (id, name, normalized_name, color, created_at, updated_at) "
				+ "VALUES ('c1', 'Work', 'work', '#668BE8', 'now', 'now')").update();
		jdbc.sql("INSERT INTO tasks (id, title, category_id, priority, status, planned_date, completed_at, created_at, updated_at) "
				+ "VALUES ('t1', 'Done task', 'c1', 'HIGH', 'DONE', '2026-10-01', '2026-10-01T15:00:00Z', 'now', 'now')").update();
		jdbc.sql("INSERT INTO tasks (id, title, priority, status, planned_date, created_at, updated_at) "
				+ "VALUES ('t2', 'Open task', 'LOW', 'PENDING', '2026-10-02', 'now', 'now')").update();
		jdbc.sql("INSERT INTO task_activity (id, task_id, action, occurred_at) VALUES ('a1', 't1', 'CREATED', 'now')").update();
		jdbc.sql("INSERT INTO books (id, title, author, total_pages, initial_page, status, created_at, updated_at) "
				+ "VALUES ('b1', 'Dune', 'Frank Herbert', 600, 10, 'READING', 'now', 'now')").update();
		jdbc.sql("INSERT INTO reading_sessions (id, book_id, activity_date, pages_read, ending_page, notes, created_at, updated_at) "
				+ "VALUES ('s1', 'b1', '2026-10-01', 25, 35, 'good', 'now', 'now')").update();
		jdbc.sql("INSERT INTO reading_goals (effective_date, target_pages, updated_at) VALUES ('2026-09-01', 40, 'now')").update();
		jdbc.sql("INSERT INTO calendar_events (id, title, all_day, starts_at, ends_at, timezone, created_at, updated_at) "
				+ "VALUES ('e1', 'Dentist', 0, '2026-10-03T13:00:00Z', '2026-10-03T14:00:00Z', 'America/Sao_Paulo', 'now', 'now')").update();
		jdbc.sql("INSERT INTO calendar_events (id, title, all_day, start_date, end_date_exclusive, created_at, updated_at) "
				+ "VALUES ('e2', 'Trip', 1, '2026-10-05', '2026-10-08', 'now', 'now')").update();
		jdbc.sql("INSERT INTO daily_reviews (id, review_date, wins, obstacles, tomorrow_priority, created_at, updated_at) "
				+ "VALUES ('r1', '2026-10-01', 'shipped', 'none', 'rest', 'now', 'now')").update();
		jdbc.sql("INSERT INTO settings (key, value, updated_at) VALUES ('timezone', 'America/Sao_Paulo', 'now')").update();
	}

	private List<String> everythingStored() {
		return Stream.of("categories", "tasks", "task_activity", "books", "reading_sessions", "reading_goals",
				"calendar_events", "daily_reviews", "settings")
			.map(table -> table + ": " + jdbc.sql("SELECT * FROM " + table + " ORDER BY 1").query((rs, row) -> {
				StringBuilder line = new StringBuilder();
				for (int column = 1; column <= rs.getMetaData().getColumnCount(); column++) {
					line.append(rs.getString(column)).append('|');
				}
				return line.toString();
			}).list())
			.toList();
	}

	@Test
	void aPopulatedDatabaseKeepsEveryRowThroughTheUpgradeToTheShippedSchema() {
		List<MigrationScript> shipped = MigrationScript.loadAll(DatabaseConfig.MIGRATION_LOCATION);
		new MigrationRunner(dataSource, tempDir.resolve("backups"), CLOCK,
				shipped.stream().filter(script -> script.version() == 1).toList())
			.migrate();
		populateVersionOne();
		List<String> before = everythingStored();

		new MigrationRunner(dataSource, tempDir.resolve("backups"), CLOCK, shipped).migrate();

		assertThat(everythingStored()).isEqualTo(before);
		assertThat(jdbc.sql("PRAGMA integrity_check").query(String.class).single()).isEqualTo("ok");
		assertThat(jdbc.sql("PRAGMA foreign_key_check").query((rs, row) -> rs.getString(1)).list()).isEmpty();
		assertThat(appliedVersions()).containsExactly(shipped.stream().map(MigrationScript::version).toArray(Integer[]::new));
	}

	@Test
	void aFailedUpgradeLeavesTheDataAndABackupOfItIntact() throws IOException {
		List<MigrationScript> shipped = MigrationScript.loadAll(DatabaseConfig.MIGRATION_LOCATION);
		new MigrationRunner(dataSource, tempDir.resolve("backups"), CLOCK, shipped).migrate();
		populateVersionOne();
		List<String> before = everythingStored();
		int next = shipped.stream().mapToInt(MigrationScript::version).max().orElseThrow() + 1;
		MigrationScript broken = MigrationScript.fromFile("V%03d__broken.sql".formatted(next),
				"DELETE FROM tasks;\nINSERT INTO missing_table (id) VALUES (1);\n");
		List<MigrationScript> withBroken = Stream.concat(shipped.stream(), Stream.of(broken)).toList();

		assertThatThrownBy(() -> new MigrationRunner(dataSource, tempDir.resolve("backups"), CLOCK, withBroken).migrate())
			.isInstanceOf(MigrationException.class);

		assertThat(everythingStored()).isEqualTo(before);
		try (Stream<Path> backups = Files.list(tempDir.resolve("backups"))) {
			Path backup = backups.filter(path -> path.getFileName().toString().startsWith("pre-migration-"))
				.findFirst()
				.orElseThrow();
			try (HikariDataSource copy = DatabaseConfig.createDataSource(backup)) {
				assertThat(JdbcClient.create(copy).sql("SELECT COUNT(*) FROM tasks").query(Integer.class).single()).isEqualTo(2);
			}
		}
	}

	@Test
	void checksumIgnoresLineEndingDifferences() {
		MigrationScript crlf = MigrationScript.fromFile("V001__first.sql", V1.sql().replace("\n", "\r\n"));

		assertThat(crlf.checksum()).isEqualTo(V1.checksum());
	}

}
