package com.daytracker.events;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * An event as the API returns it. Timed events carry instants (for display in
 * any zone) and the wall-clock start and end in their own zone (for editing);
 * all-day events carry dates only.
 */
public record EventResponse(UUID id, String title, String notes, UUID categoryId, boolean allDay, Instant startsAt,
		Instant endsAt, String timezone, LocalDateTime localStart, LocalDateTime localEnd, LocalDate startDate,
		LocalDate endDateExclusive, boolean overlapsAnother, Instant createdAt, Instant updatedAt, long version) {

	public static EventResponse from(CalendarEvent event) {
		return new EventResponse(event.id(), event.title(), event.notes(), event.categoryId(), event.allDay(),
				event.startsAt(), event.endsAt(), event.timezone(), event.localStart(), event.localEnd(),
				event.startDate(), event.endDateExclusive(), event.overlapsAnother(), event.createdAt(),
				event.updatedAt(), event.version());
	}

}
