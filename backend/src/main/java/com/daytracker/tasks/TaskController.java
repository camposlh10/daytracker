package com.daytracker.tasks;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/tasks")
public class TaskController {

	private final TaskService service;

	public TaskController(TaskService service) {
		this.service = service;
	}

	@GetMapping
	TaskPageResponse list(@RequestParam(required = false) String q, @RequestParam(required = false) TaskStatus status,
			@RequestParam(required = false) TaskPriority priority, @RequestParam(required = false) UUID categoryId,
			@RequestParam(required = false) LocalDate plannedFrom, @RequestParam(required = false) LocalDate plannedTo,
			@RequestParam(required = false) Boolean scheduled, @RequestParam(defaultValue = "false") boolean archived,
			@RequestParam(defaultValue = "0") @Min(0) int page,
			@RequestParam(defaultValue = "50") @Min(1) @Max(200) int size) {
		return service.list(
				new TaskQuery(q, status, priority, categoryId, plannedFrom, plannedTo, scheduled, archived), page,
				size);
	}

	@PostMapping
	ResponseEntity<TaskResponse> create(@Valid @RequestBody CreateTaskRequest request) {
		TaskService.CreateResult result = service.create(request);
		// 201 for a new task; 200 when an identical create is replayed.
		HttpStatus status = result.created() ? HttpStatus.CREATED : HttpStatus.OK;
		return ResponseEntity.status(status).body(TaskResponse.from(result.task()));
	}

	@GetMapping("/{id}")
	TaskResponse get(@PathVariable UUID id) {
		return TaskResponse.from(service.get(id));
	}

	@PatchMapping("/{id}")
	TaskResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateTaskRequest request) {
		return TaskResponse.from(service.update(id, request));
	}

	@GetMapping("/{id}/activity")
	List<TaskActivityResponse> activity(@PathVariable UUID id) {
		return service.activity(id);
	}

}
