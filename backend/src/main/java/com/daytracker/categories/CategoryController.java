package com.daytracker.categories;

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
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/categories")
public class CategoryController {

	private final CategoryService service;

	public CategoryController(CategoryService service) {
		this.service = service;
	}

	@GetMapping
	List<CategoryResponse> list() {
		return service.list().stream().map(CategoryResponse::from).toList();
	}

	@PostMapping
	ResponseEntity<CategoryResponse> create(@Valid @RequestBody CategoryRequests.Create request) {
		CategoryService.CreateResult result = service.create(request);
		HttpStatus status = result.created() ? HttpStatus.CREATED : HttpStatus.OK;
		return ResponseEntity.status(status).body(CategoryResponse.from(result.category()));
	}

	@PatchMapping("/{id}")
	CategoryResponse update(@PathVariable UUID id, @Valid @RequestBody CategoryRequests.Update request) {
		return CategoryResponse.from(service.update(id, request));
	}

}
