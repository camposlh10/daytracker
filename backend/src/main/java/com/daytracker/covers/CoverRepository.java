package com.daytracker.covers;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.daytracker.common.Timestamps;

@Repository
public class CoverRepository {

	public enum Source {

		OPEN_LIBRARY, GOOGLE_BOOKS, FILE

	}

	private final JdbcClient jdbc;

	public CoverRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	public Optional<CoverImage> find(UUID bookId) {
		return jdbc.sql("SELECT data, content_type FROM book_covers WHERE book_id = :id")
			.param("id", bookId.toString())
			.query((row, rowNumber) -> new CoverImage(row.getBytes("data"), row.getString("content_type")))
			.optional();
	}

	/** Stores the cover, replacing any earlier one. */
	public void save(UUID bookId, CoverImage image, Source source, String sourceId, Instant now) {
		jdbc.sql("""
				INSERT INTO book_covers (book_id, content_type, data, source, source_id, sha256, updated_at)
				VALUES (:id, :type, :data, :source, :sourceId, :sha, :now)
				ON CONFLICT (book_id) DO UPDATE SET content_type = :type, data = :data, source = :source,
				    source_id = :sourceId, sha256 = :sha, updated_at = :now""")
			.param("id", bookId.toString())
			.param("type", image.contentType())
			.param("data", image.data())
			.param("source", source.name())
			.param("sourceId", sourceId)
			.param("sha", image.sha256())
			.param("now", Timestamps.format(now))
			.update();
	}

	/** @return false when the book had no cover */
	public boolean delete(UUID bookId) {
		return jdbc.sql("DELETE FROM book_covers WHERE book_id = :id").param("id", bookId.toString()).update() == 1;
	}

}
