package com.daytracker.events;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Turns the stored events into what appears in a range of dates: a one-off
 * event as it is, a repeating one as each occurrence that touches the range.
 * The overlap flag is worked out again across all of them, so a repeat that
 * clashes with another appointment on a later day is marked on that day.
 */
public final class EventOccurrences {

	private EventOccurrences() {
	}

	public static List<CalendarEvent> expand(List<CalendarEvent> stored, LocalDate from, LocalDate toExclusive,
			ZoneId displayZone) {
		Instant fromInstant = from.atStartOfDay(displayZone).toInstant();
		Instant toInstant = toExclusive.atStartOfDay(displayZone).toInstant();
		List<CalendarEvent> shown = new ArrayList<>();
		for (CalendarEvent event : stored) {
			if (!event.repeats()) {
				shown.add(event);
				continue;
			}
			for (LocalDate date : candidateDates(event, from, toExclusive)) {
				CalendarEvent occurrence = event.occurrenceOn(date);
				if (touches(occurrence, from, toExclusive, fromInstant, toInstant)) {
					shown.add(occurrence);
				}
			}
		}
		shown.sort(Comparator.comparing((CalendarEvent event) -> !event.allDay())
			.thenComparing(event -> event.allDay() ? event.startDate().atStartOfDay(displayZone).toInstant()
					: event.startsAt())
			.thenComparing(CalendarEvent::createdAt)
			.thenComparing(event -> event.id().toString()));
		return markOverlaps(shown);
	}

	/**
	 * The dates an occurrence may start on and still reach the range: a long
	 * event that started a few days before the range can still be in it.
	 */
	private static List<LocalDate> candidateDates(CalendarEvent event, LocalDate from, LocalDate toExclusive) {
		LocalDate first = event.ownFirstDate();
		if (CalendarEvent.DATES.equals(event.repeatRule())) {
			return event.repeatDates();
		}
		long spanDays = event.allDay() ? ChronoUnit.DAYS.between(event.startDate(), event.endDateExclusive())
				: ChronoUnit.DAYS.between(event.startsAt(), event.endsAt()) + 1;
		// A day either side covers the difference between the event's zone and the display zone.
		LocalDate start = latest(first, from.minusDays(spanDays + 1));
		LocalDate end = event.repeatUntil() == null ? toExclusive.plusDays(1)
				: earliest(event.repeatUntil(), toExclusive.plusDays(1));
		List<LocalDate> dates = new ArrayList<>();
		boolean weekly = CalendarEvent.WEEKLY.equals(event.repeatRule());
		for (LocalDate date = start; !date.isAfter(end); date = date.plusDays(1)) {
			if (!weekly || event.repeatWeekdays().contains(date.getDayOfWeek())) {
				dates.add(date);
			}
		}
		return dates;
	}

	private static boolean touches(CalendarEvent event, LocalDate from, LocalDate toExclusive, Instant fromInstant,
			Instant toInstant) {
		return event.allDay() ? event.startDate().isBefore(toExclusive) && event.endDateExclusive().isAfter(from)
				: event.startsAt().isBefore(toInstant) && event.endsAt().isAfter(fromInstant);
	}

	/** Two timed occurrences overlap when each starts before the other ends. All-day events never conflict. */
	private static List<CalendarEvent> markOverlaps(List<CalendarEvent> events) {
		List<CalendarEvent> marked = new ArrayList<>(events.size());
		for (CalendarEvent event : events) {
			boolean overlaps = !event.allDay() && events.stream()
				.anyMatch(other -> other != event && !other.allDay()
						&& !(other.id().equals(event.id()) && other.startsAt().equals(event.startsAt()))
						&& other.startsAt().isBefore(event.endsAt()) && event.startsAt().isBefore(other.endsAt()));
			marked.add(overlaps == event.overlapsAnother() ? event : event.withOverlap(overlaps));
		}
		return marked;
	}

	private static LocalDate latest(LocalDate a, LocalDate b) {
		return a.isAfter(b) ? a : b;
	}

	private static LocalDate earliest(LocalDate a, LocalDate b) {
		return a.isBefore(b) ? a : b;
	}

}
