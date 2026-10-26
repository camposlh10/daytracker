package com.daytracker.tasks;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
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
import com.daytracker.calendar.CalendarService;
import com.daytracker.calendar.DayResponse;
import com.daytracker.categories.CategoryRepository;
import com.daytracker.categories.CategoryRequests;
import com.daytracker.categories.CategoryService;
import com.daytracker.common.ApiExceptions.ConflictException;
import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.database.DatabaseConfig;
import com.daytracker.database.MigrationRunner;
import com.daytracker.database.MigrationScript;
import com.daytracker.events.EventRepository;
import com.daytracker.progress.ProgressResponse;
import com.daytracker.progress.ProgressService;
import com.daytracker.reading.BookRepository;
import com.daytracker.reading.ReadingGoals.GoalService;
import com.daytracker.reading.ReadingSessionRepository;
import com.daytracker.reviews.ReviewService;
import com.daytracker.settings.ZonePolicy;

/**
 * Completion, reopening, carry-over, and completion totals against a real SQLite
 * database with a controlled clock.
 */
class TaskRulesTest {

	private static final ZoneId ZONE = ZoneId.of("America/Sao_Paulo");

	// 2026-10-05 09:00 in Sao Paulo (UTC-3).
	private static final Instant MONDAY_MORNING = Instant.parse("2026-10-05T12:00:00Z");

	@TempDir
	Path tempDir;

	private final MutableClock clock = new MutableClock(MONDAY_MORNING);

	private HikariDataSource dataSource;

	private TaskService tasks;

	private CategoryService categories;

	private CalendarService calendar;

	private ProgressService progress;

	@BeforeEach
	void openDatabase() {
		dataSource = DatabaseConfig.createDataSource(tempDir.resolve("db").resolve("test.db"));
		new MigrationRunner(dataSource, tempDir.resolve("backups"), clock,
				MigrationScript.loadAll("classpath:db/migration/V*__*.sql"))
			.migrate();
		JdbcClient jdbc = JdbcClient.create(dataSource);
		TaskRepository taskRepository = new TaskRepository(jdbc);
		CategoryRepository categoryRepository = new CategoryRepository(jdbc);
		tasks = new TaskService(taskRepository, categoryRepository, clock);
		categories = new CategoryService(categoryRepository, clock);
		ReadingSessionRepository sessionRepository = new ReadingSessionRepository(jdbc);
		GoalService goals = new GoalService(jdbc, clock);
		calendar = new CalendarService(taskRepository, sessionRepository, goals, new EventRepository(jdbc),
				new ReviewService(jdbc, clock, ZonePolicy.fixed(ZONE)), clock, ZonePolicy.fixed(ZONE));
		progress = new ProgressService(taskRepository, sessionRepository, new BookRepository(jdbc), goals, clock,
				ZonePolicy.fixed(ZONE));
	}

	@AfterEach
	void closeDatabase() {
		dataSource.close();
	}

	private Task create(String title, String plannedDate) {
		return tasks
			.create(new CreateTaskRequest(UUID.randomUUID(), title, null, null, null,
					plannedDate == null ? null : LocalDate.parse(plannedDate), null))
			.task();
	}

	private static UpdateTaskRequest patch(Task task) {
		UpdateTaskRequest request = new UpdateTaskRequest();
		request.setVersion(task.version());
		return request;
	}

	private Task setStatus(Task task, TaskStatus status) {
		UpdateTaskRequest request = patch(task);
		request.setStatus(status);
		return tasks.update(task.id(), request);
	}

	private Task archive(Task task) {
		UpdateTaskRequest request = patch(task);
		request.setArchived(true);
		return tasks.update(task.id(), request);
	}

	private long completedOn(String date) {
		LocalDate day = LocalDate.parse(date);
		return progress.progress(day, day.plusDays(1)).tasksCompleted();
	}

