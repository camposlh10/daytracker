package com.daytracker.calendar;

import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.events.CalendarEvent;
import com.daytracker.events.EventRepository;
import com.daytracker.events.EventResponse;
import com.daytracker.reading.ReadingGoals.GoalService;
import com.daytracker.reading.ReadingSession;
import com.daytracker.reading.ReadingSessionRepository;
import com.daytracker.reviews.ReviewService;
import com.daytracker.settings.ZonePolicy;
import com.daytracker.tasks.TaskRepository;
import com.daytracker.tasks.TaskResponse;

@Service
public class CalendarService {

	static final int MAX_RANGE_DAYS = 93;

	static final int MAX_CARRY_OVER = 100;

	private final TaskRepository tasks;

	private final ReadingSessionRepository readingSessions;

	private final GoalService readingGoals;

	private final EventRepository events;

	private final ReviewService reviews;

	private final Clock clock;

	private final ZonePolicy zonePolicy;

	public CalendarService(TaskRepository tasks, ReadingSessionRepository readingSessions, GoalService readingGoals,
			EventRepository events, ReviewService reviews, Clock clock, ZonePolicy zonePolicy) {
		this.tasks = tasks;
		this.readingSessions = readingSessions;
		this.readingGoals = readingGoals;
		this.events = events;
		this.reviews = reviews;
		this.clock = clock;
		this.zonePolicy = zonePolicy;
	}

	@Transactional(readOnly = true)
	public CalendarRangeResponse range(LocalDate from, LocalDate toExclusive) {
		if (!toExclusive.isAfter(from)) {
			throw new InvalidInputException("to", "The end date must be after the start date.");
		}
		if (ChronoUnit.DAYS.between(from, toExclusive) > MAX_RANGE_DAYS) {
			throw new InvalidInputException("to", "A calendar query is limited to " + MAX_RANGE_DAYS + " days.");
		}
		List<CalendarItemResponse> items = new ArrayList<>();
		// Within a date: appointments, then reading, then tasks, so fixed commitments
		// and what was actually done stay visible when a month cell can show only a
		// few items. The sort by date below is stable and keeps this order.
		// An event appears on every date it overlaps, inside the requested range.
		for (CalendarEvent event : overlappingEvents(from, toExclusive)) {
			LocalDate first = event.firstDate(zonePolicy.zone());
			LocalDate last = event.lastDate(zonePolicy.zone());
			for (LocalDate date = first.isBefore(from) ? from : first; !date.isAfter(last)
					&& date.isBefore(toExclusive); date = date.plusDays(1)) {
				items.add(CalendarItemResponse.event(event, date, first));
			}
		}
		readingSessions.sumPagesByDateAndBook(from, toExclusive)
			.forEach(reading -> items.add(CalendarItemResponse.reading(reading)));
		tasks.findPlannedBetween(from, toExclusive).forEach(task -> items.add(CalendarItemResponse.task(task)));
		items.sort(Comparator.comparing(CalendarItemResponse::date));
		return new CalendarRangeResponse(from, toExclusive, items);
	}

	@Transactional(readOnly = true)
	public DayResponse day(LocalDate date) {
		List<TaskResponse> planned = tasks.findPlannedBetween(date, date.plusDays(1))
			.stream()
			.map(TaskResponse::from)
			.toList();
		// Carry-over means overdue: planned before this date and already in the past.
		// Tasks planned between today and a future selected date are not overdue yet.
		LocalDate today = LocalDate.now(clock.withZone(zonePolicy.zone()));
		LocalDate overdueBefore = date.isBefore(today) ? date : today;
		List<TaskResponse> carryOver = tasks.findUnfinishedPlannedBefore(overdueBefore, MAX_CARRY_OVER)
			.stream()
			.map(TaskResponse::from)
			.toList();
		List<ReadingSession> sessions = readingSessions.findOnDate(date);
		long pagesRead = sessions.stream().mapToLong(ReadingSession::pagesRead).sum();
		List<EventResponse> agenda = overlappingEvents(date, date.plusDays(1)).stream()
			.map(EventResponse::from)
			.toList();
		return new DayResponse(date, planned, carryOver, sessions, pagesRead, readingGoals.effectiveOn(date), agenda,
				reviews.find(date).orElse(null));
	}

	private List<CalendarEvent> overlappingEvents(LocalDate from, LocalDate toExclusive) {
		return events.findOverlapping(from, toExclusive, from.atStartOfDay(zonePolicy.zone()).toInstant(),
				toExclusive.atStartOfDay(zonePolicy.zone()).toInstant());
	}

}
