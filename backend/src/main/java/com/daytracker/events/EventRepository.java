package com.daytracker.events;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.daytracker.common.Timestamps;

@Repository
public class EventRepository {

	/** Two timed events overlap when each starts before the other ends. All-day events never conflict. */
	private static final String SELECT = """
			SELECT e.id, e.title, e.notes, e.category_id, e.all_day, e.starts_at, e.ends_at, e.timezone,
			    e.start_date, e.end_date_exclusive, e.repeat_rule, e.repeat_until, e.repeat_dates, e.repeat_weekdays, e.links,
			    e.created_at, e.updated_at, e.version,
			    CASE WHEN e.all_day = 0 AND EXISTS (
			        SELECT 1 FROM calendar_events o
			        WHERE o.all_day = 0 AND o.id <> e.id AND o.starts_at < e.ends_at AND e.starts_at < o.ends_at)
			    THEN 1 ELSE 0 END AS overlaps
			FROM calendar_events e""";

	/** All-day events first, then by start time; stored text sorts chronologically. */
	private static final String ORDER = " ORDER BY e.all_day DESC, COALESCE(e.start_date, e.starts_at), e.created_at, e.id";

	private final JdbcClient jdbc;

	public EventRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	public Optional<CalendarEvent> findById(UUID id) {
		return jdbc.sql(SELECT + " WHERE e.id = :id").param("id", id.toString()).query(EventRepository::mapEvent).optional();
	}

	/**
	 * Events that overlap the dates from {@code from} up to {@code toExclusive}.
	 * Timed events are compared as instants against the start of those dates in
	 * the display zone, all-day events by date. Repeating events are included when
	 * they start before the range ends and repeat until it or later (a year of
	 * margin covers long occurrences); {@link EventOccurrences} picks the dates.
	 */
	public List<CalendarEvent> findOverlapping(LocalDate from, LocalDate toExclusive, Instant fromInstant,
			Instant toInstant) {
		return jdbc.sql(SELECT + " " + """
				WHERE (e.all_day = 0 AND e.starts_at < :toInstant AND e.ends_at > :fromInstant)
				    OR (e.all_day = 1 AND e.start_date < :to AND e.end_date_exclusive > :from)
				    OR (e.repeat_rule IS NOT NULL
				        AND (e.repeat_until IS NULL OR e.repeat_until >= :repeatsFrom)
				        AND ((e.all_day = 0 AND e.starts_at < :toInstant) OR (e.all_day = 1 AND e.start_date < :to)))""" + ORDER)
			.param("from", from.toString())
			.param("to", toExclusive.toString())
			.param("repeatsFrom", from.minusDays(EventService.MAX_SPAN_DAYS + 1L).toString())
			.param("fromInstant", Timestamps.format(fromInstant))
			.param("toInstant", Timestamps.format(toInstant))
			.query(EventRepository::mapEvent)
			.list();
	}

	public void insert(CalendarEvent event) {
		jdbc.sql("""
				INSERT INTO calendar_events (id, title, notes, category_id, all_day, starts_at, ends_at, timezone,
				    start_date, end_date_exclusive, repeat_rule, repeat_until, repeat_dates, repeat_weekdays, links,
				    created_at, updated_at, version)
				VALUES (:id, :title, :notes, :categoryId, :allDay, :startsAt, :endsAt, :timezone,
				    :startDate, :endDateExclusive, :repeatRule, :repeatUntil, :repeatDates, :repeatWeekdays, :links,
				    :createdAt, :updatedAt, :version)""")
			.params(columnValues(event))
			.update();
	}

