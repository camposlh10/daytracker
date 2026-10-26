package com.daytracker.reading;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.common.Timestamps;

/**
 * The daily reading target as a history of effective-dated values. A change
 * applies from its effective date onward and leaves earlier dates on the target
 * that was in force then.
 */
public final class ReadingGoals {

	/** The target before the user sets one. */
	public static final int DEFAULT_TARGET_PAGES = 30;

	static final int MAX_TARGET_PAGES = 5_000;

	private ReadingGoals() {
	}

	public record Goal(LocalDate effectiveDate, int targetPages, Instant updatedAt) {
	}

	/** The target in force on a date; {@code effectiveDate} is null for the built-in default. */
	public record EffectiveGoal(int targetPages, LocalDate effectiveDate) {
	}

	public record SetRequest(@NotNull Integer targetPages) {
	}

	@Service
	public static class GoalService {

		private final JdbcClient jdbc;

		private final Clock clock;

		public GoalService(JdbcClient jdbc, Clock clock) {
			this.jdbc = jdbc;
			this.clock = clock;
		}

		/** Every recorded target, oldest effective date first. */
		@Transactional(readOnly = true)
		public List<Goal> history() {
			return jdbc.sql("SELECT effective_date, target_pages, updated_at FROM reading_goals ORDER BY effective_date")
				.query((row, rowNumber) -> new Goal(LocalDate.parse(row.getString("effective_date")),
						row.getInt("target_pages"), Timestamps.parse(row.getString("updated_at"))))
				.list();
		}

		@Transactional(readOnly = true)
		public EffectiveGoal effectiveOn(LocalDate date) {
			return effectiveOn(date, history());
		}

		/** Resolves the target for a date from an already loaded history. */
		public static EffectiveGoal effectiveOn(LocalDate date, List<Goal> history) {
			Goal inForce = null;
			for (Goal goal : history) {
				if (!goal.effectiveDate().isAfter(date)) {
					inForce = goal;
				}
			}
			return inForce == null ? new EffectiveGoal(DEFAULT_TARGET_PAGES, null)
					: new EffectiveGoal(inForce.targetPages(), inForce.effectiveDate());
		}

		/** Sets the target from the given date; setting the same date again replaces that entry only. */
		@Transactional
		public Goal set(LocalDate effectiveDate, int targetPages) {
			if (targetPages < 1 || targetPages > MAX_TARGET_PAGES) {
				throw new InvalidInputException("targetPages",
						"The daily target must be between 1 and " + MAX_TARGET_PAGES + " pages.");
			}
			Instant now = Timestamps.truncate(clock.instant());
			jdbc.sql("""
					INSERT INTO reading_goals (effective_date, target_pages, updated_at)
					VALUES (:date, :pages, :now)
					ON CONFLICT (effective_date) DO UPDATE SET target_pages = :pages, updated_at = :now""")
				.param("date", effectiveDate.toString())
				.param("pages", targetPages)
				.param("now", Timestamps.format(now))
				.update();
			return new Goal(effectiveDate, targetPages, now);
		}

	}

	@RestController
	public static class GoalController {

		private final GoalService service;

		public GoalController(GoalService service) {
			this.service = service;
		}

		@GetMapping("/api/v1/reading-goals")
		List<Goal> history() {
			return service.history();
		}

		@PutMapping("/api/v1/reading-goals/{effectiveDate}")
		Goal set(@PathVariable LocalDate effectiveDate, @Valid @RequestBody SetRequest request) {
			return service.set(effectiveDate, request.targetPages());
		}

	}

}
