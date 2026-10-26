package com.daytracker.events;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.daytracker.categories.CategoryRepository;
import com.daytracker.common.ApiExceptions.ConflictException;
import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.common.ApiExceptions.NotFoundException;
import com.daytracker.common.Timestamps;
import com.daytracker.settings.ZonePolicy;

@Service
public class EventService {

	static final int MAX_TITLE_LENGTH = 200;

	static final int MAX_NOTES_LENGTH = 5_000;

	static final int MAX_SPAN_DAYS = 366;

	static final int MAX_RANGE_DAYS = 93;

	public record CreateResult(CalendarEvent event, boolean created) {
	}

	private final EventRepository repository;

	private final CategoryRepository categories;

	private final Clock clock;

	private final ZonePolicy displayZone;

	public EventService(EventRepository repository, CategoryRepository categories, Clock clock, ZonePolicy displayZone) {
		this.repository = repository;
		this.categories = categories;
		this.clock = clock;
		this.displayZone = displayZone;
	}

	/** Events that appear on any date from {@code from} up to {@code toExclusive}. */
	@Transactional(readOnly = true)
	public List<CalendarEvent> overlapping(LocalDate from, LocalDate toExclusive) {
		if (!toExclusive.isAfter(from)) {
			throw new InvalidInputException("to", "The end date must be after the start date.");
		}
		if (ChronoUnit.DAYS.between(from, toExclusive) > MAX_RANGE_DAYS) {
			throw new InvalidInputException("to", "An event query is limited to " + MAX_RANGE_DAYS + " days.");
		}
		return repository.findOverlapping(from, toExclusive, from.atStartOfDay(displayZone.zone()).toInstant(),
				toExclusive.atStartOfDay(displayZone.zone()).toInstant());
	}

	@Transactional(readOnly = true)
	public CalendarEvent get(UUID id) {
		return repository.findById(id).orElseThrow(() -> new NotFoundException("Event not found."));
	}

	/** Creates an event, or returns the existing one when the same request is replayed. */
	@Transactional
	public CreateResult create(EventRequests.Create request) {
		Instant now = Timestamps.truncate(clock.instant());
		CalendarEvent event = build(request.id(), request.fields(), now, now, 1);

		Optional<CalendarEvent> existing = repository.findById(request.id());
		if (existing.isPresent()) {
			if (!sameContent(existing.get(), event)) {
				throw new ConflictException("A different event already exists with this id.");
			}
			return new CreateResult(existing.get(), false);
		}
		requireUsableCategory(event.categoryId());
		repository.insert(event);
		return new CreateResult(get(event.id()), true);
	}

	/** Replaces the editable fields if the event still has the version the client saw. */
	@Transactional
	public CalendarEvent update(UUID id, EventRequests.Update request) {
		CalendarEvent current = get(id);
		if (current.version() != request.version()) {
			throw staleVersion();
		}
		Instant now = Timestamps.truncate(clock.instant());
		CalendarEvent updated = build(id, request.fields(), current.createdAt(), now, current.version() + 1);
		if (sameContent(current, updated)) {
			return current;
		}
		if (!Objects.equals(updated.categoryId(), current.categoryId())) {
			requireUsableCategory(updated.categoryId());
		}
		if (!repository.update(updated, current.version())) {
			throw staleVersion();
		}
		return get(id);
	}

	/** Deletes the event if it still has the version the client saw. */
	@Transactional
	public void delete(UUID id, long expectedVersion) {
		get(id);
		if (!repository.delete(id, expectedVersion)) {
			throw staleVersion();
		}
	}