	/** @return false when another change got there first */
	public boolean update(CalendarEvent event, long expectedVersion) {
		Map<String, Object> params = columnValues(event);
		params.put("expectedVersion", expectedVersion);
		return jdbc.sql("""
				UPDATE calendar_events SET title = :title, notes = :notes, category_id = :categoryId,
				    all_day = :allDay, starts_at = :startsAt, ends_at = :endsAt, timezone = :timezone,
				    start_date = :startDate, end_date_exclusive = :endDateExclusive,
				    repeat_rule = :repeatRule, repeat_until = :repeatUntil, repeat_dates = :repeatDates,
				    repeat_weekdays = :repeatWeekdays, links = :links,
				    updated_at = :updatedAt, version = :version
				WHERE id = :id AND version = :expectedVersion""").params(params).update() == 1;
	}

	/** @return false when the stored version differs */
	public boolean delete(UUID id, long expectedVersion) {
		return jdbc.sql("DELETE FROM calendar_events WHERE id = :id AND version = :version")
			.param("id", id.toString())
			.param("version", expectedVersion)
			.update() == 1;
	}

	private static Map<String, Object> columnValues(CalendarEvent event) {
		Map<String, Object> values = new HashMap<>();
		values.put("id", event.id().toString());
		values.put("title", event.title());
		values.put("notes", event.notes());
		values.put("categoryId", event.categoryId() == null ? null : event.categoryId().toString());
		values.put("allDay", event.allDay() ? 1 : 0);
		values.put("startsAt", event.startsAt() == null ? null : Timestamps.format(event.startsAt()));
		values.put("endsAt", event.endsAt() == null ? null : Timestamps.format(event.endsAt()));
		values.put("timezone", event.timezone());
		values.put("startDate", event.startDate() == null ? null : event.startDate().toString());
		values.put("endDateExclusive", event.endDateExclusive() == null ? null : event.endDateExclusive().toString());
		values.put("repeatRule", event.repeatRule());
		values.put("repeatUntil", event.repeatUntil() == null ? null : event.repeatUntil().toString());
		values.put("repeatDates", event.repeatDates().isEmpty() ? null
				: String.join(",", event.repeatDates().stream().map(LocalDate::toString).toList()));
		// ISO numbers, 1 for Monday to 7 for Sunday.
		values.put("repeatWeekdays", event.repeatWeekdays().isEmpty() ? null
				: String.join(",", event.repeatWeekdays().stream().map(day -> String.valueOf(day.getValue())).toList()));
		values.put("links", event.links().isEmpty() ? null : String.join("\n", event.links()));
		values.put("createdAt", Timestamps.format(event.createdAt()));
		values.put("updatedAt", Timestamps.format(event.updatedAt()));
		values.put("version", event.version());
		return values;
	}

	private static CalendarEvent mapEvent(ResultSet row, int rowNumber) throws SQLException {
		String categoryId = row.getString("category_id");
		String startDate = row.getString("start_date");
		String endDate = row.getString("end_date_exclusive");
		String repeatUntil = row.getString("repeat_until");
		String repeatDates = row.getString("repeat_dates");
		String repeatWeekdays = row.getString("repeat_weekdays");
		String links = row.getString("links");
		return new CalendarEvent(UUID.fromString(row.getString("id")), row.getString("title"), row.getString("notes"),
				categoryId == null ? null : UUID.fromString(categoryId), row.getInt("all_day") == 1,
				Timestamps.parse(row.getString("starts_at")), Timestamps.parse(row.getString("ends_at")),
				row.getString("timezone"), startDate == null ? null : LocalDate.parse(startDate),
				endDate == null ? null : LocalDate.parse(endDate), row.getString("repeat_rule"),
				repeatUntil == null ? null : LocalDate.parse(repeatUntil),
				repeatDates == null ? List.of() : Arrays.stream(repeatDates.split(",")).map(LocalDate::parse).toList(),
				repeatWeekdays == null ? List.of()
						: Arrays.stream(repeatWeekdays.split(",")).map(day -> DayOfWeek.of(Integer.parseInt(day))).toList(),
				links == null ? List.of() : List.of(links.split("\n")), Timestamps.parse(row.getString("created_at")),
				Timestamps.parse(row.getString("updated_at")), row.getLong("version"), row.getInt("overlaps") == 1);
	}

}
