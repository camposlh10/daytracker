package com.daytracker.tasks;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Filters for the task list. Null means "any". {@code plannedFrom} is inclusive and
 * {@code plannedTo} exclusive; {@code scheduled} false selects the unscheduled list;
 * {@code archived} switches between normal and archived tasks.
 */
public record TaskQuery(String text, TaskStatus status, TaskPriority priority, UUID categoryId, LocalDate plannedFrom,
		LocalDate plannedTo, Boolean scheduled, boolean archived) {

	public static TaskQuery active() {
		return new TaskQuery(null, null, null, null, null, null, null, false);
	}

}
