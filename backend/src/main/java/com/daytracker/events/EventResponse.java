package com.daytracker.events;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * An event as the API returns it. Timed events carry instants (for display in
 * any zone) and the wall-clock start and end in their own zone (for editing);
 * all-day events carry dates only. A repeating event is returned as stored, its
 * first occurrence; lists of a date range carry each occurrence instead.
 */
public record EventResponse(UUID id, String title, String notes, UUID categoryId, boolean allDay, Instant startsAt,
		Instant endsAt, String timezone, LocalDateTime localStart, LocalDateTime localEnd, LocalDate startDate,
		LocalDate endDateExclusive, String repeat, LocalDate repeatUntil, List<LocalDate> repeatDates,
		List<DayOfWeek> repeatWeekdays, List<String> links, boolean overlapsAnother, Instant createdAt, Instant updatedAt, long version) {

	public static EventResponse from(CalendarEvent event) {
		return new EventResponse(event.id(), event.title(), event.notes(), event.categoryId(), event.allDay(),
				event.startsAt(), event.endsAt(), event.timezone(), event.localStart(), event.localEnd(),
				event.startDate(), event.endDateExclusive(), event.repeatRule(), event.repeatUntil(),
				event.repeatDates(), event.repeatWeekdays(), event.links(), event.overlapsAnother(), event.createdAt(),
				event.updatedAt(), event.version());
	}

}
