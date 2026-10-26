package com.daytracker.events;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.groups.Tuple.tuple;

import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.daytracker.MutableClock;
import com.daytracker.calendar.CalendarItemResponse.CalendarItemType;
import com.daytracker.calendar.CalendarItemResponse;
import com.daytracker.calendar.CalendarService;
import com.daytracker.categories.CategoryRepository;
import com.daytracker.common.ApiExceptions.ConflictException;
import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.common.ApiExceptions.NotFoundException;
import com.daytracker.database.DatabaseConfig;
import com.daytracker.database.MigrationRunner;
import com.daytracker.database.MigrationScript;
import com.daytracker.reading.ReadingGoals.GoalService;
import com.daytracker.reading.ReadingSessionRepository;
import com.daytracker.reviews.ReviewService;
import com.daytracker.settings.ZonePolicy;
import com.daytracker.tasks.TaskRepository;

/**
 * Appointments against a real SQLite database. Dates are shown in Sao Paulo
 * (UTC-3, no daylight saving in 2026); some events are entered in other zones.
 */
class EventRulesTest {

	private static final ZoneId DISPLAY = ZoneId.of("America/Sao_Paulo");

	private static final String SAO_PAULO = "America/Sao_Paulo";

	@TempDir
	Path tempDir;

	private final MutableClock clock = new MutableClock(Instant.parse("2026-10-05T12:00:00Z"));

	private HikariDataSource dataSource;

	private EventService events;

	private CalendarService calendar;

	@BeforeEach
	void openDatabase() {
		dataSource = DatabaseConfig.createDataSource(tempDir.resolve("db").resolve("test.db"));
		new MigrationRunner(dataSource, tempDir.resolve("backups"), clock,
				MigrationScript.loadAll("classpath:db/migration/V*__*.sql"))
			.migrate();
		JdbcClient jdbc = JdbcClient.create(dataSource);
		EventRepository repository = new EventRepository(jdbc);
		events = new EventService(repository, new CategoryRepository(jdbc), clock, ZonePolicy.fixed(DISPLAY));
		calendar = new CalendarService(new TaskRepository(jdbc), new ReadingSessionRepository(jdbc),
				new GoalService(jdbc, clock), repository, new ReviewService(jdbc, clock, ZonePolicy.fixed(DISPLAY)), clock, ZonePolicy.fixed(DISPLAY));
	}

	@AfterEach
	void closeDatabase() {
		dataSource.close();
	}

	private CalendarEvent timed(String title, String start, String end, String zone) {
		return events.create(new EventRequests.Create(UUID.randomUUID(), title, null, null, false,
				LocalDateTime.parse(start), LocalDateTime.parse(end), zone, null, null))
			.event();
	}

	private CalendarEvent allDay(String title, String startDate, String endDateExclusive) {
		return events.create(new EventRequests.Create(UUID.randomUUID(), title, null, null, true, null, null, null,
				LocalDate.parse(startDate), LocalDate.parse(endDateExclusive)))
			.event();
	}

	private List<CalendarItemResponse> eventItems(String from, String to) {
		return calendar.range(LocalDate.parse(from), LocalDate.parse(to))
			.items()
			.stream()
			.filter(item -> item.type() == CalendarItemType.EVENT)
			.toList();
	}

	private List<String> agenda(String date) {
		return calendar.day(LocalDate.parse(date)).events().stream().map(EventResponse::title).toList();
	}

	@Test
	void anEventAcrossMidnightAppearsOnBothDates() {
		CalendarEvent party = timed("Party", "2026-10-09T22:00", "2026-10-10T02:00", SAO_PAULO);

		assertThat(party.startsAt()).isEqualTo(Instant.parse("2026-10-10T01:00:00Z"));
		assertThat(party.endsAt()).isEqualTo(Instant.parse("2026-10-10T05:00:00Z"));
		assertThat(eventItems("2026-10-05", "2026-10-12"))
			.extracting(CalendarItemResponse::date, CalendarItemResponse::continued)
			.containsExactly(tuple(LocalDate.parse("2026-10-09"), false), tuple(LocalDate.parse("2026-10-10"), true));
		assertThat(agenda("2026-10-09")).containsExactly("Party");
		assertThat(agenda("2026-10-10")).containsExactly("Party");
		assertThat(agenda("2026-10-11")).isEmpty();
	}

