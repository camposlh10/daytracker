package com.daytracker.reading;

import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;

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

// The Book record is the response: it holds only API fields, no database details.
@RestController
@RequestMapping("/api/v1/books")
public class BookController {

	private final BookService service;

	public BookController(BookService service) {
		this.service = service;
	}

	@GetMapping
	List<Book> list(@RequestParam(defaultValue = "false") boolean archived) {
		return service.list(archived);
	}

	@PostMapping
	ResponseEntity<Book> create(@Valid @RequestBody BookRequests.Create request) {
		BookService.CreateResult result = service.create(request);
		return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK).body(result.book());
	}

	@GetMapping("/{id}")
	Book get(@PathVariable UUID id) {
		return service.get(id);
	}

	@PatchMapping("/{id}")
	Book update(@PathVariable UUID id, @Valid @RequestBody BookRequests.Update request) {
		return service.update(id, request);
	}

}
