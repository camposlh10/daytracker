package com.daytracker.tasks;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record Task(UUID id, String title, String description, UUID categoryId, TaskPriority priority,
		TaskStatus status, LocalDate plannedDate, LocalDate deadlineDate, Instant completedAt, Instant archivedAt,
		Instant createdAt, Instant updatedAt, long version) {
}
