package com.daytracker.reading;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.daytracker.common.Timestamps;

@Repository
public class ReadingSessionRepository {

	private static final String SELECT = """
			SELECT s.id, s.book_id, b.title AS book_title, s.activity_date, s.pages_read, s.ending_page, s.notes,
			    s.created_at, s.updated_at, s.version
			FROM reading_sessions s JOIN books b ON b.id = s.book_id""";

	private final JdbcClient jdbc;

	public ReadingSessionRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/** Includes deleted sessions, so a delete can be repeated safely. */
	public Optional<ReadingSession> findById(UUID id) {
		return jdbc.sql(SELECT + " WHERE s.id = :id")
			.param("id", id.toString())
			.query(ReadingSessionRepository::mapSession)
			.optional();
	}

	public boolean isDeleted(UUID id) {
		return jdbc.sql("SELECT COUNT(*) FROM reading_sessions WHERE id = :id AND deleted_at IS NOT NULL")
			.param("id", id.toString())
			.query(Integer.class)
			.single() == 1;
	}

	/** Non-deleted sessions, newest date first; any filter may be null. */
	public List<ReadingSession> search(UUID bookId, LocalDate from, LocalDate toExclusive, int limit, long offset) {
		Map<String, Object> params = new HashMap<>();
		String where = where(bookId, from, toExclusive, params);
		params.put("limit", limit);
		params.put("offset", offset);
		return jdbc
			.sql(SELECT + where + " ORDER BY s.activity_date DESC, s.created_at DESC, s.id DESC"
					+ " LIMIT :limit OFFSET :offset")
			.params(params)
			.query(ReadingSessionRepository::mapSession)
			.list();
	}

	public long count(UUID bookId, LocalDate from, LocalDate toExclusive) {
		Map<String, Object> params = new HashMap<>();
		String where = where(bookId, from, toExclusive, params);
		return jdbc.sql("SELECT COUNT(*) FROM reading_sessions s" + where).params(params).query(Long.class).single();
	}

	private static String where(UUID bookId, LocalDate from, LocalDate toExclusive, Map<String, Object> params) {
		StringBuilder where = new StringBuilder(" WHERE s.deleted_at IS NULL");
		if (bookId != null) {
			where.append(" AND s.book_id = :bookId");
			params.put("bookId", bookId.toString());
		}
		if (from != null) {
			where.append(" AND s.activity_date >= :from");
			params.put("from", from.toString());
		}
		if (toExclusive != null) {
			where.append(" AND s.activity_date < :to");
			params.put("to", toExclusive.toString());
		}
		return where.toString();
	}

	/** The sessions of one date in the order they were recorded. */
	public List<ReadingSession> findOnDate(LocalDate date) {
		return jdbc.sql(SELECT + " WHERE s.deleted_at IS NULL AND s.activity_date = :date ORDER BY s.created_at, s.id")
			.param("date", date.toString())
			.query(ReadingSessionRepository::mapSession)
			.list();
	}

	/** Pages read per date, for dates that have non-deleted sessions, in date order. */
	public Map<LocalDate, Long> sumPagesByDate(LocalDate from, LocalDate toExclusive) {
		Map<LocalDate, Long> pages = new LinkedHashMap<>();
		jdbc.sql("""
				SELECT activity_date, SUM(pages_read) AS pages FROM reading_sessions
				WHERE deleted_at IS NULL AND activity_date >= :from AND activity_date < :to
				GROUP BY activity_date ORDER BY activity_date""")
			.param("from", from.toString())
			.param("to", toExclusive.toString())
			.query((row, rowNumber) -> pages.put(LocalDate.parse(row.getString("activity_date")), row.getLong("pages")))
			.list();
		return pages;
	}

	/** One book's pages on one date, with when its cover last changed (null when it has none). */
	public record BookDayPages(LocalDate date, UUID bookId, String bookTitle, long pages, Instant coverUpdatedAt) {
	}