	private CalendarEvent build(UUID id, EventRequests.Fields fields, Instant createdAt, Instant updatedAt,
			long version) {
		String title = fields.title() == null ? "" : fields.title().strip();
		if (title.isEmpty()) {
			throw new InvalidInputException("title", "A title is required.");
		}
		if (title.codePointCount(0, title.length()) > MAX_TITLE_LENGTH) {
			throw new InvalidInputException("title", "The title is limited to " + MAX_TITLE_LENGTH + " characters.");
		}
		String notes = fields.notes() == null || fields.notes().isBlank() ? null : fields.notes();
		if (notes != null && notes.codePointCount(0, notes.length()) > MAX_NOTES_LENGTH) {
			throw new InvalidInputException("notes", "Notes are limited to " + MAX_NOTES_LENGTH + " characters.");
		}
		if (fields.allDay() == null) {
			throw new InvalidInputException("allDay", "Say whether the event lasts all day.");
		}

		if (fields.allDay()) {
			if (fields.start() != null || fields.end() != null || fields.timezone() != null) {
				throw new InvalidInputException("allDay", "An all-day event has dates, not times or a timezone.");
			}
			LocalDate startDate = required(fields.startDate(), "startDate");
			LocalDate endDate = required(fields.endDateExclusive(), "endDateExclusive");
			if (!endDate.isAfter(startDate)) {
				throw new InvalidInputException("endDateExclusive", "The event must end after it starts.");
			}
			if (ChronoUnit.DAYS.between(startDate, endDate) > MAX_SPAN_DAYS) {
				throw new InvalidInputException("endDateExclusive",
						"An event can last at most " + MAX_SPAN_DAYS + " days.");
			}
			return new CalendarEvent(id, title, notes, fields.categoryId(), true, null, null, null, startDate, endDate,
					createdAt, updatedAt, version, false);
		}

		if (fields.startDate() != null || fields.endDateExclusive() != null) {
			throw new InvalidInputException("allDay", "A timed event has times, not all-day dates.");
		}
		ZoneId zone = zone(fields.timezone());
		// A wall-clock time skipped by a daylight-saving change moves forward; a
		// repeated one resolves to its first occurrence.
		Instant startsAt = required(fields.start(), "start").atZone(zone).toInstant();
		Instant endsAt = required(fields.end(), "end").atZone(zone).toInstant();
		if (!endsAt.isAfter(startsAt)) {
			throw new InvalidInputException("end", "The event must end after it starts.");
		}
		if (ChronoUnit.DAYS.between(startsAt, endsAt) > MAX_SPAN_DAYS) {
			throw new InvalidInputException("end", "An event can last at most " + MAX_SPAN_DAYS + " days.");
		}
		return new CalendarEvent(id, title, notes, fields.categoryId(), false, Timestamps.truncate(startsAt),
				Timestamps.truncate(endsAt), zone.getId(), null, null, createdAt, updatedAt, version, false);
	}

	private static ZoneId zone(String timezone) {
		// Only region identifiers such as Europe/Lisbon; fixed offsets would not follow daylight-saving rules.
		if (timezone == null || !ZoneId.getAvailableZoneIds().contains(timezone)) {
			throw new InvalidInputException("timezone", "Choose a timezone such as America/Sao_Paulo.");
		}
		return ZoneId.of(timezone);
	}

	private void requireUsableCategory(UUID categoryId) {
		if (categoryId != null && !categories.existsActive(categoryId)) {
			throw new InvalidInputException("categoryId", "The category does not exist or is archived.");
		}
	}

	private static boolean sameContent(CalendarEvent a, CalendarEvent b) {
		return a.title().equals(b.title()) && Objects.equals(a.notes(), b.notes())
				&& Objects.equals(a.categoryId(), b.categoryId()) && a.allDay() == b.allDay()
				&& Objects.equals(a.startsAt(), b.startsAt()) && Objects.equals(a.endsAt(), b.endsAt())
				&& Objects.equals(a.timezone(), b.timezone()) && Objects.equals(a.startDate(), b.startDate())
				&& Objects.equals(a.endDateExclusive(), b.endDateExclusive());
	}

	private static <T> T required(T value, String field) {
		if (value == null) {
			throw new InvalidInputException(field, "A value is required.");
		}
		return value;
	}

	private static ConflictException staleVersion() {
		return new ConflictException("The event was changed after it was loaded. Reload it and try again.");
	}

}
