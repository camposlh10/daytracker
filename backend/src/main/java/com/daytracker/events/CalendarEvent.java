package com.daytracker.events;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

/**
 * An appointment. A timed event has start and end instants and the IANA zone it
 * was entered in. An all-day event has a start date and an exclusive end date and
 * no time of day: it is never converted to midnight timestamps.
 * {@code overlapsAnother} is derived: true when a timed event overlaps another
 * timed event. Overlaps are allowed; the flag only lets the interface point it out.
 */
public record CalendarEvent(UUID id, String title, String notes, UUID categoryId, boolean allDay, Instant startsAt,
		Instant endsAt, String timezone, LocalDate startDate, LocalDate endDateExclusive, Instant createdAt,
		Instant updatedAt, long version, boolean overlapsAnother) {

	/** The start as wall-clock time in the event's own zone, for editing. */
	public LocalDateTime localStart() {
		return allDay ? null : LocalDateTime.ofInstant(startsAt, ZoneId.of(timezone));
	}

	/** The end as wall-clock time in the event's own zone, for editing. */
	public LocalDateTime localEnd() {
		return allDay ? null : LocalDateTime.ofInstant(endsAt, ZoneId.of(timezone));
	}

	/** The first calendar date the event appears on, in the zone used for display. */
	public LocalDate firstDate(ZoneId displayZone) {
		return allDay ? startDate : startsAt.atZone(displayZone).toLocalDate();
	}

	/**
	 * The last calendar date the event appears on. The end is exclusive, so an
	 * event ending exactly at midnight does not appear on the following day.
	 */
	public LocalDate lastDate(ZoneId displayZone) {
		return allDay ? endDateExclusive.minusDays(1)
				: endsAt.minus(1, ChronoUnit.NANOS).atZone(displayZone).toLocalDate();
	}

}
