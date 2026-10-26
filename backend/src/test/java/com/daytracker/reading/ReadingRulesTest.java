package com.daytracker.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.daytracker.MutableClock;
import com.daytracker.calendar.CalendarItemResponse;
import com.daytracker.calendar.CalendarService;
import com.daytracker.calendar.DayResponse;
import com.daytracker.common.ApiExceptions.ConflictException;
import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.common.ApiExceptions.NotFoundException;
import com.daytracker.database.DatabaseConfig;
import com.daytracker.database.MigrationRunner;
import com.daytracker.database.MigrationScript;
import com.daytracker.events.EventRepository;
import com.daytracker.progress.ProgressResponse;
import com.daytracker.progress.ProgressService;
import com.daytracker.reading.Book.BookStatus;
import com.daytracker.reading.ReadingGoals.GoalService;
import com.daytracker.reviews.ReviewService;
import com.daytracker.settings.ZonePolicy;
import com.daytracker.tasks.TaskRepository;

/**
 * Reading effort, position, corrections, and effective-dated goals against a
 * real SQLite database with a controlled clock.
 */
class ReadingRulesTest {

	private static final ZoneId ZONE = ZoneId.of("America/Sao_Paulo");

	// 2026-10-05 09:00 in Sao Paulo (UTC-3).
	private static final Instant MONDAY_MORNING = Instant.parse("2026-10-05T12:00:00Z");

	@TempDir
	Path tempDir;

	private final MutableClock clock = new MutableClock(MONDAY_MORNING);

	private HikariDataSource dataSource;

	private BookService books;

	private ReadingSessionService sessions;

	private GoalService goals;

	private CalendarService calendar;

	private ProgressService progress;

	@BeforeEach
	void openDatabase() {
		dataSource = DatabaseConfig.createDataSource(tempDir.resolve("db").resolve("test.db"));
		new MigrationRunner(dataSource, tempDir.resolve("backups"), clock,
				MigrationScript.loadAll("classpath:db/migration/V*__*.sql"))
			.migrate();
		JdbcClient jdbc = JdbcClient.create(dataSource);
		BookRepository bookRepository = new BookRepository(jdbc);
		ReadingSessionRepository sessionRepository = new ReadingSessionRepository(jdbc);
		TaskRepository taskRepository = new TaskRepository(jdbc);
		books = new BookService(bookRepository, clock);
		sessions = new ReadingSessionService(sessionRepository, bookRepository, clock, ZonePolicy.fixed(ZONE));
		goals = new GoalService(jdbc, clock);
		calendar = new CalendarService(taskRepository, sessionRepository, goals, new EventRepository(jdbc),
				new ReviewService(jdbc, clock, ZonePolicy.fixed(ZONE)), clock, ZonePolicy.fixed(ZONE));
		progress = new ProgressService(taskRepository, sessionRepository, bookRepository, goals, clock,
				ZonePolicy.fixed(ZONE));
	}

	@AfterEach
	void closeDatabase() {
		dataSource.close();
	}

	private Book book(String title, int totalPages, int initialPage) {
		return books
			.create(new BookRequests.Create(UUID.randomUUID(), title, "An Author", totalPages, initialPage,
					BookStatus.READING))
			.book();
	}

	/** Records a session one second after the previous one, so creation order is unambiguous. */
	private ReadingSession read(Book book, String date, int pagesRead, Integer endingPage) {
		clock.advance(Duration.ofSeconds(1));
		return sessions
			.create(new SessionRequests.Create(UUID.randomUUID(), book.id(), LocalDate.parse(date), pagesRead,
					endingPage, null))
			.session();
	}

	private Book reload(Book book) {
		return books.get(book.id());
	}

	private ProgressResponse week() {
		return progress.progress(LocalDate.parse("2026-09-28"), LocalDate.parse("2026-10-05"));
	}

	private static SessionRequests.Update patch(ReadingSession session) {
		SessionRequests.Update request = new SessionRequests.Update();
		request.setVersion(session.version());
		return request;
	}

	@Test
	void aNewBookStartsAtItsInitialPageWithNoEffort() {
		Book fresh = book("Fresh", 300, 0);
		Book started = book("Started elsewhere", 300, 120);

		assertThat(fresh.currentPage()).isZero();
		assertThat(started.currentPage()).isEqualTo(120);
		assertThat(started.pagesReadTotal()).isZero();
	}

