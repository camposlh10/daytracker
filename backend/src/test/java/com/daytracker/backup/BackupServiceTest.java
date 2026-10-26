package com.daytracker.backup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.ObjectMapper;

import com.daytracker.MutableClock;
import com.daytracker.backup.BackupInfo.Kind;
import com.daytracker.config.AppProperties;
import com.daytracker.database.DatabaseConfig;
import com.daytracker.database.MigrationRunner;
import com.daytracker.database.MigrationScript;
import com.daytracker.settings.ZonePolicy;

/** Backups and restore checks against real SQLite files. */
class BackupServiceTest {

	private static final String TOKEN = "test-launch-token-0123456789abcdef0123456789";

	@TempDir
	Path tempDir;

	private final MutableClock clock = new MutableClock(Instant.parse("2026-10-25T15:00:00Z"));

	private AppProperties properties;

	private HikariDataSource dataSource;

	private JdbcClient jdbc;

	private BackupService backups;

	@BeforeEach
	void setUp() {
		properties = new AppProperties(tempDir.toString(), TOKEN, false);
		dataSource = DatabaseConfig.createDataSource(properties.databaseFile());
		new MigrationRunner(dataSource, properties.backupsDir(), clock,
				MigrationScript.loadAll("classpath:db/migration/V*__*.sql"))
			.migrate();
		jdbc = JdbcClient.create(dataSource);
		backups = new BackupService(dataSource, properties, clock, ZonePolicy.fixed(ZoneId.of("America/Sao_Paulo")),
				new ObjectMapper(), "1.2.3");
	}

	@AfterEach
	void tearDown() {
		dataSource.close();
	}

	private void addTask(String title) {
		jdbc.sql("INSERT INTO tasks (id, title, priority, status, created_at, updated_at) "
				+ "VALUES (:id, :title, 'MEDIUM', 'PENDING', 'now', 'now')")
			.param("id", java.util.UUID.randomUUID().toString())
			.param("title", title)
			.update();
	}

