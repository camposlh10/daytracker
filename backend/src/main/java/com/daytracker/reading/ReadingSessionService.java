package com.daytracker.reading;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.daytracker.common.ApiExceptions.ConflictException;
import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.common.ApiExceptions.NotFoundException;
import com.daytracker.common.Timestamps;
import com.daytracker.settings.ZonePolicy;

@Service
public class ReadingSessionService {

	static final int MAX_PAGES_PER_SESSION = 10_000;

	static final int MAX_NOTES_LENGTH = 5_000;

	public record CreateResult(ReadingSession session, boolean created) {
	}

	public record Page(List<ReadingSession> items, int page, int size, long total) {
	}

	private final ReadingSessionRepository repository;

	private final BookRepository books;

	private final Clock clock;

	private final ZonePolicy zonePolicy;

	public ReadingSessionService(ReadingSessionRepository repository, BookRepository books, Clock clock,
			ZonePolicy zonePolicy) {
		this.repository = repository;
		this.books = books;
		this.clock = clock;
		this.zonePolicy = zonePolicy;
	}

	@Transactional(readOnly = true)
	public Page list(UUID bookId, LocalDate from, LocalDate toExclusive, int page, int size) {
		return new Page(repository.search(bookId, from, toExclusive, size, (long) page * size), page, size,
				repository.count(bookId, from, toExclusive));
	}

	/**
	 * Records a session, or returns the existing one when the same request is
	 * replayed. Several sessions on one date and backdated sessions are allowed;
	 * future dates are not.
	 */
	@Transactional
	public CreateResult create(SessionRequests.Create request) {
		String notes = cleanNotes(request.notes());

		Optional<ReadingSession> existing = repository.findById(request.id());
		if (existing.isPresent()) {
			ReadingSession session = existing.get();
			boolean samePayload = session.bookId().equals(request.bookId())
					&& session.activityDate().equals(request.activityDate())
					&& session.pagesRead() == request.pagesRead()
					&& Objects.equals(session.endingPage(), request.endingPage())
					&& Objects.equals(session.notes(), notes);
			if (!samePayload || repository.isDeleted(request.id())) {
				throw new ConflictException("A different reading session already exists with this id.");
			}
			return new CreateResult(session, false);
		}

		Book book = books.findById(request.bookId())
			.orElseThrow(() -> new InvalidInputException("bookId", "The book does not exist."));
		if (book.archivedAt() != null) {
			throw new InvalidInputException("bookId", "The book is archived. Restore it to record reading.");
		}
		validate(request.activityDate(), request.pagesRead(), request.endingPage(), book);

		Instant now = Timestamps.truncate(clock.instant());
		repository.insert(new ReadingSession(request.id(), book.id(), book.title(), request.activityDate(),
				request.pagesRead(), request.endingPage(), notes, now, now, 1));
		return new CreateResult(get(request.id()), true);
	}

	/** Corrects a session. Every total that includes it is derived, so nothing else needs rewriting. */
	@Transactional
	public ReadingSession update(UUID id, SessionRequests.Update request) {
		ReadingSession current = get(id);
		if (current.version() != request.getVersion()) {
			throw staleVersion();
		}
		LocalDate activityDate = request.has("activityDate") ? required(request.getActivityDate(), "activityDate")
				: current.activityDate();
		int pagesRead = request.has("pagesRead") ? required(request.getPagesRead(), "pagesRead")
				: current.pagesRead();
		Integer endingPage = request.has("endingPage") ? request.getEndingPage() : current.endingPage();
		String notes = request.has("notes") ? cleanNotes(request.getNotes()) : current.notes();

		Book book = books.findById(current.bookId()).orElseThrow();
		validate(activityDate, pagesRead, endingPage, book);

		boolean unchanged = activityDate.equals(current.activityDate()) && pagesRead == current.pagesRead()
				&& Objects.equals(endingPage, current.endingPage()) && Objects.equals(notes, current.notes());
		if (unchanged) {
			return current;
		}
		Instant now = Timestamps.truncate(clock.instant());
		ReadingSession updated = new ReadingSession(id, current.bookId(), current.bookTitle(), activityDate, pagesRead,
				endingPage, notes, current.createdAt(), now, current.version() + 1);
		if (!repository.update(updated, current.version())) {
			throw staleVersion();
		}
		return updated;
	}

	/** Soft-deletes a session. Deleting one that is already deleted succeeds without doing anything. */
	@Transactional
	public void delete(UUID id, long expectedVersion) {
		if (repository.findById(id).isEmpty()) {
			throw new NotFoundException("Reading session not found.");
		}
		if (repository.isDeleted(id)) {
			return;
		}
		if (!repository.markDeleted(id, expectedVersion, Timestamps.truncate(clock.instant()))) {
			throw staleVersion();
		}
	}

	private ReadingSession get(UUID id) {
		return repository.findById(id)
			.filter(session -> !repository.isDeleted(id))
			.orElseThrow(() -> new NotFoundException("Reading session not found."));
	}

	private void validate(LocalDate activityDate, int pagesRead, Integer endingPage, Book book) {
		if (activityDate.isAfter(LocalDate.now(clock.withZone(zonePolicy.zone())))) {
			throw new InvalidInputException("activityDate", "Reading cannot be recorded for a future date.");
		}
		if (pagesRead < 1 || pagesRead > MAX_PAGES_PER_SESSION) {
			throw new InvalidInputException("pagesRead",
					"Pages read must be between 1 and " + MAX_PAGES_PER_SESSION + ".");
		}
		if (endingPage != null && (endingPage < 0 || endingPage > book.totalPages())) {
			throw new InvalidInputException("endingPage",
					"The ending page must be between 0 and " + book.totalPages() + ", the length of the book.");
		}
	}

	private static String cleanNotes(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
		if (value.codePointCount(0, value.length()) > MAX_NOTES_LENGTH) {
			throw new InvalidInputException("notes", "Notes are limited to " + MAX_NOTES_LENGTH + " characters.");
		}
		return value;
	}

	private static <T> T required(T value, String field) {
		if (value == null) {
			throw new InvalidInputException(field, "A value is required.");
		}
		return value;
	}

	private static ConflictException staleVersion() {
		return new ConflictException("The reading session was changed after it was loaded. Reload it and try again.");
	}

}
