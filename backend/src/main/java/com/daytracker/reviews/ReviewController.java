package com.daytracker.reviews;

import java.time.LocalDate;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// The DailyReview record is the response: it holds only API fields.
@RestController
@RequestMapping("/api/v1/reviews")
public class ReviewController {

	private final ReviewService service;

	public ReviewController(ReviewService service) {
		this.service = service;
	}

	@GetMapping("/{date}")
	DailyReview get(@PathVariable LocalDate date) {
		return service.get(date);
	}

	@PutMapping("/{date}")
	DailyReview save(@PathVariable LocalDate date, @RequestBody ReviewService.SaveRequest request) {
		return service.save(date, request);
	}

}
