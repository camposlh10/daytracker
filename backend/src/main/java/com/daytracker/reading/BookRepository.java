package com.daytracker.reading;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.daytracker.common.Timestamps;
import com.daytracker.reading.Book.BookStatus;

@Repository
public class BookRepository {

	/**
	 * The current page is the ending page of the latest dated, non-deleted session
	 * that recorded one, with creation time and id as tie-breakers; without such a
	 * session it is the initial page. A backdated session therefore never overrides
	 * a newer position. Pages read is the sum of effort and is independent of it.
	 */
	private static final String SELECT = """
			SELECT b.id, b.title, b.author, b.total_pages, b.initial_page, b.status, b.archived_at,
			    b.created_at, b.updated_at, b.version,
			    COALESCE((SELECT s.ending_page FROM reading_sessions s
			              WHERE s.book_id = b.id AND s.deleted_at IS NULL AND s.ending_page IS NOT NULL
			              ORDER BY s.activity_date DESC, s.created_at DESC, s.id DESC LIMIT 1),
			             b.initial_page) AS current_page,
			    COALESCE((SELECT SUM(s.pages_read) FROM reading_sessions s
			              WHERE s.book_id = b.id AND s.deleted_at IS NULL), 0) AS pages_read_total,
			    c.updated_at AS cover_updated_at
			FROM books b LEFT JOIN book_covers c ON c.book_id = b.id""";

	private final JdbcClient jdbc;

	public BookRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	public Optional<Book> findById(UUID id) {
		return jdbc.sql(SELECT + " WHERE b.id = :id").param("id", id.toString()).query(BookRepository::mapBook).optional();
	}

	/** Books currently being read first, then by title. */
	public List<Book> findAll(boolean archived) {
		String where = archived ? " WHERE b.archived_at IS NOT NULL" : " WHERE b.archived_at IS NULL";
		return jdbc.sql(SELECT + where + " " + """
				ORDER BY CASE b.status WHEN 'READING' THEN 0 WHEN 'TO_READ' THEN 1 WHEN 'FINISHED' THEN 2 ELSE 3 END,
				    b.title COLLATE NOCASE, b.id""").query(BookRepository::mapBook).list();
	}

	/** The highest ending page recorded by a non-deleted session, or 0. */
	public int maxRecordedEndingPage(UUID bookId) {
		return jdbc
			.sql("SELECT COALESCE(MAX(ending_page), 0) FROM reading_sessions WHERE book_id = :id AND deleted_at IS NULL")
			.param("id", bookId.toString())
			.query(Integer.class)
			.single();
	}

	public void insert(Book book) {
		jdbc.sql("""
				INSERT INTO books (id, title, author, total_pages, initial_page, status, archived_at,
				    created_at, updated_at, version)
				VALUES (:id, :title, :author, :totalPages, :initialPage, :status, :archivedAt,
				    :createdAt, :updatedAt, :version)""")
			.param("id", book.id().toString())
			.param("title", book.title())
			.param("author", book.author())
			.param("totalPages", book.totalPages())
			.param("initialPage", book.initialPage())
			.param("status", book.status().name())
			.param("archivedAt", timestamp(book.archivedAt()))
			.param("createdAt", timestamp(book.createdAt()))
			.param("updatedAt", timestamp(book.updatedAt()))
			.param("version", book.version())
			.update();
	}

	/** @return false when another change got there first */
	public boolean update(Book book, long expectedVersion) {
		return jdbc.sql("""
				UPDATE books SET title = :title, author = :author, total_pages = :totalPages,
				    initial_page = :initialPage, status = :status, archived_at = :archivedAt,
				    updated_at = :updatedAt, version = :version
				WHERE id = :id AND version = :expectedVersion""")
			.param("id", book.id().toString())
			.param("title", book.title())
			.param("author", book.author())
			.param("totalPages", book.totalPages())
			.param("initialPage", book.initialPage())
			.param("status", book.status().name())
			.param("archivedAt", timestamp(book.archivedAt()))
			.param("updatedAt", timestamp(book.updatedAt()))
			.param("version", book.version())
			.param("expectedVersion", expectedVersion)
			.update() == 1;
	}

	private static Book mapBook(ResultSet row, int rowNumber) throws SQLException {
		return new Book(UUID.fromString(row.getString("id")), row.getString("title"), row.getString("author"),
				row.getInt("total_pages"), row.getInt("initial_page"), BookStatus.valueOf(row.getString("status")),
				Timestamps.parse(row.getString("archived_at")), Timestamps.parse(row.getString("created_at")),
				Timestamps.parse(row.getString("updated_at")), row.getLong("version"), row.getInt("current_page"),
				row.getLong("pages_read_total"), Timestamps.parse(row.getString("cover_updated_at")));
	}

	private static String timestamp(Instant value) {
		return value == null ? null : Timestamps.format(value);
	}

}
