package com.daytracker.tasks;

import java.time.Instant;
import java.time.LocalDate;

/** One entry of a task's history. Status and date fields are set only for the changes they describe. */
public record TaskActivityResponse(String action, TaskStatus previousStatus, TaskStatus newStatus,
		LocalDate previousPlannedDate, LocalDate newPlannedDate, Instant occurredAt) {
}
