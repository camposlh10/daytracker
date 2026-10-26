package com.daytracker.calendar;

import java.time.Instant;
import java.time.LocalDate;

import com.daytracker.events.CalendarEvent;
import com.daytracker.reading.ReadingSessionRepository.BookDayPages;
import com.daytracker.tasks.Task;
import com.daytracker.tasks.TaskPriority;
import com.daytracker.tasks.TaskStatus;

/**
 * One compact entry shown on a calendar date: an appointment, the reading
 * actually recorded on that date (one entry per book read that day), or a
 * planned task. Fields that do not apply to a type are null.
 *
 * @param title the book's title for reading
 * @param status task only
 * @param priority task only
 * @param pagesRead reading only: pages of that book on that date
 * @param bookId reading only
 * @param coverUpdatedAt reading only: when the book's cover last changed, null without a cover
 * @param allDay event only
 * @param startsAt timed event only
 * @param endsAt timed event only
 * @param continued event only: true when the event began on an earlier date
 * @param overlapsAnother event only: true when a timed event overlaps another one
 */
public record CalendarItemResponse(CalendarItemType type, String id, LocalDate date, String title, TaskStatus status,
		TaskPriority priority, Long pagesRead, Boolean allDay, Instant startsAt, Instant endsAt, Boolean continued,
		Boolean overlapsAnother, String bookId, Instant coverUpdatedAt) {

	public enum CalendarItemType {

		EVENT, READING, TASK

	}

	static CalendarItemResponse task(Task task) {
		return new CalendarItemResponse(CalendarItemType.TASK, task.id().toString(), task.plannedDate(), task.title(),
				task.status(), task.priority(), null, null, null, null, null, null, null, null);
	}

	static CalendarItemResponse reading(BookDayPages reading) {
		return new CalendarItemResponse(CalendarItemType.READING, "reading-" + reading.date() + "-" + reading.bookId(),
				reading.date(), reading.bookTitle(), null, null, reading.pages(), null, null, null, null, null,
				reading.bookId().toString(), reading.coverUpdatedAt());
	}

	static CalendarItemResponse event(CalendarEvent event, LocalDate date, LocalDate firstDate) {
		return new CalendarItemResponse(CalendarItemType.EVENT, event.id().toString(), date, event.title(), null, null,
				null, event.allDay(), event.startsAt(), event.endsAt(), date.isAfter(firstDate),
				event.overlapsAnother(), null, null);
	}

}
