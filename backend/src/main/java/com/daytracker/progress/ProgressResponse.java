package com.daytracker.progress;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.daytracker.tasks.TaskResponse;

/**
 * Totals for a reporting interval ({@code from} inclusive, {@code to} exclusive),
 * one entry per date in it, and the records behind the totals.
 *
 * <p>Rates use only the days that have begun ({@code elapsedDays}, counted up to
 * and including {@code today}), so a week still in progress is not judged on days
 * that have not happened, and an interval wholly in the future has no rates at
 * all: they are {@code null} rather than a made-up zero.
 *
 * @param today the current date in the user's timezone
 * @param tasksCompleted tasks currently done whose completion time falls in the interval
 * @param tasksPlanned tasks (not archived) planned on a date in the interval
 * @param pagesRead sum of pages read in non-deleted sessions dated in the interval
 * @param readingDays distinct dates in the interval with pages read greater than zero
 * @param elapsedDays dates of the interval that are today or earlier
 * @param consistencyPercent reading days over elapsed days, or null when none have elapsed
 * @param targetPercent pages read over the targets of the elapsed days, or null when none have elapsed
 * @param completedTasks the completed tasks themselves, oldest first, at most 500
 * @param books the books read in the interval with their position
 */
public record ProgressResponse(LocalDate from, LocalDate to, LocalDate today, long tasksCompleted, long tasksPlanned,
		long pagesRead, int readingDays, int elapsedDays, Integer consistencyPercent, Integer targetPercent,
		List<DayProgress> days, List<TaskResponse> completedTasks, List<BookProgress> books) {

	/**
	 * @param targetPages the reading target in force on that date
	 * @param targetPercent pages over target, uncapped (150 means 50% over); null for a future date
	 */
	public record DayProgress(LocalDate date, long tasksCompleted, long pagesRead, int targetPages,
			Integer targetPercent, boolean future) {
	}

	/**
	 * @param pagesRead pages of this book read in the interval (effort)
	 * @param currentPage the book's position now, derived from its sessions
	 * @param positionPercent position over total pages
	 */
	public record BookProgress(UUID bookId, String title, Instant coverUpdatedAt, long pagesRead, int currentPage,
			int totalPages, int positionPercent) {
	}

}
