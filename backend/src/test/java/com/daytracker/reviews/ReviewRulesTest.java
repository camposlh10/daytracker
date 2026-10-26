package com.daytracker.reviews;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.daytracker.MutableClock;
import com.daytracker.common.ApiExceptions.ConflictException;
import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.common.ApiExceptions.NotFoundException;
import com.daytracker.database.DatabaseConfig;
import com.daytracker.database.MigrationRunner;
import com.daytracker.database.MigrationScript;
import com.daytracker.settings.ZonePolicy;

class ReviewRulesTest {

	private static final ZoneId ZONE = ZoneId.of("America/Sao_Paulo");

	private static final LocalDate MONDAY = LocalDate.parse("2026-10-05");

	@TempDir
	Path tempDir;

	// 2026-10-05 09:00 in Sao Paulo.
	private final MutableClock clock = new MutableClock(Instant.parse("2026-10-05T12:00:00Z"));

	private HikariDataSource dataSource;

	private ReviewService reviews;

	@BeforeEach
	void openDatabase() {
		dataSource = DatabaseConfig.createDataSource(tempDir.resolve("db").resolve("test.db"));
		new MigrationRunner(dataSource, tempDir.resolve("backups"), clock,
				MigrationScript.loadAll("classpath:db/migration/V*__*.sql"))
			.migrate();
		reviews = new ReviewService(JdbcClient.create(dataSource), clock, ZonePolicy.fixed(ZONE));
	}

	@AfterEach
	void closeDatabase() {
		dataSource.close();
	}

	@Test
	void aReviewIsCreatedOnceAndThenEditedWithItsVersion() {
		assertThat(reviews.find(MONDAY)).isEmpty();
		assertThatThrownBy(() -> reviews.get(MONDAY)).isInstanceOf(NotFoundException.class);

		DailyReview created = reviews.save(MONDAY, new ReviewService.SaveRequest(null, "Shipped it", null, "Rest"));
		assertThat(created.version()).isEqualTo(1);
		assertThat(created.obstacles()).isEmpty();
		assertThat(created.createdAt()).isEqualTo(created.updatedAt());

		clock.advance(Duration.ofHours(10));
		DailyReview edited = reviews.save(MONDAY,
				new ReviewService.SaveRequest(1L, "Shipped it", "Slow build", "Rest"));
		assertThat(edited.version()).isEqualTo(2);
		assertThat(edited.createdAt()).isEqualTo(created.createdAt());
		assertThat(edited.updatedAt()).isAfter(created.updatedAt());
		assertThat(reviews.get(MONDAY)).isEqualTo(edited);

		// Saving the same text again changes nothing.
		assertThat(reviews.save(MONDAY, new ReviewService.SaveRequest(2L, "Shipped it", "Slow build", "Rest"))
			.version()).isEqualTo(2);
	}

	@Test
	void aStaleOrDuplicateSaveIsRefusedAndChangesNothing() {
		reviews.save(MONDAY, new ReviewService.SaveRequest(null, "First", "", ""));
		reviews.save(MONDAY, new ReviewService.SaveRequest(1L, "Second", "", ""));

		// Another window still holding version 1.
		assertThatThrownBy(() -> reviews.save(MONDAY, new ReviewService.SaveRequest(1L, "Older", "", "")))
			.isInstanceOf(ConflictException.class);
		// A second "first save" for a date that already has a review.
		assertThatThrownBy(() -> reviews.save(MONDAY, new ReviewService.SaveRequest(null, "Duplicate", "", "")))
			.isInstanceOf(ConflictException.class);
		// An update for a review that does not exist.
		assertThatThrownBy(() -> reviews.save(MONDAY.minusDays(1), new ReviewService.SaveRequest(4L, "Ghost", "", "")))
			.isInstanceOf(ConflictException.class);

		assertThat(reviews.get(MONDAY).wins()).isEqualTo("Second");
	}

	@Test
	void historicalReviewsCanBeWrittenButFutureOnesCannot() {
		assertThat(reviews.save(LocalDate.parse("2025-12-31"), new ReviewService.SaveRequest(null, "Old", "", ""))
			.reviewDate()).isEqualTo(LocalDate.parse("2025-12-31"));
		assertThatThrownBy(() -> reviews.save(MONDAY.plusDays(1), new ReviewService.SaveRequest(null, "Soon", "", "")))
			.isInstanceOf(InvalidInputException.class);

		// Late on Monday in Sao Paulo it is already Tuesday in UTC, but still Monday locally.
		clock.set(Instant.parse("2026-10-06T02:30:00Z"));
		assertThatThrownBy(() -> reviews.save(MONDAY.plusDays(1), new ReviewService.SaveRequest(null, "Soon", "", "")))
			.isInstanceOf(InvalidInputException.class);
	}

	@Test
	void fieldsAreLimitedTo5000CharactersAndKeptAsPlainText() {
		String markup = "<b>bold</b> & <script>x</script>";
		assertThat(reviews.save(MONDAY, new ReviewService.SaveRequest(null, markup, "x".repeat(5000), "")).wins())
			.isEqualTo(markup);
		assertThatThrownBy(() -> reviews.save(MONDAY.minusDays(1),
				new ReviewService.SaveRequest(null, "", "", "y".repeat(5001))))
			.isInstanceOf(InvalidInputException.class);
	}

}