	private static long countIn(Path file, String table) throws Exception {
		try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + file.toAbsolutePath());
				Statement statement = connection.createStatement();
				var rows = statement.executeQuery("SELECT COUNT(*) FROM " + table)) {
			rows.next();
			return rows.getLong(1);
		}
	}

	private Path stage(Path source, String name) throws IOException {
		Files.createDirectories(properties.stagingDir());
		return Files.copy(source, properties.stagingDir().resolve(name));
	}

	@Test
	void aBackupIsAConsistentVerifiedSnapshotWithMetadata() throws Exception {
		addTask("First");
		addTask("Second");

		BackupInfo info = backups.backupNow();

		assertThat(info.kind()).isEqualTo(Kind.MANUAL);
		assertThat(info.verified()).isTrue();
		assertThat(info.schemaVersion()).isEqualTo(3);
		assertThat(info.appVersion()).isEqualTo("1.2.3");
		assertThat(info.sizeBytes()).isPositive();
		Path file = properties.backupsDir().resolve(info.name());
		assertThat(countIn(file, "tasks")).isEqualTo(2);
		// The finished file stands alone: no write-ahead log files and no temporary file.
		try (var files = Files.list(properties.backupsDir())) {
			assertThat(files.map(path -> path.getFileName().toString()).toList()).noneMatch(name -> name.endsWith(".tmp")
					|| name.endsWith("-wal") || name.endsWith("-shm"));
		}
		assertThat(backups.status().lastAttempt().ok()).isTrue();
		assertThat(backups.list()).extracting(BackupInfo::name).contains(info.name());
	}

	@Test
	void aBackupKeepsWorkingAfterTheOriginalChanges() throws Exception {
		addTask("Before");
		BackupInfo info = backups.backupNow();
		addTask("After");

		assertThat(countIn(properties.backupsDir().resolve(info.name()), "tasks")).isEqualTo(1);
		assertThat(countIn(properties.databaseFile(), "tasks")).isEqualTo(2);
	}

	@Test
	void aFailedBackupLeavesNothingBehindAndIsReportedAsFailed() throws Exception {
		// A file where the folder should be makes writing impossible.
		if (Files.isDirectory(properties.backupsDir())) {
			try (var files = Files.list(properties.backupsDir())) {
				files.forEach(path -> path.toFile().delete());
			}
			Files.delete(properties.backupsDir());
		}
		Files.writeString(properties.backupsDir(), "not a folder");

		assertThatThrownBy(() -> backups.backupNow()).isInstanceOf(BackupException.class)
			.hasMessageContaining("could not be written");

		BackupService.Attempt attempt = backups.status().lastAttempt();
		assertThat(attempt.ok()).isFalse();
		assertThat(attempt.message()).contains("could not be written");
		Files.delete(properties.backupsDir());
	}

	@Test
	void anAutomaticBackupIsMadeOncePerDayAndOnlyTheNewestSevenAreKept() throws Exception {
		addTask("Daily");

		backups.automaticBackupIfDue();
		backups.automaticBackupIfDue();
		assertThat(backups.list().stream().filter(info -> info.kind() == Kind.AUTOMATIC)).hasSize(1);

		for (int day = 1; day <= 9; day++) {
			clock.advance(Duration.ofDays(1));
			backups.automaticBackupIfDue();
		}

		List<BackupInfo> automatic = backups.list().stream().filter(info -> info.kind() == Kind.AUTOMATIC).toList();
		assertThat(automatic).hasSize(7);
		// Ten days were backed up (25 Oct to 3 Nov); the oldest three are gone along with their metadata.
		assertThat(automatic.get(0).name()).isEqualTo("auto-20261103.db");
		assertThat(automatic.get(6).name()).isEqualTo("auto-20261028.db");
		assertThat(properties.backupsDir().resolve("auto-20261027.db")).doesNotExist();
		assertThat(properties.backupsDir().resolve("auto-20261025.db.json")).doesNotExist();
	}

	@Test
	void theDayOfAnAutomaticBackupFollowsTheConfiguredTimezone() {
		// 02:00 UTC on the 26th is still the evening of the 25th in Sao Paulo.
		clock.set(Instant.parse("2026-10-26T02:00:00Z"));

		backups.automaticBackupIfDue();

		assertThat(backups.list()).extracting(BackupInfo::name).contains("auto-20261025.db");
	}

	@Test
	void manualSafetyAndPreMigrationBackupsAreNeverPruned() throws Exception {
		BackupInfo manual = backups.backupNow();
		BackupInfo safety = backups.safetyBackup();
		for (int day = 0; day < 10; day++) {
			clock.advance(Duration.ofDays(1));
			backups.automaticBackupIfDue();
		}

		assertThat(backups.list()).extracting(BackupInfo::name).contains(manual.name(), safety.name());
		assertThat(safety.kind()).isEqualTo(Kind.SAFETY);
		assertThat(backups.list().stream().filter(info -> info.kind() == Kind.AUTOMATIC)).hasSize(7);
	}

	@Test
	void aValidBackupIsAcceptedForRestoreAndDescribed() throws Exception {
		addTask("One");
		BackupInfo info = backups.backupNow();
		stage(properties.backupsDir().resolve(info.name()), "staged-1.db");

		BackupService.RestoreCheck check = backups.validateStaged("staged-1.db");

		assertThat(check.schemaVersion()).isEqualTo(3);
		assertThat(check.newestKnownVersion()).isEqualTo(3);
		assertThat(check.counts()).containsEntry("tasks", 1L).containsEntry("books", 0L);
	}

	@Test
	void anOlderBackupIsAcceptedBecauseTheApplicationUpgradesItOnStart() throws Exception {
		Path older = tempDir.resolve("older.db");
		try (HikariDataSource old = DatabaseConfig.createDataSource(older)) {
			new MigrationRunner(old, tempDir.resolve("older-backups"), clock,
					MigrationScript.loadAll("classpath:db/migration/V*__*.sql").stream().filter(s -> s.version() == 1).toList())
				.migrate();
		}
		stage(older, "staged-2.db");

		assertThat(backups.validateStaged("staged-2.db").schemaVersion()).isEqualTo(1);
	}

	@Test
	void aBackupFromANewerSchemaIsRejected() throws Exception {
		BackupInfo info = backups.backupNow();
		Path staged = stage(properties.backupsDir().resolve(info.name()), "staged-3.db");
		try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + staged.toAbsolutePath());
				Statement statement = connection.createStatement()) {
			statement.execute("INSERT INTO schema_migrations (version, description, checksum, applied_at) "
					+ "VALUES (99, 'future', 'abc', 'now')");
		}

		assertThatThrownBy(() -> backups.validateStaged("staged-3.db")).isInstanceOf(RestoreRejectedException.class)
			.hasMessageContaining("newer version");
	}

	@Test
	void aBackupWhoseMigrationHistoryDoesNotMatchIsRejected() throws Exception {
		BackupInfo info = backups.backupNow();
		Path staged = stage(properties.backupsDir().resolve(info.name()), "staged-4.db");
		try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + staged.toAbsolutePath());
				Statement statement = connection.createStatement()) {
			statement.execute("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1");
		}

		assertThatThrownBy(() -> backups.validateStaged("staged-4.db")).isInstanceOf(RestoreRejectedException.class)
			.hasMessageContaining("does not match");
	}

	@Test
	void damagedAndForeignFilesAreRejectedWithoutTouchingTheLiveDatabase() throws Exception {
		addTask("Safe");
		BackupInfo info = backups.backupNow();
		byte[] bytes = Files.readAllBytes(properties.backupsDir().resolve(info.name()));
		Files.createDirectories(properties.stagingDir());

		// Garbage that is not a database at all.
		Files.writeString(properties.stagingDir().resolve("staged-5.db"), "this is not a database, just text ".repeat(50));
		assertThatThrownBy(() -> backups.validateStaged("staged-5.db")).isInstanceOf(RestoreRejectedException.class);

		// A real database with its middle overwritten.
		byte[] damaged = bytes.clone();
		for (int i = 4096; i < Math.min(damaged.length, 8192); i++) {
			damaged[i] = (byte) 0xFF;
		}
		Files.write(properties.stagingDir().resolve("staged-6.db"), damaged);
		assertThatThrownBy(() -> backups.validateStaged("staged-6.db")).isInstanceOf(RestoreRejectedException.class);

		// A valid SQLite file that is not ours.
		Path foreign = properties.stagingDir().resolve("staged-7.db");
		try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + foreign.toAbsolutePath());
				Statement statement = connection.createStatement()) {
			statement.execute("CREATE TABLE something (id INTEGER)");
		}
		assertThatThrownBy(() -> backups.validateStaged("staged-7.db")).isInstanceOf(RestoreRejectedException.class)
			.hasMessageContaining("not a Day Tracker backup");

		assertThat(countIn(properties.databaseFile(), "tasks")).isEqualTo(1);
	}

	@Test
	void onlyFilesInTheStagingFolderUnderAnExpectedNameAreChecked() {
		for (String name : new String[] { "../daytracker.db", "C:\\Windows\\x.db", "staged-1.db.bak", "other.db", null, "" }) {
			assertThatThrownBy(() -> backups.validateStaged(name)).isInstanceOf(RestoreRejectedException.class);
		}
		assertThatThrownBy(() -> backups.validateStaged("staged-99.db")).isInstanceOf(RestoreRejectedException.class)
			.hasMessageContaining("could not be found");
	}

}