	@Test
	void completingSetsTheCompletionTimeOnlyOnTheTransitionIntoDone() {
		Task task = create("Write report", "2026-10-05");

		Task done = setStatus(task, TaskStatus.DONE);
		assertThat(done.status()).isEqualTo(TaskStatus.DONE);
		assertThat(done.completedAt()).isEqualTo(MONDAY_MORNING);
		assertThat(done.version()).isEqualTo(2);

		// The same request again, a day later: nothing moves.
		clock.advance(Duration.ofDays(1));
		Task again = setStatus(done, TaskStatus.DONE);
		assertThat(again.completedAt()).isEqualTo(MONDAY_MORNING);
		assertThat(again.version()).isEqualTo(2);

		// Editing another field of a done task keeps its completion time.
		UpdateTaskRequest rename = patch(again);
		rename.setTitle("Write the report");
		Task renamed = tasks.update(task.id(), rename);
		assertThat(renamed.completedAt()).isEqualTo(MONDAY_MORNING);
		assertThat(renamed.version()).isEqualTo(3);
	}

	@Test
	void aRequestWithAStaleVersionIsRefusedAndChangesNothing() {
		Task task = create("Write report", "2026-10-05");
		Task done = setStatus(task, TaskStatus.DONE);
		clock.advance(Duration.ofHours(5));

		assertThatThrownBy(() -> setStatus(task, TaskStatus.DONE)).isInstanceOf(ConflictException.class);
		assertThatThrownBy(() -> setStatus(task, TaskStatus.IN_PROGRESS)).isInstanceOf(ConflictException.class);
		assertThat(tasks.get(task.id())).isEqualTo(done);
	}

	@Test
	void reopeningRemovesTheTaskFromTotalsAndCompletingAgainCountsOnTheNewDate() {
		Task task = create("Write report", "2026-10-05");
		Task done = setStatus(task, TaskStatus.DONE);
		assertThat(completedOn("2026-10-05")).isEqualTo(1);

		clock.advance(Duration.ofDays(1));
		Task reopened = setStatus(done, TaskStatus.PENDING);
		assertThat(reopened.completedAt()).isNull();
		assertThat(completedOn("2026-10-05")).isZero();

		clock.advance(Duration.ofDays(1));
		Task doneAgain = setStatus(reopened, TaskStatus.DONE);
		assertThat(doneAgain.completedAt()).isEqualTo(MONDAY_MORNING.plus(Duration.ofDays(2)));
		assertThat(completedOn("2026-10-05")).isZero();
		assertThat(completedOn("2026-10-07")).isEqualTo(1);

		// The ledger keeps every transition even though totals count only the current completion.
		List<TaskActivityResponse> history = tasks.activity(task.id());
		assertThat(history).extracting(TaskActivityResponse::action)
			.containsExactly("CREATED", "COMPLETED", "REOPENED", "COMPLETED");
		assertThat(history.get(2).previousStatus()).isEqualTo(TaskStatus.DONE);
		assertThat(history.get(2).newStatus()).isEqualTo(TaskStatus.PENDING);
	}

	@Test
	void completionIsCountedOnTheLocalDateNotTheUtcDate() {
		// 23:30 on Monday in Sao Paulo is already Tuesday in UTC.
		clock.set(Instant.parse("2026-10-06T02:30:00Z"));
		setStatus(create("Late task", null), TaskStatus.DONE);

		assertThat(completedOn("2026-10-05")).isEqualTo(1);
		assertThat(completedOn("2026-10-06")).isZero();
	}

