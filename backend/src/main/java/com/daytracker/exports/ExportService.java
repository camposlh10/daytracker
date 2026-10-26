package com.daytracker.exports;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.common.ApiExceptions.NotFoundException;
import com.daytracker.progress.ProgressResponse;
import com.daytracker.progress.ProgressService;
import com.daytracker.settings.ZonePolicy;

/**
 * CSV exports of the user's records. They are portable reports, not backups:
 * they do not restore anything. Each export is bounded.
 */
@Service
public class ExportService {

	static final int MAX_ROWS = 100_000;

	static final int DEFAULT_SUMMARY_DAYS = 90;

	static final int MAX_SUMMARY_DAYS = 366;

	public record CsvFile(String fileName, byte[] bytes, boolean truncated) {
	}

	private final JdbcClient jdbc;

	private final ProgressService progress;

	private final Clock clock;

	private final ZonePolicy zonePolicy;

	public ExportService(JdbcClient jdbc, ProgressService progress, Clock clock, ZonePolicy zonePolicy) {
		this.jdbc = jdbc;
		this.progress = progress;
		this.clock = clock;
		this.zonePolicy = zonePolicy;
	}

	/** {@code from} and {@code toExclusive} apply to summaries only; they default to the last 90 days. */
	@Transactional(readOnly = true)
	public CsvFile export(String dataset, LocalDate from, LocalDate toExclusive) {
		String stamp = LocalDate.now(clock.withZone(zonePolicy.zone())).toString();
		return switch (dataset.toLowerCase(Locale.ROOT)) {
			case "tasks" -> tasks(stamp);
			case "reading-sessions" -> readingSessions(stamp);
			case "appointments" -> appointments(stamp);
			case "summaries" -> summaries(stamp, from, toExclusive);
			default -> throw new NotFoundException("Unknown export. Choose tasks, reading-sessions, appointments, or summaries.");
		};
	}

	private CsvFile tasks(String stamp) {
		int[] seen = { 0 };
		CsvWriter csv = new CsvWriter(List.of("id", "title", "description", "category", "priority", "status",
				"planned_date", "deadline_date", "completed_at", "archived_at", "created_at", "updated_at"));
		jdbc.sql("""
				SELECT t.id, t.title, t.description, c.name AS category, t.priority, t.status, t.planned_date,
				    t.deadline_date, t.completed_at, t.archived_at, t.created_at, t.updated_at
				FROM tasks t LEFT JOIN categories c ON c.id = t.category_id
				ORDER BY t.created_at, t.id LIMIT :limit""")
			.param("limit", MAX_ROWS + 1)
			.query((row, n) -> {
				seen[0]++;
				if (csv.rows() < MAX_ROWS) {
					csv.row(row.getString("id"), text(row, "title"), text(row, "description"), text(row, "category"),
							row.getString("priority"), row.getString("status"), row.getString("planned_date"),
							row.getString("deadline_date"), row.getString("completed_at"), row.getString("archived_at"),
							row.getString("created_at"), row.getString("updated_at"));
				}
				return null;
			})
			.list();
		return finish("tasks-" + stamp, csv, seen[0]);
	}

	private CsvFile readingSessions(String stamp) {
		int[] seen = { 0 };
		CsvWriter csv = new CsvWriter(List.of("id", "book", "author", "activity_date", "pages_read", "ending_page",
				"notes", "created_at", "updated_at"));
		jdbc.sql("""
				SELECT s.id, b.title AS book, b.author, s.activity_date, s.pages_read, s.ending_page, s.notes,
				    s.created_at, s.updated_at
				FROM reading_sessions s JOIN books b ON b.id = s.book_id
				WHERE s.deleted_at IS NULL
				ORDER BY s.activity_date, s.created_at, s.id LIMIT :limit""")
			.param("limit", MAX_ROWS + 1)
			.query((row, n) -> {
				seen[0]++;
				if (csv.rows() < MAX_ROWS) {
					int ending = row.getInt("ending_page");
					csv.row(row.getString("id"), text(row, "book"), text(row, "author"), row.getString("activity_date"),
							row.getInt("pages_read"), row.wasNull() ? null : ending, text(row, "notes"),
							row.getString("created_at"), row.getString("updated_at"));
				}
				return null;
			})
			.list();
		return finish("reading-sessions-" + stamp, csv, seen[0]);
	}

	private CsvFile appointments(String stamp) {
		int[] seen = { 0 };
		CsvWriter csv = new CsvWriter(List.of("id", "title", "notes", "category", "all_day", "starts_at_utc",
				"ends_at_utc", "timezone", "start_date", "end_date_exclusive", "created_at", "updated_at"));
		jdbc.sql("""
				SELECT e.id, e.title, e.notes, c.name AS category, e.all_day, e.starts_at, e.ends_at, e.timezone,
				    e.start_date, e.end_date_exclusive, e.created_at, e.updated_at
				FROM calendar_events e LEFT JOIN categories c ON c.id = e.category_id
				ORDER BY COALESCE(e.start_date, e.starts_at), e.id LIMIT :limit""")
			.param("limit", MAX_ROWS + 1)
			.query((row, n) -> {
				seen[0]++;
				if (csv.rows() < MAX_ROWS) {
					csv.row(row.getString("id"), text(row, "title"), text(row, "notes"), text(row, "category"),
							row.getInt("all_day") == 1, row.getString("starts_at"), row.getString("ends_at"),
							row.getString("timezone"), row.getString("start_date"), row.getString("end_date_exclusive"),
							row.getString("created_at"), row.getString("updated_at"));
				}
				return null;
			})
			.list();
		return finish("appointments-" + stamp, csv, seen[0]);
	}

	private CsvFile summaries(String stamp, LocalDate from, LocalDate toExclusive) {
		ZoneId zone = zonePolicy.zone();
		LocalDate today = LocalDate.now(clock.withZone(zone));
		LocalDate start = from == null ? today.minusDays(DEFAULT_SUMMARY_DAYS - 1) : from;
		LocalDate end = toExclusive == null ? today.plusDays(1) : toExclusive;
		if (!end.isAfter(start)) {
			throw new InvalidInputException("to", "The end date must be after the start date.");
		}
		if (ChronoUnit.DAYS.between(start, end) > MAX_SUMMARY_DAYS) {
			throw new InvalidInputException("to", "A summary export is limited to " + MAX_SUMMARY_DAYS + " days.");
		}
		ProgressResponse report = progress.progress(start, end);
		CsvWriter csv = new CsvWriter(List.of("date", "tasks_completed", "pages_read", "reading_target",
				"target_percent"));
		for (ProgressResponse.DayProgress day : report.days()) {
			csv.row(day.date(), day.tasksCompleted(), day.pagesRead(), day.targetPages(), day.targetPercent());
		}
		return new CsvFile("summaries-" + start + "-to-" + end.minusDays(1) + "-exported-" + stamp + ".csv",
				csv.bytes(), false);
	}

	private static String text(java.sql.ResultSet row, String column) throws java.sql.SQLException {
		return row.getString(column);
	}

	private static CsvFile finish(String name, CsvWriter csv, int rowsInDatabase) {
		return new CsvFile(name + ".csv", csv.bytes(), rowsInDatabase > MAX_ROWS);
	}

}
