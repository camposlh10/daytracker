package com.daytracker.reviews;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/** The reflection for one local calendar date. Fields are plain text and may be empty. */
public record DailyReview(UUID id, LocalDate reviewDate, String wins, String obstacles, String tomorrowPriority,
		Instant createdAt, Instant updatedAt, long version) {
}
