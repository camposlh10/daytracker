package com.daytracker.tasks;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.daytracker.common.Timestamps;

@Repository
public class TaskRepository {

	private static final String COLUMNS = """
			id, title, description, category_id, priority, status, planned_date, deadline_date,
			completed_at, archived_at, created_at, updated_at, version""";

	private final JdbcClient jdbc;

	public TaskRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	public Optional<Task> findById(UUID id) {
		return jdbc.sql("SELECT " + COLUMNS + " FROM tasks WHERE id = :id")
			.param("id", id.toString())
			.query(TaskRepository::mapTask)
			.optional();
	}

	/** Newest first; the id breaks ties so paging is stable. */
	public List<Task> search(TaskQuery query, int limit, long offset) {
		Map<String, Object> params = new HashMap<>();
		String where = where(query, params);
		params.put("limit", limit);
		params.put("offset", offset);
		return jdbc
			.sql("SELECT " + COLUMNS + " FROM tasks" + where + " ORDER BY created_at DESC, id LIMIT :limit OFFSET :offset")
			.params(params)
			.query(TaskRepository::mapTask)
			.list();
	}

	public long count(TaskQuery query) {
		Map<String, Object> params = new HashMap<>();
		String where = where(query, params);
		return jdbc.sql("SELECT COUNT(*) FROM tasks" + where).params(params).query(Long.class).single();
	}

	private static String where(TaskQuery query, Map<String, Object> params) {
		StringBuilder where = new StringBuilder(
				query.archived() ? " WHERE archived_at IS NOT NULL" : " WHERE archived_at IS NULL");
		if (query.text() != null) {
			// LIKE wildcards typed by the user are matched literally.
			String escaped = query.text().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
			where.append(" AND (title LIKE :text ESCAPE '\\' OR description LIKE :text ESCAPE '\\')");
			params.put("text", "%" + escaped + "%");
		}
		if (query.status() != null) {
			where.append(" AND status = :status");
			params.put("status", query.status().name());
		}
		if (query.priority() != null) {
			where.append(" AND priority = :priority");
			params.put("priority", query.priority().name());
		}
		if (query.categoryId() != null) {
			where.append(" AND category_id = :categoryId");
			params.put("categoryId", query.categoryId().toString());
		}
		if (query.plannedFrom() != null) {
			where.append(" AND planned_date >= :plannedFrom");
			params.put("plannedFrom", query.plannedFrom().toString());
		}
		if (query.plannedTo() != null) {
			where.append(" AND planned_date < :plannedTo");
			params.put("plannedTo", query.plannedTo().toString());
		}
		if (query.scheduled() != null) {
			where.append(query.scheduled() ? " AND planned_date IS NOT NULL" : " AND planned_date IS NULL");
		}
		return where.toString();
	}

	/** Non-archived tasks planned on or after {@code from} and before {@code toExclusive}. */
	public List<Task> findPlannedBetween(LocalDate from, LocalDate toExclusive) {
		return jdbc
			.sql("SELECT " + COLUMNS + " FROM tasks WHERE archived_at IS NULL"
					+ " AND planned_date >= :from AND planned_date < :to ORDER BY planned_date, created_at, id")
			.param("from", from.toString())
			.param("to", toExclusive.toString())
			.query(TaskRepository::mapTask)
			.list();
	}

	/** Non-archived tasks that are not done and were planned before the given date, oldest first. */
	public List<Task> findUnfinishedPlannedBefore(LocalDate date, int limit) {
		return jdbc
			.sql("SELECT " + COLUMNS + " FROM tasks WHERE archived_at IS NULL AND status <> 'DONE'"
					+ " AND planned_date < :date ORDER BY planned_date, created_at, id LIMIT :limit")
			.param("date", date.toString())
			.param("limit", limit)
			.query(TaskRepository::mapTask)
			.list();
	}

	/**
	 * Completion times of tasks that are currently done and were completed in the
	 * interval. Archived tasks keep counting; reopened tasks have no completion time.
	 */
	public List<Instant> findCompletionTimesBetween(Instant from, Instant toExclusive) {
		return jdbc
			.sql("SELECT completed_at FROM tasks WHERE status = 'DONE'"
					+ " AND completed_at >= :from AND completed_at < :to ORDER BY completed_at")
			.param("from", Timestamps.format(from))
			.param("to", Timestamps.format(toExclusive))
			.query((row, rowNumber) -> Timestamps.parse(row.getString(1)))
			.list();
	}

	/**
	 * Tasks that are currently done and were completed in the interval, oldest
	 * first. Archived tasks keep counting; reopened tasks have no completion time.
	 */
	public List<Task> findCompletedBetween(Instant from, Instant toExclusive) {
		return jdbc
			.sql("SELECT " + COLUMNS + " FROM tasks WHERE status = 'DONE'"
					+ " AND completed_at >= :from AND completed_at < :to ORDER BY completed_at, id")
			.param("from", Timestamps.format(from))
			.param("to", Timestamps.format(toExclusive))
			.query(TaskRepository::mapTask)
			.list();
	}

