package com.daytracker.tasks;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record TaskResponse(UUID id, String title, String description, UUID categoryId, TaskPriority priority,
		TaskStatus status, LocalDate plannedDate, LocalDate deadlineDate, Instant completedAt, Instant archivedAt,
		Instant createdAt, Instant updatedAt, long version) {

	public static TaskResponse from(Task task) {
		return new TaskResponse(task.id(), task.title(), task.description(), task.categoryId(), task.priority(),
				task.status(), task.plannedDate(), task.deadlineDate(), task.completedAt(), task.archivedAt(),
				task.createdAt(), task.updatedAt(), task.version());
	}

}
