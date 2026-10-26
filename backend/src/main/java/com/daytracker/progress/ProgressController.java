package com.daytracker.progress;

import java.time.LocalDate;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ProgressController {

	private final ProgressService service;

	public ProgressController(ProgressService service) {
		this.service = service;
	}

	@GetMapping("/api/v1/progress")
	ProgressResponse progress(@RequestParam LocalDate from, @RequestParam LocalDate to) {
		return service.progress(from, to);
	}

}
