package com.daytracker.reading;

import java.time.Instant;
import java.util.UUID;

/**
 * A book with two values derived from its reading sessions: {@code currentPage}
 * (the position) and {@code pagesReadTotal} (the effort). They are computed when
 * the book is read from the database and are never stored. {@code coverUpdatedAt}
 * is when the cover image last changed, or null when the book has no cover.
 */
public record Book(UUID id, String title, String author, int totalPages, int initialPage, BookStatus status,
		Instant archivedAt, Instant createdAt, Instant updatedAt, long version, int currentPage,
		long pagesReadTotal, Instant coverUpdatedAt) {

	public enum BookStatus {

		TO_READ, READING, FINISHED, ABANDONED

	}

}
