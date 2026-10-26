package com.daytracker.progress;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.daytracker.MutableClock;
import com.daytracker.categories.CategoryRepository;
import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.database.DatabaseConfig;
import com.daytracker.database.MigrationRunner;
import com.daytracker.database.MigrationScript;
import com.daytracker.progress.ProgressResponse.DayProgress;
import com.daytracker.reading.Book.BookStatus;
import com.daytracker.reading.BookRepository;
import com.daytracker.reading.BookRequests;
import com.daytracker.reading.BookService;
import com.daytracker.reading.ReadingGoals.GoalService;
import com.daytracker.reading.ReadingSessionRepository;
import com.daytracker.reading.ReadingSessionService;
import com.daytracker.reading.SessionRequests;
import com.daytracker.settings.ZonePolicy;
import com.daytracker.tasks.CreateTaskRequest;
import com.daytracker.tasks.Task;
import com.daytracker.tasks.TaskRepository;
import com.daytracker.tasks.TaskService;
import com.daytracker.tasks.TaskStatus;
import com.daytracker.tasks.UpdateTaskRequest;

/** The progress report: periods in progress, future periods, targets, and the timezone setting. */
class ProgressReportTest {

	private static final ZoneId SAO_PAULO = ZoneId.of("America/Sao_Paulo");

	// Wednesday 2026-10-21, 09:00 in Sao Paulo.
	private static final Instant WEDNESDAY = Instant.parse("2026-10-21T12:00:00Z");

	@TempDir
	Path tempDir;

	private final MutableClock clock = new MutableClock(WEDNESDAY);

	private final AtomicReference<ZoneId> zone = new AtomicReference<>(SAO_PAULO);

	private HikariDataSource dataSource;

	private TaskService tasks;

	private BookService books;

	private ReadingSessionService sessions;

	private GoalService goals;

	private ProgressService progress;

	@BeforeEach
	void setUp() {
		dataSource = DatabaseConfig.createDataSource(tempDir.resolve("db").resolve("test.db"));
		new MigrationRunner(dataSource, tempDir.resolve("backups"), clock,
				MigrationScript.loadAll("classpath:db/migration/V*__*.sql"))
			.migrate();
		JdbcClient jdbc = JdbcClient.create(dataSource);
		ZonePolicy policy = zone::get;
		TaskRepository taskRepository = new TaskRepository(jdbc);
		BookRepository bookRepository = new BookRepository(jdbc);
		ReadingSessionRepository sessionRepository = new ReadingSessionRepository(jdbc);
		tasks = new TaskService(taskRepository, new CategoryRepository(jdbc), clock);
		books = new BookService(bookRepository, clock);
		sessions = new ReadingSessionService(sessionRepository, bookRepository, clock, policy);
		goals = new GoalService(jdbc, clock);
		progress = new ProgressService(taskRepository, sessionRepository, bookRepository, goals, clock, policy);
	}

	@AfterEach
	void tearDown() {
		dataSource.close();
	}

	private ProgressResponse week(String monday) {
		LocalDate start = LocalDate.parse(monday);
		return progress.progress(start, start.plusDays(7));
	}

	private com.daytracker.reading.Book book(String title, int pages) {
		return books.create(new BookRequests.Create(UUID.randomUUID(), title, "Author", pages, 0, BookStatus.READING))
			.book();
	}

	private void read(com.daytracker.reading.Book book, String date, int pages, Integer endingPage) {
		clock.advance(Duration.ofSeconds(1));
		sessions.create(new SessionRequests.Create(UUID.randomUUID(), book.id(), LocalDate.parse(date), pages, endingPage, null));
	}

	private Task complete(String title, String plannedDate) {
		Task task = tasks.create(new CreateTaskRequest(UUID.randomUUID(), title, null, null, null,
				plannedDate == null ? null : LocalDate.parse(plannedDate), null)).task();
		UpdateTaskRequest done = new UpdateTaskRequest();
		done.setVersion(task.version());
		done.setStatus(TaskStatus.DONE);
		return tasks.update(task.id(), done);
	}

	@Test
	void aWeekInProgressIsJudgedOnlyOnTheDaysThatHaveBegun() {
		var dune = book("Dune", 600);
		read(dune, "2026-10-19", 40, 40);
		read(dune, "2026-10-20", 10, 50);

		ProgressResponse report = week("2026-10-19");

		assertThat(report.today()).isEqualTo(LocalDate.parse("2026-10-21"));
		assertThat(report.elapsedDays()).isEqualTo(3);
		assertThat(report.readingDays()).isEqualTo(2);
		// 2 of the 3 days that have begun, not 2 of 7.
		assertThat(report.consistencyPercent()).isEqualTo(67);
		// 50 pages against targets of 30 on each of the 3 elapsed days.
		assertThat(report.pagesRead()).isEqualTo(50);
		assertThat(report.targetPercent()).isEqualTo(56);
		assertThat(report.days()).extracting(DayProgress::future)
			.containsExactly(false, false, false, true, true, true, true);
		assertThat(report.days().get(5).targetPercent()).isNull();
	}

	@Test
	void targetPercentIsNotCappedByTheServerSoTheScreenCanShowTheRealFigure() {
		var dune = book("Dune", 600);
		read(dune, "2026-10-19", 45, 45);

		DayProgress day = week("2026-10-19").days().get(0);

		assertThat(day.pagesRead()).isEqualTo(45);
		assertThat(day.targetPages()).isEqualTo(30);
		assertThat(day.targetPercent()).isEqualTo(150);
	}