	@Test
	void anEventEndingExactlyAtMidnightDoesNotSpillIntoTheNextDay() {
		timed("Evening class", "2026-10-09T19:00", "2026-10-10T00:00", SAO_PAULO);

		assertThat(eventItems("2026-10-05", "2026-10-12")).extracting(CalendarItemResponse::date)
			.containsExactly(LocalDate.parse("2026-10-09"));
		assertThat(agenda("2026-10-10")).isEmpty();
	}

	@Test
	void aMultiDayEventIsClippedToTheRequestedRange() {
		timed("Conference", "2026-09-29T09:00", "2026-10-03T17:00", SAO_PAULO);

		assertThat(eventItems("2026-10-01", "2026-10-08"))
			.extracting(CalendarItemResponse::date, CalendarItemResponse::continued)
			.containsExactly(tuple(LocalDate.parse("2026-10-01"), true), tuple(LocalDate.parse("2026-10-02"), true),
					tuple(LocalDate.parse("2026-10-03"), true));
	}

	@Test
	void allDayEventsUseAnExclusiveEndDateAndNoTimes() {
		CalendarEvent trip = allDay("Trip", "2026-10-09", "2026-10-12");

		assertThat(trip.startsAt()).isNull();
		assertThat(trip.timezone()).isNull();
		assertThat(eventItems("2026-10-05", "2026-10-19"))
			.extracting(CalendarItemResponse::date, CalendarItemResponse::allDay, CalendarItemResponse::continued)
			.containsExactly(tuple(LocalDate.parse("2026-10-09"), true, false),
					tuple(LocalDate.parse("2026-10-10"), true, true), tuple(LocalDate.parse("2026-10-11"), true, true));
		assertThat(agenda("2026-10-12")).isEmpty();
	}

	@Test
	void anAllDayEventStaysOnItsDatesWhateverTheDisplayZone() {
		allDay("Holiday", "2026-10-12", "2026-10-13");
		JdbcClient jdbc = JdbcClient.create(dataSource);
		CalendarService tokyo = new CalendarService(new TaskRepository(jdbc), new ReadingSessionRepository(jdbc),
				new GoalService(jdbc, clock), new EventRepository(jdbc), new ReviewService(jdbc, clock, ZonePolicy.fixed(DISPLAY)), clock,
				ZonePolicy.fixed(ZoneId.of("Asia/Tokyo")));

		assertThat(tokyo.day(LocalDate.parse("2026-10-12")).events()).extracting(EventResponse::title)
			.containsExactly("Holiday");
		assertThat(tokyo.day(LocalDate.parse("2026-10-11")).events()).isEmpty();
	}

	@Test
	void aTimedEventKeepsItsOwnZoneAndIsShownOnTheDisplayDate() {
		// 23:30 in Lisbon is 19:30 the same day in Sao Paulo.
		CalendarEvent call = timed("Call with Lisbon", "2026-10-09T23:30", "2026-10-10T00:30", "Europe/Lisbon");

		assertThat(call.timezone()).isEqualTo("Europe/Lisbon");
		assertThat(call.localStart()).isEqualTo(LocalDateTime.parse("2026-10-09T23:30"));
		assertThat(agenda("2026-10-09")).containsExactly("Call with Lisbon");
		assertThat(agenda("2026-10-10")).isEmpty();
	}

	@Test
	void wallClockTimesFollowDaylightSavingRulesOfTheEventZone() {
		// New York leaves daylight saving on 2026-11-01: 01:30 happens twice and the offset changes.
		CalendarEvent before = timed("Before", "2026-10-31T09:00", "2026-10-31T10:00", "America/New_York");
		CalendarEvent after = timed("After", "2026-11-02T09:00", "2026-11-02T10:00", "America/New_York");

		assertThat(before.startsAt()).isEqualTo(Instant.parse("2026-10-31T13:00:00Z"));
		assertThat(after.startsAt()).isEqualTo(Instant.parse("2026-11-02T14:00:00Z"));
	}

