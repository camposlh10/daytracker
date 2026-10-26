package com.daytracker.reading;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * One reading session. {@code pagesRead} is the effort; {@code endingPage} is an
 * optional position and is never used to derive effort, because re-reading is
 * valid. {@code bookTitle} is read alongside for display and is not stored here.
 */
public record ReadingSession(UUID id, UUID bookId, String bookTitle, LocalDate activityDate, int pagesRead,
		Integer endingPage, String notes, Instant createdAt, Instant updatedAt, long version) {
}
