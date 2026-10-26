package com.daytracker.events;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/events")
public class EventController {

	private final EventService service;

	public EventController(EventService service) {
		this.service = service;
	}

	@GetMapping
	List<EventResponse> list(@RequestParam LocalDate from, @RequestParam LocalDate to) {
		return service.overlapping(from, to).stream().map(EventResponse::from).toList();
	}

	@PostMapping
	ResponseEntity<EventResponse> create(@Valid @RequestBody EventRequests.Create request) {
		EventService.CreateResult result = service.create(request);
		return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
			.body(EventResponse.from(result.event()));
	}

	@GetMapping("/{id}")
	EventResponse get(@PathVariable UUID id) {
		return EventResponse.from(service.get(id));
	}

	@PatchMapping("/{id}")
	EventResponse update(@PathVariable UUID id, @Valid @RequestBody EventRequests.Update request) {
		return EventResponse.from(service.update(id, request));
	}

	@DeleteMapping("/{id}")
	ResponseEntity<Void> delete(@PathVariable UUID id, @RequestParam long version) {
		service.delete(id, version);
		return ResponseEntity.noContent().build();
	}

}