	@Test
	void severalSessionsOnOneDateAddUpAndTheLastOneSetsThePosition() {
		Book book = book("Dune", 600, 0);
		read(book, "2026-10-03", 20, 20);
		read(book, "2026-10-03", 15, 35);
		read(book, "2026-10-03", 10, null);

		DayResponse day = calendar.day(LocalDate.parse("2026-10-03"));

		assertThat(day.readingSessions()).hasSize(3);
		assertThat(day.readingSessions()).extracting(ReadingSession::bookTitle).containsOnly("Dune");
		assertThat(day.pagesRead()).isEqualTo(45);
		assertThat(reload(book).pagesReadTotal()).isEqualTo(45);
		// The session without an ending page adds effort but does not move the position.
		assertThat(reload(book).currentPage()).isEqualTo(35);
	}

	@Test
	void reReadingCountsAsEffortEvenThoughThePositionGoesBack() {
		Book book = book("Poems", 100, 0);
		read(book, "2026-10-01", 80, 80);
		read(book, "2026-10-02", 30, 30);

		assertThat(reload(book).currentPage()).isEqualTo(30);
		assertThat(reload(book).pagesReadTotal()).isEqualTo(110);
		assertThat(week().pagesRead()).isEqualTo(110);
	}

	@Test
	void aBackdatedSessionDoesNotOverrideANewerPosition() {
		Book book = book("History", 500, 0);
		read(book, "2026-10-04", 40, 200);

		// Recorded later, but about an earlier date.
		read(book, "2026-10-01", 25, 160);

		assertThat(reload(book).currentPage()).isEqualTo(200);
		assertThat(reload(book).pagesReadTotal()).isEqualTo(65);
		assertThat(calendar.day(LocalDate.parse("2026-10-01")).pagesRead()).isEqualTo(25);
	}

	@Test
	void correctingASessionRecalculatesItsDayItsWeekAndItsBook() {
		Book book = book("Novel", 400, 0);
		ReadingSession first = read(book, "2026-10-02", 30, 30);
		read(book, "2026-10-03", 20, 50);
		assertThat(week().pagesRead()).isEqualTo(50);
		assertThat(week().readingDays()).isEqualTo(2);

		// Wrong page count and wrong day: it was 45 pages on September 20, outside this week.
		SessionRequests.Update fix = patch(first);
		fix.setPagesRead(45);
		fix.setActivityDate(LocalDate.parse("2026-09-20"));
		ReadingSession corrected = sessions.update(first.id(), fix);

		assertThat(corrected.version()).isEqualTo(2);
		assertThat(calendar.day(LocalDate.parse("2026-10-02")).pagesRead()).isZero();
		assertThat(calendar.day(LocalDate.parse("2026-09-20")).pagesRead()).isEqualTo(45);
		assertThat(week().pagesRead()).isEqualTo(20);
		assertThat(week().readingDays()).isEqualTo(1);
		assertThat(reload(book).pagesReadTotal()).isEqualTo(65);
		assertThat(reload(book).currentPage()).isEqualTo(50);

		// Removing the position of the latest session falls back to the earlier one.
		ReadingSession latest = sessions.list(book.id(), null, null, 0, 10).items().get(0);
		SessionRequests.Update clear = patch(latest);
		clear.setEndingPage(null);
		sessions.update(latest.id(), clear);
		assertThat(reload(book).currentPage()).isEqualTo(30);

		assertThatThrownBy(() -> sessions.update(first.id(), fix)).isInstanceOf(ConflictException.class);
	}

	@Test
	void deletingASessionRemovesItFromEveryTotal() {
		Book book = book("Essays", 200, 10);
		ReadingSession only = read(book, "2026-10-03", 25, 35);
		assertThat(reload(book).currentPage()).isEqualTo(35);

		assertThatThrownBy(() -> sessions.delete(only.id(), 99)).isInstanceOf(ConflictException.class);
		sessions.delete(only.id(), only.version());
		// Repeating the delete is harmless.
		sessions.delete(only.id(), only.version());

		assertThat(reload(book).currentPage()).isEqualTo(10);
		assertThat(reload(book).pagesReadTotal()).isZero();
		assertThat(calendar.day(LocalDate.parse("2026-10-03")).readingSessions()).isEmpty();
		assertThat(week().pagesRead()).isZero();
		assertThat(week().readingDays()).isZero();
		assertThat(sessions.list(book.id(), null, null, 0, 10).total()).isZero();
		assertThatThrownBy(() -> sessions.update(only.id(), patch(only))).isInstanceOf(NotFoundException.class);
		assertThatThrownBy(() -> sessions.delete(UUID.randomUUID(), 1)).isInstanceOf(NotFoundException.class);
	}

