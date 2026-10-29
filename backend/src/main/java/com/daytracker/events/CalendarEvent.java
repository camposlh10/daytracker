package com.daytracker.events;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

/**
 * An appointment. A timed event has start and end instants and the IANA zone it
 * was entered in. An all-day event has a start date and an exclusive end date and
 * no time of day: it is never converted to midnight timestamps.
 * {@code overlapsAnother} is derived: true when a timed event overlaps another
 * timed event. Overlaps are allowed; the flag only lets the interface point it out.
 * <p>
 * A repeating event keeps its first occurrence in the start and end fields; the
 * others are made by {@link #occurrenceOn}, at the same time of day and length.
 * {@code repeatRule} is null (once), {@link #DAILY} (every day from the first
 * date until {@code repeatUntil}, or without end when that is null),
 * {@link #WEEKLY} (the same, but only on {@code repeatWeekdays}; the first date is
 * always one of them) or {@link #DATES} (on each of {@code repeatDates}, the first
 * being its own date).
 */
public record CalendarEvent(UUID id, String title, String notes, UUID categoryId, boolean allDay, Instant startsAt,
		Instant endsAt, String timezone, LocalDate startDate, LocalDate endDateExclusive, String repeatRule,
		LocalDate repeatUntil, List<LocalDate> repeatDates, List<DayOfWeek> repeatWeekdays, List<String> links,
		Instant createdAt, Instant updatedAt, long version, boolean overlapsAnother) {

	public static final String DAILY = "DAILY";

	public static final String WEEKLY = "WEEKLY";

	public static final String DATES = "DATES";

	public CalendarEvent {
		repeatDates = repeatDates == null ? List.of() : List.copyOf(repeatDates);
		repeatWeekdays = repeatWeekdays == null ? List.of() : List.copyOf(repeatWeekdays);
		links = links == null ? List.of() : List.copyOf(links);
	}

	/** The start as wall-clock time in the event's own zone, for editing. */
	public LocalDateTime localStart() {
		return allDay ? null : LocalDateTime.ofInstant(startsAt, ZoneId.of(timezone));
	}

	/** The end as wall-clock time in the event's own zone, for editing. */
	public LocalDateTime localEnd() {
		return allDay ? null : LocalDateTime.ofInstant(endsAt, ZoneId.of(timezone));
	}

	public boolean repeats() {
		return repeatRule != null;
	}

	/** The date of the first occurrence in the event's own zone (all-day events have no zone). */
	public LocalDate ownFirstDate() {
		return allDay ? startDate : localStart().toLocalDate();
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

	/**
	 * The occurrence starting on {@code date} (in the event's own zone): the same
	 * time of day and the same length. A wall-clock time skipped by a
	 * daylight-saving change moves forward, as when an event is entered.
	 */
	public CalendarEvent occurrenceOn(LocalDate date) {
		if (allDay) {
			long days = ChronoUnit.DAYS.between(startDate, endDateExclusive);
			return withTimes(null, null, date, date.plusDays(days));
		}
		Duration length = Duration.between(startsAt, endsAt);
		Instant start = date.atTime(localStart().toLocalTime()).atZone(ZoneId.of(timezone)).toInstant();
		return withTimes(start, start.plus(length), null, null);
	}

	CalendarEvent withOverlap(boolean overlaps) {
		return new CalendarEvent(id, title, notes, categoryId, allDay, startsAt, endsAt, timezone, startDate,
				endDateExclusive, repeatRule, repeatUntil, repeatDates, repeatWeekdays, links, createdAt, updatedAt,
				version, overlaps);
	}

	private CalendarEvent withTimes(Instant start, Instant end, LocalDate firstDay, LocalDate endDay) {
		return new CalendarEvent(id, title, notes, categoryId, allDay, start, end, timezone, firstDay, endDay,
				repeatRule, repeatUntil, repeatDates, repeatWeekdays, links, createdAt, updatedAt, version, false);
	}

}
