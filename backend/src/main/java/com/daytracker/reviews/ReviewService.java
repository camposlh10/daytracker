package com.daytracker.reviews;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.daytracker.common.ApiExceptions.ConflictException;
import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.common.ApiExceptions.NotFoundException;
import com.daytracker.common.Timestamps;
import com.daytracker.settings.ZonePolicy;

/**
 * One review per local date. Saving is explicit: a create sends no version, an
 * update sends the version it loaded, and anything else is a conflict, so two
 * windows or a retried request can never silently overwrite a newer review.
 */
@Service
public class ReviewService {

	static final int MAX_FIELD_LENGTH = 5_000;

	public record SaveRequest(Long version, String wins, String obstacles, String tomorrowPriority) {
	}

	private final JdbcClient jdbc;

	private final Clock clock;

	private final ZonePolicy zonePolicy;

	public ReviewService(JdbcClient jdbc, Clock clock, ZonePolicy zonePolicy) {
		this.jdbc = jdbc;
		this.clock = clock;
		this.zonePolicy = zonePolicy;
	}

	@Transactional(readOnly = true)
	public Optional<DailyReview> find(LocalDate date) {
		return jdbc.sql("""
				SELECT id, review_date, wins, obstacles, tomorrow_priority, created_at, updated_at, version
				FROM daily_reviews WHERE review_date = :date""")
			.param("date", date.toString())
			.query(ReviewService::mapReview)
			.optional();
	}

	@Transactional(readOnly = true)
	public DailyReview get(LocalDate date) {
		return find(date).orElseThrow(() -> new NotFoundException("No review has been written for this date."));
	}

	@Transactional
	public DailyReview save(LocalDate date, SaveRequest request) {
		if (date.isAfter(LocalDate.now(clock.withZone(zonePolicy.zone())))) {
			throw new InvalidInputException("date", "A review can only be written for today or an earlier day.");
		}
		String wins = clean(request.wins(), "wins");
		String obstacles = clean(request.obstacles(), "obstacles");
		String tomorrowPriority = clean(request.tomorrowPriority(), "tomorrowPriority");
		Instant now = Timestamps.truncate(clock.instant());
		Optional<DailyReview> existing = find(date);

		if (existing.isEmpty()) {
			if (request.version() != null) {
				throw new ConflictException("This review no longer exists. Reload the day and try again.");
			}
			DailyReview created = new DailyReview(UUID.randomUUID(), date, wins, obstacles, tomorrowPriority, now, now,
					1);
			jdbc.sql("""
					INSERT INTO daily_reviews (id, review_date, wins, obstacles, tomorrow_priority,
					    created_at, updated_at, version)
					VALUES (:id, :date, :wins, :obstacles, :tomorrow, :now, :now, 1)""")
				.param("id", created.id().toString())
				.param("date", date.toString())
				.param("wins", wins)
				.param("obstacles", obstacles)
				.param("tomorrow", tomorrowPriority)
				.param("now", Timestamps.format(now))
				.update();
			return created;
		}

		DailyReview current = existing.get();
		if (request.version() == null || current.version() != request.version()) {
			throw new ConflictException("The review was changed after it was loaded. Reload it and try again.");
		}
		if (current.wins().equals(wins) && current.obstacles().equals(obstacles)
				&& current.tomorrowPriority().equals(tomorrowPriority)) {
			return current;
		}
		DailyReview updated = new DailyReview(current.id(), date, wins, obstacles, tomorrowPriority,
				current.createdAt(), now, current.version() + 1);
		int rows = jdbc.sql("""
				UPDATE daily_reviews SET wins = :wins, obstacles = :obstacles, tomorrow_priority = :tomorrow,
				    updated_at = :now, version = :version
				WHERE id = :id AND version = :expected""")
			.param("wins", wins)
			.param("obstacles", obstacles)
			.param("tomorrow", tomorrowPriority)
			.param("now", Timestamps.format(now))
			.param("version", updated.version())
			.param("id", current.id().toString())
			.param("expected", current.version())
			.update();
		if (rows != 1) {
			throw new ConflictException("The review was changed after it was loaded. Reload it and try again.");
		}
		return updated;
	}

	private static String clean(String value, String field) {
		String text = value == null ? "" : value;
		if (text.codePointCount(0, text.length()) > MAX_FIELD_LENGTH) {
			throw new InvalidInputException(field, "Each answer is limited to " + MAX_FIELD_LENGTH + " characters.");
		}
		return text.isBlank() ? "" : text;
	}

	private static DailyReview mapReview(ResultSet row, int rowNumber) throws SQLException {
		return new DailyReview(UUID.fromString(row.getString("id")), LocalDate.parse(row.getString("review_date")),
				row.getString("wins"), row.getString("obstacles"), row.getString("tomorrow_priority"),
				Timestamps.parse(row.getString("created_at")), Timestamps.parse(row.getString("updated_at")),
				row.getLong("version"));
	}

}