	@Test
	void progressReportsADailySeriesAndCountsArchivedAndUnscheduledWork() {
		Task planned = setStatus(create("Planned", "2026-10-01"), TaskStatus.DONE);
		setStatus(create("Unscheduled", null), TaskStatus.DONE);
		create("Still open", "2026-10-05");
		archive(planned);
		clock.advance(Duration.ofDays(2));
		setStatus(create("Wednesday", null), TaskStatus.DONE);

		ProgressResponse week = progress.progress(LocalDate.parse("2026-10-05"), LocalDate.parse("2026-10-12"));

		assertThat(week.tasksCompleted()).isEqualTo(3);
		assertThat(week.days()).hasSize(7);
		assertThat(week.days()).extracting(ProgressResponse.DayProgress::tasksCompleted)
			.containsExactly(2L, 0L, 1L, 0L, 0L, 0L, 0L);
		assertThat(week.days().get(0).date()).isEqualTo(LocalDate.parse("2026-10-05"));
		assertThatThrownBy(() -> progress.progress(LocalDate.parse("2026-01-01"), LocalDate.parse("2027-01-03")))
			.isInstanceOf(InvalidInputException.class);
	}

	@Test
	void aCompletedTaskStaysOnItsPlannedDateInTheCalendar() {
		Task task = create("Planned last week", "2026-09-29");
		setStatus(task, TaskStatus.DONE);

		DayResponse plannedDay = calendar.day(LocalDate.parse("2026-09-29"));

		assertThat(plannedDay.tasks()).extracting(TaskResponse::status).containsExactly(TaskStatus.DONE);
		assertThat(completedOn("2026-09-29")).isZero();
		assertThat(completedOn("2026-10-05")).isEqualTo(1);
	}

	@Test
	void carryOverListsOverdueUnfinishedTasksWithoutReschedulingThem() {
		Task overdue = create("Overdue", "2026-10-02");
		Task inProgress = setStatus(create("Half done", "2026-10-03"), TaskStatus.IN_PROGRESS);
		setStatus(create("Finished", "2026-10-02"), TaskStatus.DONE);
		create("Today", "2026-10-05");
		create("Tomorrow", "2026-10-06");
		create("Unscheduled", null);
		archive(create("Archived", "2026-10-01"));

		// Today: everything unfinished from earlier dates, oldest first.
		DayResponse today = calendar.day(LocalDate.parse("2026-10-05"));
		assertThat(today.carryOver()).extracting(TaskResponse::title).containsExactly("Overdue", "Half done");
		assertThat(today.tasks()).extracting(TaskResponse::title).containsExactly("Today");

		// A future date: still only what is overdue today, not tasks planned in between.
		assertThat(calendar.day(LocalDate.parse("2026-10-20")).carryOver()).extracting(TaskResponse::title)
			.containsExactly("Overdue", "Half done");
		// A past date: only what was planned before it.
		assertThat(calendar.day(LocalDate.parse("2026-10-03")).carryOver()).extracting(TaskResponse::title)
			.containsExactly("Overdue");

		// Nothing was rescheduled by looking.
		assertThat(tasks.get(overdue.id()).plannedDate()).isEqualTo(LocalDate.parse("2026-10-02"));

		// Moving is explicit and recorded.
		UpdateTaskRequest move = patch(overdue);
		move.setPlannedDate(LocalDate.parse("2026-10-05"));
		tasks.update(overdue.id(), move);
		DayResponse after = calendar.day(LocalDate.parse("2026-10-05"));
		assertThat(after.carryOver()).extracting(TaskResponse::id).containsExactly(inProgress.id());
		assertThat(after.tasks()).extracting(TaskResponse::title).containsExactlyInAnyOrder("Today", "Overdue");
		TaskActivityResponse moved = tasks.activity(overdue.id()).get(1);
		assertThat(moved.action()).isEqualTo("RESCHEDULED");
		assertThat(moved.previousPlannedDate()).isEqualTo(LocalDate.parse("2026-10-02"));
		assertThat(moved.newPlannedDate()).isEqualTo(LocalDate.parse("2026-10-05"));
	}

