package com.daytracker.categories;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.daytracker.MutableClock;
import com.daytracker.common.ApiExceptions.ConflictException;
import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.database.DatabaseConfig;
import com.daytracker.database.MigrationRunner;
import com.daytracker.database.MigrationScript;

class CategoryServiceTest {

	@TempDir
	Path tempDir;

	private final MutableClock clock = new MutableClock(Instant.parse("2026-10-05T12:00:00Z"));

	private HikariDataSource dataSource;

	private CategoryService categories;

	@BeforeEach
	void openDatabase() {
		dataSource = DatabaseConfig.createDataSource(tempDir.resolve("db").resolve("test.db"));
		new MigrationRunner(dataSource, tempDir.resolve("backups"), clock,
				MigrationScript.loadAll("classpath:db/migration/V*__*.sql"))
			.migrate();
		categories = new CategoryService(new CategoryRepository(JdbcClient.create(dataSource)), clock);
	}

	@AfterEach
	void closeDatabase() {
		dataSource.close();
	}

	private Category create(String name, String color) {
		return categories.create(new CategoryRequests.Create(UUID.randomUUID(), name, color)).category();
	}

	@Test
	void namesAreTrimmedAndUniqueIgnoringCaseEvenWhenArchived() {
		Category work = create("  Deep   Work ", "#668be8");
		assertThat(work.name()).isEqualTo("Deep Work");
		assertThat(work.color()).isEqualTo("#668BE8");

		assertThatThrownBy(() -> create("deep work", "#000000")).isInstanceOf(ConflictException.class)
			.hasMessageContaining("already exists");

		categories.update(work.id(), new CategoryRequests.Update(1L, null, null, true));
		assertThatThrownBy(() -> create("DEEP WORK", "#000000")).isInstanceOf(ConflictException.class)
			.hasMessageContaining("archived");
	}

	@Test
	void createIsIdempotentForTheSameIdAndPayload() {
		UUID id = UUID.randomUUID();
		CategoryRequests.Create request = new CategoryRequests.Create(id, "Health", "#7FD1A0");

		assertThat(categories.create(request).created()).isTrue();
		assertThat(categories.create(request).created()).isFalse();
		assertThatThrownBy(() -> categories.create(new CategoryRequests.Create(id, "Fitness", "#7FD1A0")))
			.isInstanceOf(ConflictException.class);
		assertThat(categories.list()).hasSize(1);
	}

	@Test
	void renameRecolorArchiveAndRestoreUseVersions() {
		Category category = create("Home", "#E9C46A");
		create("Work", "#668BE8");
		UUID id = category.id();

		Category renamed = categories.update(id, new CategoryRequests.Update(1L, "House", "#112233", null));
		assertThat(renamed.name()).isEqualTo("House");
		assertThat(renamed.color()).isEqualTo("#112233");
		assertThat(renamed.version()).isEqualTo(2);

		// Changing only the letter case of its own name is allowed.
		assertThat(categories.update(id, new CategoryRequests.Update(2L, "HOUSE", null, null)).name())
			.isEqualTo("HOUSE");

		assertThatThrownBy(() -> categories.update(id, new CategoryRequests.Update(1L, "Stale", null, null)))
			.isInstanceOf(ConflictException.class);
		assertThatThrownBy(() -> categories.update(id, new CategoryRequests.Update(3L, "work", null, null)))
			.isInstanceOf(ConflictException.class);

		Category archived = categories.update(id, new CategoryRequests.Update(3L, null, null, true));
		assertThat(archived.archivedAt()).isNotNull();
		assertThat(categories.update(id, new CategoryRequests.Update(4L, null, null, false)).archivedAt()).isNull();
	}

	@Test
	void rejectsInvalidNamesAndColors() {
		assertThatThrownBy(() -> create("   ", "#668BE8")).isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> create("x".repeat(51), "#668BE8")).isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> create("Ok", "blue")).isInstanceOf(InvalidInputException.class);
	}

}
