package com.daytracker.reading;

import java.time.LocalDate;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

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

// The ReadingSession record is the response: it holds only API fields.
@RestController
@RequestMapping("/api/v1/reading-sessions")
public class ReadingSessionController {

	private final ReadingSessionService service;

	public ReadingSessionController(ReadingSessionService service) {
		this.service = service;
	}

	@GetMapping
	ReadingSessionService.Page list(@RequestParam(required = false) UUID bookId,
			@RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to,
			@RequestParam(defaultValue = "0") @Min(0) int page,
			@RequestParam(defaultValue = "50") @Min(1) @Max(200) int size) {
		return service.list(bookId, from, to, page, size);
	}

	@PostMapping
	ResponseEntity<ReadingSession> create(@Valid @RequestBody SessionRequests.Create request) {
		ReadingSessionService.CreateResult result = service.create(request);
		return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK).body(result.session());
	}

	@PatchMapping("/{id}")
	ReadingSession update(@PathVariable UUID id, @Valid @RequestBody SessionRequests.Update request) {
		return service.update(id, request);
	}

	@DeleteMapping("/{id}")
	ResponseEntity<Void> delete(@PathVariable UUID id, @RequestParam long version) {
		service.delete(id, version);
		return ResponseEntity.noContent().build();
	}

}
