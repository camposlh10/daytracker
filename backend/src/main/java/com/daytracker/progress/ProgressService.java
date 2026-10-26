package com.daytracker.progress;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.progress.ProgressResponse.BookProgress;
import com.daytracker.progress.ProgressResponse.DayProgress;
import com.daytracker.reading.Book;
import com.daytracker.reading.BookRepository;
import com.daytracker.reading.ReadingGoals.Goal;
import com.daytracker.reading.ReadingGoals.GoalService;
import com.daytracker.reading.ReadingSessionRepository;
import com.daytracker.reading.ReadingSessionRepository.BookDayPages;
import com.daytracker.settings.ZonePolicy;
import com.daytracker.tasks.Task;
import com.daytracker.tasks.TaskRepository;
import com.daytracker.tasks.TaskResponse;

@Service
public class ProgressService {

	static final int MAX_RANGE_DAYS = 366;

	static final int MAX_LISTED_TASKS = 500;

	private final TaskRepository tasks;

	private final ReadingSessionRepository readingSessions;

	private final BookRepository books;

	private final GoalService readingGoals;

	private final Clock clock;

	private final ZonePolicy zonePolicy;

	public ProgressService(TaskRepository tasks, ReadingSessionRepository readingSessions, BookRepository books,
			GoalService readingGoals, Clock clock, ZonePolicy zonePolicy) {
		this.tasks = tasks;
		this.readingSessions = readingSessions;
		this.books = books;
		this.readingGoals = readingGoals;
		this.clock = clock;
		this.zonePolicy = zonePolicy;
	}

	/**
	 * Tasks completed are counted on the local date of their completion time.
	 * Reading is counted on each session's own activity date, and each date
	 * carries the target that was in force on it.
	 */
	@Transactional(readOnly = true)
	public ProgressResponse progress(LocalDate from, LocalDate toExclusive) {
		if (!toExclusive.isAfter(from)) {
			throw new InvalidInputException("to", "The end date must be after the start date.");
		}
		if (ChronoUnit.DAYS.between(from, toExclusive) > MAX_RANGE_DAYS) {
			throw new InvalidInputException("to", "A progress query is limited to " + MAX_RANGE_DAYS + " days.");
		}
		ZoneId zone = zonePolicy.zone();
		LocalDate today = LocalDate.now(clock.withZone(zone));
		Instant start = from.atStartOfDay(zone).toInstant();
		Instant end = toExclusive.atStartOfDay(zone).toInstant();

		List<Task> completed = tasks.findCompletedBetween(start, end);
		Map<LocalDate, Long> completedByDate = completed.stream()
			.map(task -> task.completedAt().atZone(zone).toLocalDate())
			.collect(Collectors.groupingBy(Function.identity(), Collectors.counting()));
		List<BookDayPages> reading = readingSessions.sumPagesByDateAndBook(from, toExclusive);
		Map<LocalDate, Long> pagesByDate = reading.stream()
			.collect(Collectors.groupingBy(BookDayPages::date, Collectors.summingLong(BookDayPages::pages)));
		List<Goal> goals = readingGoals.history();

		List<DayProgress> days = new ArrayList<>();
		long pagesRead = 0;
		int readingDays = 0;
		int elapsedDays = 0;
		long elapsedTargets = 0;
		long elapsedPages = 0;
		for (LocalDate date = from; date.isBefore(toExclusive); date = date.plusDays(1)) {
			long pages = pagesByDate.getOrDefault(date, 0L);
			int target = GoalService.effectiveOn(date, goals).targetPages();
			boolean future = date.isAfter(today);
			pagesRead += pages;
			if (pages > 0) {
				readingDays++;
			}
			if (!future) {
				elapsedDays++;
				elapsedTargets += target;
				elapsedPages += pages;
			}
			days.add(new DayProgress(date, completedByDate.getOrDefault(date, 0L), pages, target,
					future ? null : percent(pages, target), future));
		}

		long tasksPlanned = tasks.findPlannedBetween(from, toExclusive).size();
		List<TaskResponse> listed = completed.stream().limit(MAX_LISTED_TASKS).map(TaskResponse::from).toList();
		return new ProgressResponse(from, toExclusive, today, completed.size(), tasksPlanned, pagesRead, readingDays,
				elapsedDays, elapsedDays == 0 ? null : percent(readingDays, elapsedDays),
				elapsedDays == 0 ? null : percent(elapsedPages, elapsedTargets), days, listed, bookProgress(reading));
	}

	private List<BookProgress> bookProgress(List<BookDayPages> reading) {
		Map<UUID, Long> pagesByBook = new LinkedHashMap<>();
		for (BookDayPages row : reading) {
			pagesByBook.merge(row.bookId(), row.pages(), Long::sum);
		}
		List<BookProgress> result = new ArrayList<>();
		for (Map.Entry<UUID, Long> entry : pagesByBook.entrySet()) {
			// Archived books keep their history, so they are included.
			Book book = books.findById(entry.getKey()).orElseThrow();
			result.add(new BookProgress(book.id(), book.title(), book.coverUpdatedAt(), entry.getValue(),
					book.currentPage(), book.totalPages(), percent(book.currentPage(), book.totalPages())));
		}
		return result;
	}

	private static int percent(long part, long whole) {
		return whole <= 0 ? 0 : (int) Math.round(part * 100.0 / whole);
	}

}