	@Test
	void archivingHidesATaskAndRestoringBringsItBack() {
		Task task = create("Old idea", "2026-10-05");
		Task archived = archive(task);

		assertThat(archived.archivedAt()).isEqualTo(MONDAY_MORNING);
		assertThat(tasks.list(TaskQuery.active(), 0, 50).total()).isZero();
		assertThat(calendar.day(LocalDate.parse("2026-10-05")).tasks()).isEmpty();
		assertThat(tasks.list(new TaskQuery(null, null, null, null, null, null, null, true), 0, 50).items())
			.extracting(TaskResponse::id)
			.containsExactly(task.id());

		UpdateTaskRequest restore = patch(archived);
		restore.setArchived(false);
		assertThat(tasks.update(task.id(), restore).archivedAt()).isNull();
		assertThat(tasks.list(TaskQuery.active(), 0, 50).total()).isEqualTo(1);
		assertThat(tasks.activity(task.id())).extracting(TaskActivityResponse::action)
			.containsExactly("CREATED", "ARCHIVED", "RESTORED");
	}

	@Test
	void plannedAndDeadlineDatesAreIndependentAndCanBeCleared() {
		Task task = tasks
			.create(new CreateTaskRequest(UUID.randomUUID(), "Taxes", "Gather receipts", null, TaskPriority.HIGH,
					LocalDate.parse("2026-10-10"), LocalDate.parse("2026-10-31")))
			.task();

		UpdateTaskRequest clearPlanned = patch(task);
		clearPlanned.setPlannedDate(null);
		Task unscheduled = tasks.update(task.id(), clearPlanned);

		assertThat(unscheduled.plannedDate()).isNull();
		assertThat(unscheduled.deadlineDate()).isEqualTo(LocalDate.parse("2026-10-31"));
		assertThat(unscheduled.description()).isEqualTo("Gather receipts");
		assertThat(tasks.list(new TaskQuery(null, null, null, null, null, null, false, false), 0, 50).items())
			.extracting(TaskResponse::id)
			.containsExactly(task.id());
	}

	@Test
	void filtersCombineAndCategoriesMustBeUsable() {
		UUID workId = UUID.randomUUID();
		categories.create(new CategoryRequests.Create(workId, "Work", "#668be8"));
		Task work = tasks
			.create(new CreateTaskRequest(UUID.randomUUID(), "Prepare slides", "For the Monday review", workId,
					TaskPriority.HIGH, LocalDate.parse("2026-10-05"), null))
			.task();
		create("Buy milk", "2026-10-05");
		setStatus(create("Review notes", "2026-10-06"), TaskStatus.DONE);

		assertThat(titles(new TaskQuery("review", null, null, null, null, null, null, false)))
			.containsExactlyInAnyOrder("Prepare slides", "Review notes");
		assertThat(titles(new TaskQuery("review", TaskStatus.DONE, null, null, null, null, null, false)))
			.containsExactly("Review notes");
		assertThat(titles(new TaskQuery(null, null, TaskPriority.HIGH, workId, null, null, null, false)))
			.containsExactly("Prepare slides");
		assertThat(titles(new TaskQuery(null, null, null, null, LocalDate.parse("2026-10-05"),
				LocalDate.parse("2026-10-06"), null, false)))
			.containsExactlyInAnyOrder("Prepare slides", "Buy milk");

		// An archived category stays on existing tasks but cannot be newly assigned.
		categories.update(workId, new CategoryRequests.Update(1L, null, null, true));
		assertThat(tasks.get(work.id()).categoryId()).isEqualTo(workId);
		assertThatThrownBy(
				() -> tasks.create(new CreateTaskRequest(UUID.randomUUID(), "New", null, workId, null, null, null)))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> tasks
			.create(new CreateTaskRequest(UUID.randomUUID(), "New", null, UUID.randomUUID(), null, null, null)))
			.isInstanceOf(InvalidInputException.class);
		// Editing another field of a task that keeps its archived category is still allowed.
		UpdateTaskRequest rename = patch(work);
		rename.setTitle("Prepare the slides");
		assertThat(tasks.update(work.id(), rename).categoryId()).isEqualTo(workId);
	}

	private List<String> titles(TaskQuery query) {
		return tasks.list(query, 0, 50).items().stream().map(TaskResponse::title).toList();
	}

}
