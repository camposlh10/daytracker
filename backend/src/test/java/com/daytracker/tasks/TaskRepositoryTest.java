package com.daytracker.tasks;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.daytracker.database.DatabaseConfig;
import com.daytracker.database.MigrationRunner;
import com.daytracker.database.MigrationScript;

class TaskRepositoryTest {

	private static final Instant NOW = Instant.parse("2026-10-04T12:00:00Z");

	@TempDir
	Path tempDir;

	private HikariDataSource dataSource;

	private TaskRepository repository;

	@BeforeEach
	void openDatabase() {
		open();
		new MigrationRunner(dataSource, tempDir.resolve("backups"), Clock.systemUTC(),
				MigrationScript.loadAll("classpath:db/migration/V*__*.sql"))
			.migrate();
	}

	@AfterEach
	void closeDatabase() {
		dataSource.close();
	}

	private void open() {
		dataSource = DatabaseConfig.createDataSource(tempDir.resolve("db").resolve("test.db"));
		repository = new TaskRepository(JdbcClient.create(dataSource));
	}

	private static Task task(TaskStatus status, Instant completedAt) {
		return new Task(UUID.randomUUID(), "Write the report", "Quarterly numbers", null, TaskPriority.HIGH, status,
				LocalDate.parse("2026-10-05"), null, completedAt, null, NOW, NOW, 1);
	}

	@Test
	void savedTaskIsReadBackAfterTheDatabaseIsReopened() {
		Task task = task(TaskStatus.PENDING, null);
		repository.insert(task);

		dataSource.close();
		open();

		assertThat(repository.findById(task.id())).contains(task);
		assertThat(repository.search(TaskQuery.active(), 10, 0)).containsExactly(task);
		assertThat(repository.count(TaskQuery.active())).isEqualTo(1);
	}

	@Test
	void completedAtIsRequiredExactlyForDoneTasks() {
		assertThatThrownBy(() -> repository.insert(task(TaskStatus.DONE, null)))
			.isInstanceOf(DataAccessException.class);
		assertThatThrownBy(() -> repository.insert(task(TaskStatus.PENDING, NOW)))
			.isInstanceOf(DataAccessException.class);

		repository.insert(task(TaskStatus.DONE, NOW));
		assertThat(repository.count(TaskQuery.active())).isEqualTo(1);
	}

	@Test
	void updateIsRefusedWhenTheStoredVersionHasMovedOn() {
		Task task = task(TaskStatus.PENDING, null);
		repository.insert(task);
		Task edited = new Task(task.id(), "Edited", null, null, TaskPriority.LOW, TaskStatus.PENDING, null, null, null,
				null, NOW, NOW, 2);

		assertThat(repository.update(edited, 1)).isTrue();
		assertThat(repository.update(edited, 1)).isFalse();
		assertThat(repository.findById(task.id())).contains(edited);
	}

	@Test
	void searchTreatsWildcardCharactersLiterally() {
		repository.insert(new Task(UUID.randomUUID(), "100% done_deal", null, null, TaskPriority.LOW,
				TaskStatus.PENDING, null, null, null, null, NOW, NOW, 1));
		repository.insert(task(TaskStatus.PENDING, null));

		assertThat(repository.count(new TaskQuery("%", null, null, null, null, null, null, false))).isEqualTo(1);
		assertThat(repository.count(new TaskQuery("_", null, null, null, null, null, null, false))).isEqualTo(1);
		assertThat(repository.count(new TaskQuery("REPORT", null, null, null, null, null, null, false))).isEqualTo(1);
		assertThat(repository.count(new TaskQuery("quarterly", null, null, null, null, null, null, false)))
			.isEqualTo(1);
	}

	@Test
	void foreignKeysAreEnforced() {
		assertThatThrownBy(() -> repository.insertActivity(UUID.randomUUID(), "CREATED", null, TaskStatus.PENDING,
				null, null, NOW))
			.isInstanceOf(DataAccessException.class);
	}

}
