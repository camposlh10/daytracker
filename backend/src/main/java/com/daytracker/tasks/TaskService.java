package com.daytracker.tasks;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
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

@Service
public class TaskService {

	static final int MAX_TITLE_LENGTH = 200;

	static final int MAX_DESCRIPTION_LENGTH = 5_000;

	static final int MAX_SEARCH_LENGTH = 200;

	public record CreateResult(Task task, boolean created) {
	}

	private final TaskRepository repository;

	private final CategoryRepository categories;

	private final Clock clock;

	public TaskService(TaskRepository repository, CategoryRepository categories, Clock clock) {
		this.repository = repository;
		this.categories = categories;
		this.clock = clock;
	}

	/**
	 * Creates a task, or returns the existing one when the same request is replayed.
	 * A different payload under an existing id is a conflict.
	 */
	@Transactional
	public CreateResult create(CreateTaskRequest request) {
		String title = cleanTitle(request.title());
		String description = cleanDescription(request.description());
		TaskPriority priority = request.priority() == null ? TaskPriority.MEDIUM : request.priority();

		Optional<Task> existing = repository.findById(request.id());
		if (existing.isPresent()) {
			Task task = existing.get();
			boolean samePayload = task.title().equals(title) && Objects.equals(task.description(), description)
					&& Objects.equals(task.categoryId(), request.categoryId()) && task.priority() == priority
					&& Objects.equals(task.plannedDate(), request.plannedDate())
					&& Objects.equals(task.deadlineDate(), request.deadlineDate());
			if (!samePayload) {
				throw new ConflictException("A different task already exists with this id.");
			}
			return new CreateResult(task, false);
		}

		requireUsableCategory(request.categoryId());
		Instant now = Timestamps.truncate(clock.instant());
		Task task = new Task(request.id(), title, description, request.categoryId(), priority, TaskStatus.PENDING,
				request.plannedDate(), request.deadlineDate(), null, null, now, now, 1);
		repository.insert(task);
		repository.insertActivity(task.id(), "CREATED", null, task.status(), null, task.plannedDate(), now);
		return new CreateResult(task, true);
	}

	/**
	 * Applies the properties present in the request if the task still has the
	 * version the client saw. A request that changes nothing leaves the task,
	 * its version, and its completion time untouched.
	 */
	@Transactional
	public Task update(UUID id, UpdateTaskRequest request) {
		Task current = get(id);
		if (current.version() != request.getVersion()) {
			throw staleVersion();
		}

		String title = request.has("title") ? cleanTitle(request.getTitle()) : current.title();
		String description = request.has("description") ? cleanDescription(request.getDescription())
				: current.description();
		UUID categoryId = request.has("categoryId") ? request.getCategoryId() : current.categoryId();
		TaskPriority priority = request.has("priority") ? required(request.getPriority(), "priority")
				: current.priority();
		TaskStatus status = request.has("status") ? required(request.getStatus(), "status") : current.status();
		LocalDate plannedDate = request.has("plannedDate") ? request.getPlannedDate() : current.plannedDate();
		LocalDate deadlineDate = request.has("deadlineDate") ? request.getDeadlineDate() : current.deadlineDate();
		boolean archived = request.has("archived") ? required(request.getArchived(), "archived")
				: current.archivedAt() != null;

		if (!Objects.equals(categoryId, current.categoryId())) {
			requireUsableCategory(categoryId);
		}

		Instant now = Timestamps.truncate(clock.instant());
		// The completion time is set only on a transition into DONE and cleared on leaving it.
		Instant completedAt = current.completedAt();
		if (status == TaskStatus.DONE && current.status() != TaskStatus.DONE) {
			completedAt = now;
		}
		else if (status != TaskStatus.DONE) {
			completedAt = null;
		}
		Instant archivedAt = archived ? (current.archivedAt() != null ? current.archivedAt() : now) : null;

		Task updated = new Task(current.id(), title, description, categoryId, priority, status, plannedDate,
				deadlineDate, completedAt, archivedAt, current.createdAt(), now, current.version() + 1);
		if (sameContent(current, updated)) {
			return current;
		}
		if (!repository.update(updated, current.version())) {
			throw staleVersion();
		}
		recordActivity(current, updated, now);
		return updated;
	}

	private void recordActivity(Task before, Task after, Instant now) {
		if (before.status() != after.status()) {
			String action = after.status() == TaskStatus.DONE ? "COMPLETED"
					: before.status() == TaskStatus.DONE ? "REOPENED" : "STATUS_CHANGED";
			repository.insertActivity(after.id(), action, before.status(), after.status(), null, null, now);
		}
		if (!Objects.equals(before.plannedDate(), after.plannedDate())) {
			repository.insertActivity(after.id(), "RESCHEDULED", null, null, before.plannedDate(), after.plannedDate(),
					now);
		}
		if ((before.archivedAt() == null) != (after.archivedAt() == null)) {
			repository.insertActivity(after.id(), after.archivedAt() != null ? "ARCHIVED" : "RESTORED", null, null,
					null, null, now);
		}
		boolean detailsChanged = !before.title().equals(after.title())
				|| !Objects.equals(before.description(), after.description())
				|| !Objects.equals(before.categoryId(), after.categoryId()) || before.priority() != after.priority()
				|| !Objects.equals(before.deadlineDate(), after.deadlineDate());
		if (detailsChanged) {
			repository.insertActivity(after.id(), "EDITED", null, null, null, null, now);
		}
	}

	private static boolean sameContent(Task a, Task b) {
		return a.title().equals(b.title()) && Objects.equals(a.description(), b.description())
				&& Objects.equals(a.categoryId(), b.categoryId()) && a.priority() == b.priority()
				&& a.status() == b.status() && Objects.equals(a.plannedDate(), b.plannedDate())
				&& Objects.equals(a.deadlineDate(), b.deadlineDate())
				&& Objects.equals(a.completedAt(), b.completedAt())
				&& Objects.equals(a.archivedAt(), b.archivedAt());
	}

	@Transactional(readOnly = true)
	public Task get(UUID id) {
		return repository.findById(id).orElseThrow(() -> new NotFoundException("Task not found."));
	}

	@Transactional(readOnly = true)
	public List<TaskActivityResponse> activity(UUID id) {
		get(id);
		return repository.findActivity(id);
	}

	@Transactional(readOnly = true)
	public TaskPageResponse list(TaskQuery query, int page, int size) {
		String text = query.text() == null || query.text().isBlank() ? null : query.text().strip();
		if (text != null && text.length() > MAX_SEARCH_LENGTH) {
			throw new InvalidInputException("q", "The search text is limited to " + MAX_SEARCH_LENGTH + " characters.");
		}
		TaskQuery cleaned = new TaskQuery(text, query.status(), query.priority(), query.categoryId(),
				query.plannedFrom(), query.plannedTo(), query.scheduled(), query.archived());
		List<TaskResponse> items = repository.search(cleaned, size, (long) page * size)
			.stream()
			.map(TaskResponse::from)
			.toList();
		return new TaskPageResponse(items, page, size, repository.count(cleaned));
	}

	private void requireUsableCategory(UUID categoryId) {
		if (categoryId != null && !categories.existsActive(categoryId)) {
			throw new InvalidInputException("categoryId", "The category does not exist or is archived.");
		}
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

	private static String cleanDescription(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
		if (value.codePointCount(0, value.length()) > MAX_DESCRIPTION_LENGTH) {
			throw new InvalidInputException("description",
					"The description is limited to " + MAX_DESCRIPTION_LENGTH + " characters.");
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
		return new ConflictException("The task was changed after it was loaded. Reload it and try again.");
	}

}