	/** Pages read per date and book, for the calendar: by date, then in the order the books were first read that day. */
	public List<BookDayPages> sumPagesByDateAndBook(LocalDate from, LocalDate toExclusive) {
		return jdbc.sql("""
				SELECT s.activity_date, b.id AS book_id, b.title, SUM(s.pages_read) AS pages, c.updated_at AS cover_updated_at
				FROM reading_sessions s
				JOIN books b ON b.id = s.book_id
				LEFT JOIN book_covers c ON c.book_id = b.id
				WHERE s.deleted_at IS NULL AND s.activity_date >= :from AND s.activity_date < :to
				GROUP BY s.activity_date, b.id
				ORDER BY s.activity_date, MIN(s.created_at), b.id""")
			.param("from", from.toString())
			.param("to", toExclusive.toString())
			.query((row, rowNumber) -> new BookDayPages(LocalDate.parse(row.getString("activity_date")),
					UUID.fromString(row.getString("book_id")), row.getString("title"), row.getLong("pages"),
					Timestamps.parse(row.getString("cover_updated_at"))))
			.list();
	}

	public void insert(ReadingSession session) {
		jdbc.sql("""
				INSERT INTO reading_sessions (id, book_id, activity_date, pages_read, ending_page, notes,
				    created_at, updated_at, deleted_at, version)
				VALUES (:id, :bookId, :activityDate, :pagesRead, :endingPage, :notes,
				    :createdAt, :updatedAt, NULL, :version)""")
			.param("id", session.id().toString())
			.param("bookId", session.bookId().toString())
			.param("activityDate", session.activityDate().toString())
			.param("pagesRead", session.pagesRead())
			.param("endingPage", session.endingPage())
			.param("notes", session.notes())
			.param("createdAt", Timestamps.format(session.createdAt()))
			.param("updatedAt", Timestamps.format(session.updatedAt()))
			.param("version", session.version())
			.update();
	}

	/** @return false when another change got there first, or the session is deleted */
	public boolean update(ReadingSession session, long expectedVersion) {
		return jdbc.sql("""
				UPDATE reading_sessions SET activity_date = :activityDate, pages_read = :pagesRead,
				    ending_page = :endingPage, notes = :notes, updated_at = :updatedAt, version = :version
				WHERE id = :id AND version = :expectedVersion AND deleted_at IS NULL""")
			.param("id", session.id().toString())
			.param("activityDate", session.activityDate().toString())
			.param("pagesRead", session.pagesRead())
			.param("endingPage", session.endingPage())
			.param("notes", session.notes())
			.param("updatedAt", Timestamps.format(session.updatedAt()))
			.param("version", session.version())
			.param("expectedVersion", expectedVersion)
			.update() == 1;
	}

	/** Soft delete: the row stays for diagnosis but no longer counts anywhere. */
	public boolean markDeleted(UUID id, long expectedVersion, Instant deletedAt) {
		return jdbc.sql("""
				UPDATE reading_sessions SET deleted_at = :deletedAt, updated_at = :deletedAt, version = version + 1
				WHERE id = :id AND version = :expectedVersion AND deleted_at IS NULL""")
			.param("id", id.toString())
			.param("deletedAt", Timestamps.format(deletedAt))
			.param("expectedVersion", expectedVersion)
			.update() == 1;
	}

	private static ReadingSession mapSession(ResultSet row, int rowNumber) throws SQLException {
		int endingPage = row.getInt("ending_page");
		return new ReadingSession(UUID.fromString(row.getString("id")), UUID.fromString(row.getString("book_id")),
				row.getString("book_title"), LocalDate.parse(row.getString("activity_date")), row.getInt("pages_read"),
				row.wasNull() ? null : endingPage, row.getString("notes"),
				Timestamps.parse(row.getString("created_at")), Timestamps.parse(row.getString("updated_at")),
				row.getLong("version"));
	}

}
