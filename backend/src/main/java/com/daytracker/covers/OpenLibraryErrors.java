package com.daytracker.covers;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.daytracker.common.ApiError;

/**
 * Open Library failures for every endpoint that uses it. Ordered ahead of the
 * shared handler, whose catch-all would otherwise report them as internal errors.
 */
@RestControllerAdvice(basePackageClasses = OpenLibraryErrors.class)
@Order(Ordered.HIGHEST_PRECEDENCE)
public class OpenLibraryErrors {

	@ExceptionHandler(OpenLibraryClient.UnavailableException.class)
	ResponseEntity<ApiError> unavailable(OpenLibraryClient.UnavailableException ex) {
		return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
			.body(ApiError.of("COVER_SOURCE_UNAVAILABLE",
					"Open Library could not be reached. Check the internet connection, or fill in the details yourself."));
	}

	@ExceptionHandler(OpenLibraryClient.NotFoundException.class)
	ResponseEntity<ApiError> missing(OpenLibraryClient.NotFoundException ex) {
		return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of("NOT_FOUND", ex.getMessage()));
	}

}