	@Test
	void overlappingTimedEventsAreAllowedAndMarked() {
		CalendarEvent dentist = timed("Dentist", "2026-10-09T09:00", "2026-10-09T10:00", SAO_PAULO);
		CalendarEvent call = timed("Call", "2026-10-09T09:30", "2026-10-09T10:30", SAO_PAULO);
		CalendarEvent lunch = timed("Lunch", "2026-10-09T12:00", "2026-10-09T13:00", SAO_PAULO);
		// Back-to-back is not an overlap.
		CalendarEvent after = timed("After", "2026-10-09T10:30", "2026-10-09T11:00", SAO_PAULO);
		CalendarEvent holiday = allDay("Holiday", "2026-10-09", "2026-10-10");

		assertThat(events.get(dentist.id()).overlapsAnother()).isTrue();
		assertThat(events.get(call.id()).overlapsAnother()).isTrue();
		assertThat(events.get(lunch.id()).overlapsAnother()).isFalse();
		assertThat(events.get(after.id()).overlapsAnother()).isFalse();
		assertThat(events.get(holiday.id()).overlapsAnother()).isFalse();
		// All-day first, then by start time.
		assertThat(agenda("2026-10-09")).containsExactly("Holiday", "Dentist", "Call", "After", "Lunch");
	}

	@Test
	void eventsAreValidated() {
		assertThatThrownBy(() -> timed("Backwards", "2026-10-09T10:00", "2026-10-09T09:00", SAO_PAULO))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> timed("Zero length", "2026-10-09T10:00", "2026-10-09T10:00", SAO_PAULO))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> timed("Offset", "2026-10-09T10:00", "2026-10-09T11:00", "+03:00"))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> timed("Unknown", "2026-10-09T10:00", "2026-10-09T11:00", "Mars/Olympus"))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> timed("  ", "2026-10-09T10:00", "2026-10-09T11:00", SAO_PAULO))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> allDay("Same day", "2026-10-09", "2026-10-09"))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> events.create(new EventRequests.Create(UUID.randomUUID(), "Mixed", null, null, true,
				LocalDateTime.parse("2026-10-09T10:00"), null, null, LocalDate.parse("2026-10-09"),
				LocalDate.parse("2026-10-10"))))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> events.create(new EventRequests.Create(UUID.randomUUID(), "No kind", null, null, null,
				null, null, null, null, null)))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> events.create(new EventRequests.Create(UUID.randomUUID(), "Category", null,
				UUID.randomUUID(), true, null, null, null, LocalDate.parse("2026-10-09"), LocalDate.parse("2026-10-10"))))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> events.overlapping(LocalDate.parse("2026-01-01"), LocalDate.parse("2026-06-01")))
			.isInstanceOf(InvalidInputException.class);
	}

	@Test
	void createIsIdempotentAndEditsUseVersions() {
		UUID id = UUID.randomUUID();
		EventRequests.Create request = new EventRequests.Create(id, "Dentist", null, null, false,
				LocalDateTime.parse("2026-10-09T09:00"), LocalDateTime.parse("2026-10-09T10:00"), SAO_PAULO, null,
				null);
		assertThat(events.create(request).created()).isTrue();
		assertThat(events.create(request).created()).isFalse();
		assertThatThrownBy(() -> events.create(new EventRequests.Create(id, "Doctor", null, null, false,
				LocalDateTime.parse("2026-10-09T09:00"), LocalDateTime.parse("2026-10-09T10:00"), SAO_PAULO, null,
				null)))
			.isInstanceOf(ConflictException.class);

		// Switch to all-day: the times and zone go away.
		CalendarEvent changed = events.update(id, new EventRequests.Update(1L, "Dentist", "Bring the card", null,
				true, null, null, null, LocalDate.parse("2026-10-09"), LocalDate.parse("2026-10-10")));
		assertThat(changed.allDay()).isTrue();
		assertThat(changed.startsAt()).isNull();
		assertThat(changed.notes()).isEqualTo("Bring the card");
		assertThat(changed.version()).isEqualTo(2);
		assertThatThrownBy(() -> events.update(id, new EventRequests.Update(1L, "Stale", null, null, true, null,
				null, null, LocalDate.parse("2026-10-09"), LocalDate.parse("2026-10-10"))))
			.isInstanceOf(ConflictException.class);

		assertThatThrownBy(() -> events.delete(id, 1)).isInstanceOf(ConflictException.class);
		events.delete(id, 2);
		assertThatThrownBy(() -> events.get(id)).isInstanceOf(NotFoundException.class);
		assertThatThrownBy(() -> events.delete(id, 2)).isInstanceOf(NotFoundException.class);
		assertThat(agenda("2026-10-09")).isEmpty();
	}

}