	@Test
	void sessionsAreValidated() {
		Book book = book("Short", 120, 0);

		read(book, "2026-10-05", 5, 120);
		assertThatThrownBy(() -> read(book, "2026-10-06", 5, null)).isInstanceOf(InvalidInputException.class)
			.hasMessageContaining("future");
		assertThatThrownBy(() -> read(book, "2026-10-05", 0, null)).isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> read(book, "2026-10-05", -3, null)).isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> read(book, "2026-10-05", 5, 121)).isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> read(book, "2026-10-05", 5, -1)).isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> sessions.create(new SessionRequests.Create(UUID.randomUUID(), UUID.randomUUID(),
				LocalDate.parse("2026-10-05"), 5, null, null)))
			.isInstanceOf(InvalidInputException.class);

		// "Today" follows the local date: late on Monday evening in UTC-3 it is still Monday there.
		clock.set(Instant.parse("2026-10-06T02:30:00Z"));
		assertThatThrownBy(() -> read(book, "2026-10-06", 5, null)).isInstanceOf(InvalidInputException.class);
	}

	@Test
	void retryingTheSameSessionDoesNotDoubleCount() {
		Book book = book("Retry", 200, 0);
		SessionRequests.Create request = new SessionRequests.Create(UUID.randomUUID(), book.id(),
				LocalDate.parse("2026-10-04"), 12, 12, "On the train");

		assertThat(sessions.create(request).created()).isTrue();
		assertThat(sessions.create(request).created()).isFalse();
		assertThat(reload(book).pagesReadTotal()).isEqualTo(12);
		assertThatThrownBy(() -> sessions.create(new SessionRequests.Create(request.id(), book.id(),
				LocalDate.parse("2026-10-04"), 13, 12, "On the train")))
			.isInstanceOf(ConflictException.class);
	}

	@Test
	void totalPagesCannotDropBelowARecordedEndingPageUntilItIsCorrected() {
		Book book = book("Edition mix-up", 400, 0);
		ReadingSession session = read(book, "2026-10-03", 50, 350);

		assertThatThrownBy(() -> books.update(book.id(), new BookRequests.Update(1L, null, null, 320, null, null, null)))
			.isInstanceOf(InvalidInputException.class)
			.hasMessageContaining("page 350");
		assertThat(books.update(book.id(), new BookRequests.Update(1L, null, null, 350, null, null, null)).totalPages())
			.isEqualTo(350);

		SessionRequests.Update fix = patch(session);
		fix.setEndingPage(300);
		sessions.update(session.id(), fix);
		assertThat(books.update(book.id(), new BookRequests.Update(2L, null, null, 320, null, null, null)).totalPages())
			.isEqualTo(320);
		assertThatThrownBy(() -> books.update(book.id(), new BookRequests.Update(3L, null, null, 320, 321, null, null)))
			.isInstanceOf(InvalidInputException.class);
	}

	@Test
	void finishingIsExplicitAndArchivingKeepsHistory() {
		Book book = book("Finale", 150, 0);
		read(book, "2026-10-04", 150, 150);

		// Reaching the last page does not change the status by itself.
		assertThat(reload(book).status()).isEqualTo(BookStatus.READING);
		Book finished = books.update(book.id(),
				new BookRequests.Update(1L, null, null, null, null, BookStatus.FINISHED, null));
		assertThat(finished.status()).isEqualTo(BookStatus.FINISHED);
		assertThat(finished.currentPage()).isEqualTo(150);

		Book archived = books.update(book.id(), new BookRequests.Update(2L, null, null, null, null, null, true));
		assertThat(archived.archivedAt()).isNotNull();
		assertThat(books.list(false)).isEmpty();
		assertThat(books.list(true)).extracting(Book::id).containsExactly(book.id());
		// The history still counts and is still listed.
		assertThat(week().pagesRead()).isEqualTo(150);
		assertThat(sessions.list(book.id(), null, null, 0, 10).total()).isEqualTo(1);
		assertThatThrownBy(() -> read(book, "2026-10-05", 5, null)).isInstanceOf(InvalidInputException.class)
			.hasMessageContaining("archived");

		assertThat(books.update(book.id(), new BookRequests.Update(3L, null, null, null, null, null, false))
			.archivedAt()).isNull();
		assertThatThrownBy(
				() -> books.update(book.id(), new BookRequests.Update(1L, "Stale", null, null, null, null, null)))
			.isInstanceOf(ConflictException.class);
	}

	@Test
	void booksAreValidatedAndCreatedIdempotently() {
		UUID id = UUID.randomUUID();
		BookRequests.Create request = new BookRequests.Create(id, "  Trimmed  ", "  ", 250, null, null);

		Book created = books.create(request).book();
		assertThat(created.title()).isEqualTo("Trimmed");
		assertThat(created.author()).isNull();
		assertThat(created.status()).isEqualTo(BookStatus.TO_READ);
		assertThat(books.create(request).created()).isFalse();
		assertThat(books.update(id, new BookRequests.Update(1L, null, "Someone", null, null, null, null)).author())
			.isEqualTo("Someone");
		assertThat(books.update(id, new BookRequests.Update(2L, null, "", null, null, null, null)).author()).isNull();

		assertThatThrownBy(() -> books.create(new BookRequests.Create(UUID.randomUUID(), " ", null, 100, 0, null)))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> books.create(new BookRequests.Create(UUID.randomUUID(), "Zero", null, 0, 0, null)))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> books.create(new BookRequests.Create(UUID.randomUUID(), "Past end", null, 100, 101,
				null)))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> books.create(new BookRequests.Create(UUID.randomUUID(), "Negative", null, 100, -1,
				null)))
			.isInstanceOf(InvalidInputException.class);
	}

	@Test
	void theReadingGoalChangesFromItsEffectiveDateWithoutRewritingEarlierDays() {
		LocalDate monday = LocalDate.parse("2026-10-05");
		assertThat(goals.effectiveOn(monday).targetPages()).isEqualTo(30);
		assertThat(goals.effectiveOn(monday).effectiveDate()).isNull();

		goals.set(LocalDate.parse("2026-10-03"), 40);
		goals.set(LocalDate.parse("2026-10-10"), 20);

		assertThat(goals.effectiveOn(LocalDate.parse("2026-10-02")).targetPages()).isEqualTo(30);
		assertThat(goals.effectiveOn(LocalDate.parse("2026-10-03")).targetPages()).isEqualTo(40);
		assertThat(goals.effectiveOn(LocalDate.parse("2026-10-09")).targetPages()).isEqualTo(40);
		assertThat(goals.effectiveOn(LocalDate.parse("2026-10-10")).targetPages()).isEqualTo(20);
		assertThat(goals.effectiveOn(LocalDate.parse("2027-01-01")).effectiveDate())
			.isEqualTo(LocalDate.parse("2026-10-10"));

		// Each day in a report carries the target that applied on it.
		assertThat(progress.progress(LocalDate.parse("2026-10-01"), LocalDate.parse("2026-10-05")).days())
			.extracting(ProgressResponse.DayProgress::targetPages)
			.containsExactly(30, 30, 40, 40);
		assertThat(calendar.day(LocalDate.parse("2026-10-04")).readingGoal().targetPages()).isEqualTo(40);

		// Setting the same date again replaces only that entry.
		goals.set(LocalDate.parse("2026-10-03"), 45);
		assertThat(goals.history()).extracting(ReadingGoals.Goal::targetPages).containsExactly(45, 20);
		assertThatThrownBy(() -> goals.set(monday, 0)).isInstanceOf(InvalidInputException.class);
	}

	@Test
	void progressAndCalendarReportReadingByDate() {
		Book first = book("First", 300, 0);
		Book second = book("Second", 300, 0);
		read(first, "2026-09-29", 10, 10);
		read(second, "2026-09-29", 5, 5);
		read(first, "2026-10-01", 50, 60);
		read(first, "2026-09-27", 99, null);

		ProgressResponse report = week();

		assertThat(report.pagesRead()).isEqualTo(65);
		assertThat(report.readingDays()).isEqualTo(2);
		assertThat(report.days()).extracting(ProgressResponse.DayProgress::pagesRead)
			.containsExactly(0L, 15L, 0L, 50L, 0L, 0L, 0L);

		// One calendar entry per book read on a date, so each shows its own cover and name.
		assertThat(calendar.range(LocalDate.parse("2026-09-28"), LocalDate.parse("2026-10-05")).items())
			.extracting(CalendarItemResponse::type, CalendarItemResponse::date, CalendarItemResponse::title,
					CalendarItemResponse::pagesRead)
			.containsExactly(
					org.assertj.core.groups.Tuple.tuple(CalendarItemResponse.CalendarItemType.READING,
							LocalDate.parse("2026-09-29"), "First", 10L),
					org.assertj.core.groups.Tuple.tuple(CalendarItemResponse.CalendarItemType.READING,
							LocalDate.parse("2026-09-29"), "Second", 5L),
					org.assertj.core.groups.Tuple.tuple(CalendarItemResponse.CalendarItemType.READING,
							LocalDate.parse("2026-10-01"), "First", 50L));
	}

}
