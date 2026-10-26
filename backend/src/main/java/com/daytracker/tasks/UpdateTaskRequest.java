package com.daytracker.tasks;

import java.time.LocalDate;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import jakarta.validation.constraints.NotNull;

/**
 * A partial update. Only properties present in the JSON are applied, so an
 * explicit {@code null} (clear the planned date) differs from an omitted one
 * (leave it alone). The JSON mapper calls a setter only for present properties.
 */
public class UpdateTaskRequest {

	private final Set<String> present = new HashSet<>();

	@NotNull
	private Long version;

	private String title;

	private String description;

	private UUID categoryId;

	private TaskPriority priority;

	private TaskStatus status;

	private LocalDate plannedDate;

	private LocalDate deadlineDate;

	private Boolean archived;

	public boolean has(String property) {
		return present.contains(property);
	}

	/** The version the client last saw; the update is refused if the task has changed since. */
	public Long getVersion() {
		return version;
	}

	public void setVersion(Long version) {
		this.version = version;
	}

	public String getTitle() {
		return title;
	}

	public void setTitle(String title) {
		this.title = title;
		present.add("title");
	}

	public String getDescription() {
		return description;
	}

	public void setDescription(String description) {
		this.description = description;
		present.add("description");
	}

	public UUID getCategoryId() {
		return categoryId;
	}

	public void setCategoryId(UUID categoryId) {
		this.categoryId = categoryId;
		present.add("categoryId");
	}

	public TaskPriority getPriority() {
		return priority;
	}

	public void setPriority(TaskPriority priority) {
		this.priority = priority;
		present.add("priority");
	}

	public TaskStatus getStatus() {
		return status;
	}

	public void setStatus(TaskStatus status) {
		this.status = status;
		present.add("status");
	}

	public LocalDate getPlannedDate() {
		return plannedDate;
	}

	public void setPlannedDate(LocalDate plannedDate) {
		this.plannedDate = plannedDate;
		present.add("plannedDate");
	}

	public LocalDate getDeadlineDate() {
		return deadlineDate;
	}

	public void setDeadlineDate(LocalDate deadlineDate) {
		this.deadlineDate = deadlineDate;
		present.add("deadlineDate");
	}

	public Boolean getArchived() {
		return archived;
	}

	public void setArchived(Boolean archived) {
		this.archived = archived;
		present.add("archived");
	}

}