	public void insert(Task task) {
		jdbc.sql("""
				INSERT INTO tasks (id, title, description, category_id, priority, status, planned_date,
				    deadline_date, completed_at, archived_at, created_at, updated_at, version)
				VALUES (:id, :title, :description, :categoryId, :priority, :status, :plannedDate,
				    :deadlineDate, :completedAt, :archivedAt, :createdAt, :updatedAt, :version)""")
			.params(columnValues(task))
			.update();
	}

	/**
	 * Writes the task only if the stored row still has the expected version.
	 * @return false when another change got there first
	 */
	public boolean update(Task task, long expectedVersion) {
		Map<String, Object> params = columnValues(task);
		params.put("expectedVersion", expectedVersion);
		return jdbc.sql("""
				UPDATE tasks SET title = :title, description = :description, category_id = :categoryId,
				    priority = :priority, status = :status, planned_date = :plannedDate,
				    deadline_date = :deadlineDate, completed_at = :completedAt, archived_at = :archivedAt,
				    updated_at = :updatedAt, version = :version
				WHERE id = :id AND version = :expectedVersion""").params(params).update() == 1;
	}

	public void insertActivity(UUID taskId, String action, TaskStatus previousStatus, TaskStatus newStatus,
			LocalDate previousPlannedDate, LocalDate newPlannedDate, Instant occurredAt) {
		jdbc.sql("""
				INSERT INTO task_activity (id, task_id, action, previous_status, new_status,
				    previous_planned_date, new_planned_date, occurred_at)
				VALUES (:id, :taskId, :action, :previousStatus, :newStatus,
				    :previousPlannedDate, :newPlannedDate, :occurredAt)""")
			.param("id", UUID.randomUUID().toString())
			.param("taskId", taskId.toString())
			.param("action", action)
			.param("previousStatus", previousStatus == null ? null : previousStatus.name())
			.param("newStatus", newStatus == null ? null : newStatus.name())
			.param("previousPlannedDate", text(previousPlannedDate))
			.param("newPlannedDate", text(newPlannedDate))
			.param("occurredAt", timestamp(occurredAt))
			.update();
	}

	/** Oldest first; rowid keeps entries written in the same millisecond in order. */
	public List<TaskActivityResponse> findActivity(UUID taskId) {
		return jdbc.sql("""
				SELECT action, previous_status, new_status, previous_planned_date, new_planned_date, occurred_at
				FROM task_activity WHERE task_id = :taskId ORDER BY occurred_at, rowid""")
			.param("taskId", taskId.toString())
			.query((row, rowNumber) -> new TaskActivityResponse(row.getString("action"),
					status(row.getString("previous_status")), status(row.getString("new_status")),
					date(row.getString("previous_planned_date")), date(row.getString("new_planned_date")),
					Timestamps.parse(row.getString("occurred_at"))))
			.list();
	}

	private static Map<String, Object> columnValues(Task task) {
		Map<String, Object> values = new HashMap<>();
		values.put("id", task.id().toString());
		values.put("title", task.title());
		values.put("description", task.description());
		values.put("categoryId", text(task.categoryId()));
		values.put("priority", task.priority().name());
		values.put("status", task.status().name());
		values.put("plannedDate", text(task.plannedDate()));
		values.put("deadlineDate", text(task.deadlineDate()));
		values.put("completedAt", timestamp(task.completedAt()));
		values.put("archivedAt", timestamp(task.archivedAt()));
		values.put("createdAt", timestamp(task.createdAt()));
		values.put("updatedAt", timestamp(task.updatedAt()));
		values.put("version", task.version());
		return values;
	}

	private static Task mapTask(ResultSet row, int rowNumber) throws SQLException {
		String categoryId = row.getString("category_id");
		return new Task(UUID.fromString(row.getString("id")), row.getString("title"), row.getString("description"),
				categoryId == null ? null : UUID.fromString(categoryId),
				TaskPriority.valueOf(row.getString("priority")), TaskStatus.valueOf(row.getString("status")),
				date(row.getString("planned_date")), date(row.getString("deadline_date")),
				Timestamps.parse(row.getString("completed_at")), Timestamps.parse(row.getString("archived_at")),
				Timestamps.parse(row.getString("created_at")), Timestamps.parse(row.getString("updated_at")),
				row.getLong("version"));
	}

	private static LocalDate date(String value) {
		return value == null ? null : LocalDate.parse(value);
	}

	private static TaskStatus status(String value) {
		return value == null ? null : TaskStatus.valueOf(value);
	}

	private static String text(Object value) {
		return value == null ? null : value.toString();
	}

	private static String timestamp(Instant value) {
		return value == null ? null : Timestamps.format(value);
	}

}