	@Test
	void eachDayCarriesTheTargetThatWasInForceOnIt() {
		var dune = book("Dune", 600);
		goals.set(LocalDate.parse("2026-10-20"), 50);
		read(dune, "2026-10-19", 30, 30);
		read(dune, "2026-10-20", 30, 60);

		ProgressResponse report = week("2026-10-19");

		assertThat(report.days().get(0).targetPercent()).isEqualTo(100);
		assertThat(report.days().get(1).targetPages()).isEqualTo(50);
		assertThat(report.days().get(1).targetPercent()).isEqualTo(60);
		// 60 pages over 30 + 50 + 50.
		assertThat(report.targetPercent()).isEqualTo(46);
	}

	@Test
	void aFuturePeriodShowsPlannedWorkAndNoInventedRates() {
		tasks.create(new CreateTaskRequest(UUID.randomUUID(), "Next week", null, null, null, LocalDate.parse("2026-10-27"), null));
		tasks.create(new CreateTaskRequest(UUID.randomUUID(), "Also next week", null, null, null, LocalDate.parse("2026-10-30"), null));

		ProgressResponse report = week("2026-10-26");

		assertThat(report.elapsedDays()).isZero();
		assertThat(report.tasksPlanned()).isEqualTo(2);
		assertThat(report.consistencyPercent()).isNull();
		assertThat(report.targetPercent()).isNull();
		assertThat(report.tasksCompleted()).isZero();
		assertThat(report.days()).allMatch(DayProgress::future);
	}

	@Test
	void anEmptyPastPeriodHasZeroesNotMissingValues() {
		ProgressResponse report = week("2026-10-05");

		assertThat(report.tasksCompleted()).isZero();
		assertThat(report.pagesRead()).isZero();
		assertThat(report.readingDays()).isZero();
		assertThat(report.elapsedDays()).isEqualTo(7);
		assertThat(report.consistencyPercent()).isZero();
		assertThat(report.completedTasks()).isEmpty();
		assertThat(report.books()).isEmpty();
	}

	@Test
	void theRecordsBehindTheTotalsAreIncluded() {
		var dune = book("Dune", 600);
		var essays = book("Essays", 200);
		read(dune, "2026-10-19", 40, 40);
		read(essays, "2026-10-20", 25, 25);
		read(dune, "2026-10-21", 20, 60);
		Task done = complete("Ship it", "2026-10-19");

		ProgressResponse report = week("2026-10-19");

		assertThat(report.completedTasks()).extracting(t -> t.id()).containsExactly(done.id());
		// Planned counts the tasks planned for the period whether or not they are finished.
		assertThat(report.tasksPlanned()).isEqualTo(1);
		assertThat(report.books()).extracting(ProgressResponse.BookProgress::title, ProgressResponse.BookProgress::pagesRead,
				ProgressResponse.BookProgress::currentPage, ProgressResponse.BookProgress::positionPercent)
			.containsExactly(org.assertj.core.groups.Tuple.tuple("Dune", 60L, 60, 10),
					org.assertj.core.groups.Tuple.tuple("Essays", 25L, 25, 13));
	}

	@Test
	void changingTheTimezoneRegroupsCompletionsButNotReadingDates() {
		var dune = book("Dune", 600);
		read(dune, "2026-10-20", 10, 10);
		// Completed at 23:30 on Tuesday the 20th in Sao Paulo, which is already the 21st in Lisbon (UTC+1).
		clock.set(Instant.parse("2026-10-21T02:30:00Z"));
		complete("Late", null);
		clock.set(WEDNESDAY);

		assertThat(progress.progress(LocalDate.parse("2026-10-20"), LocalDate.parse("2026-10-21")).tasksCompleted()).isEqualTo(1);

		zone.set(ZoneId.of("Europe/Lisbon"));

		ProgressResponse tuesday = progress.progress(LocalDate.parse("2026-10-20"), LocalDate.parse("2026-10-21"));
		ProgressResponse wednesday = progress.progress(LocalDate.parse("2026-10-21"), LocalDate.parse("2026-10-22"));
		assertThat(tuesday.tasksCompleted()).isZero();
		assertThat(wednesday.tasksCompleted()).isEqualTo(1);
		// A reading session keeps the date it was recorded for.
		assertThat(tuesday.pagesRead()).isEqualTo(10);
	}

	@Test
	void todayFollowsTheTimezoneToo() {
		clock.set(Instant.parse("2026-10-22T01:30:00Z"));

		assertThat(week("2026-10-19").today()).isEqualTo(LocalDate.parse("2026-10-21"));
		zone.set(ZoneId.of("Asia/Tokyo"));
		assertThat(week("2026-10-19").today()).isEqualTo(LocalDate.parse("2026-10-22"));
	}

	@Test
	void archivedBooksKeepTheirReadingHistoryInTheReport() {
		var dune = book("Dune", 600);
		read(dune, "2026-10-19", 40, 40);
		books.update(dune.id(), new BookRequests.Update(1L, null, null, null, null, null, true));

		ProgressResponse report = week("2026-10-19");

		assertThat(report.pagesRead()).isEqualTo(40);
		assertThat(report.books()).hasSize(1);
	}

	@Test
	void rangesAreBounded() {
		assertThatThrownBy(() -> progress.progress(LocalDate.parse("2026-01-01"), LocalDate.parse("2027-01-03")))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> progress.progress(LocalDate.parse("2026-01-02"), LocalDate.parse("2026-01-02")))
			.isInstanceOf(InvalidInputException.class);
	}

}
