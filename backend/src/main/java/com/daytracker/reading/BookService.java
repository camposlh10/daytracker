package com.daytracker.reading;

import java.time.Clock;
import java.time.Instant;
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
import com.daytracker.reading.Book.BookStatus;

@Service
public class BookService {

	static final int MAX_TITLE_LENGTH = 300;

	static final int MAX_AUTHOR_LENGTH = 200;

	static final int MAX_PAGES = 100_000;

	public record CreateResult(Book book, boolean created) {
	}

	private final BookRepository repository;

	private final Clock clock;

	public BookService(BookRepository repository, Clock clock) {
		this.repository = repository;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	public List<Book> list(boolean archived) {
		return repository.findAll(archived);
	}

	@Transactional(readOnly = true)
	public Book get(UUID id) {
		return repository.findById(id).orElseThrow(() -> new NotFoundException("Book not found."));
	}

	/** Creates a book, or returns the existing one when the same request is replayed. */
	@Transactional
	public CreateResult create(BookRequests.Create request) {
		String title = cleanTitle(request.title());
		String author = cleanAuthor(request.author());
		int totalPages = cleanTotalPages(request.totalPages());
		int initialPage = cleanInitialPage(request.initialPage() == null ? 0 : request.initialPage(), totalPages);
		BookStatus status = request.status() == null ? BookStatus.TO_READ : request.status();

		Optional<Book> existing = repository.findById(request.id());
		if (existing.isPresent()) {
			Book book = existing.get();
			boolean samePayload = book.title().equals(title) && Objects.equals(book.author(), author)
					&& book.totalPages() == totalPages && book.initialPage() == initialPage
					&& book.status() == status;
			if (!samePayload) {
				throw new ConflictException("A different book already exists with this id.");
			}
			return new CreateResult(book, false);
		}

		Instant now = Timestamps.truncate(clock.instant());
		repository.insert(new Book(request.id(), title, author, totalPages, initialPage, status, null, now, now, 1,
				initialPage, 0, null));
		return new CreateResult(get(request.id()), true);
	}

	/**
	 * Edits details, status (finishing a book is this explicit change), or archive
	 * state. The total cannot drop below a page that a session already recorded.
	 */
	@Transactional
	public Book update(UUID id, BookRequests.Update request) {
		Book current = get(id);
		if (current.version() != request.version()) {
			throw staleVersion();
		}
		String title = request.title() == null ? current.title() : cleanTitle(request.title());
		String author = request.author() == null ? current.author() : cleanAuthor(request.author());
		int totalPages = request.totalPages() == null ? current.totalPages() : cleanTotalPages(request.totalPages());
		int initialPage = cleanInitialPage(request.initialPage() == null ? current.initialPage() : request.initialPage(),
				totalPages);
		BookStatus status = request.status() == null ? current.status() : request.status();
		boolean archived = request.archived() == null ? current.archivedAt() != null : request.archived();

		if (totalPages < current.totalPages()) {
			int recorded = repository.maxRecordedEndingPage(id);
			if (totalPages < recorded) {
				throw new InvalidInputException("totalPages", "A reading session already ends on page " + recorded
						+ ". Correct that session before lowering the total below it.");
			}
		}

		Instant now = Timestamps.truncate(clock.instant());
		Instant archivedAt = archived ? (current.archivedAt() != null ? current.archivedAt() : now) : null;
		boolean unchanged = title.equals(current.title()) && Objects.equals(author, current.author())
				&& totalPages == current.totalPages() && initialPage == current.initialPage()
				&& status == current.status() && (archivedAt == null) == (current.archivedAt() == null);
		if (unchanged) {
			return current;
		}
		Book updated = new Book(id, title, author, totalPages, initialPage, status, archivedAt, current.createdAt(),
				now, current.version() + 1, 0, 0, null);
		if (!repository.update(updated, current.version())) {
			throw staleVersion();
		}
		return get(id);
	}

	private static String cleanTitle(String value) {
		String title = value == null ? "" : value.strip();
		if (title.isEmpty()) {
			throw new InvalidInputException("title", "A title is required.");
		}
		if (title.codePointCount(0, title.length()) > MAX_TITLE_LENGTH) {
			throw new InvalidInputException("title", "The title is limited to " + MAX_TITLE_LENGTH + " characters.");
		}
		return title;
	}

	private static String cleanAuthor(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
		String author = value.strip();
		if (author.codePointCount(0, author.length()) > MAX_AUTHOR_LENGTH) {
			throw new InvalidInputException("author", "The author is limited to " + MAX_AUTHOR_LENGTH + " characters.");
		}
		return author;
	}

	private static int cleanTotalPages(Integer value) {
		if (value == null || value < 1 || value > MAX_PAGES) {
			throw new InvalidInputException("totalPages", "Total pages must be between 1 and " + MAX_PAGES + ".");
		}
		return value;
	}

	private static int cleanInitialPage(int value, int totalPages) {
		if (value < 0 || value > totalPages) {
			throw new InvalidInputException("initialPage", "The starting page must be between 0 and the total pages.");
		}
		return value;
	}

	private static ConflictException staleVersion() {
		return new ConflictException("The book was changed after it was loaded. Reload it and try again.");
	}

}
