package com.daytracker.common;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import com.daytracker.common.ApiExceptions.ConflictException;
import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.common.ApiExceptions.NotFoundException;

/**
 * Every error leaves the API in the same shape, without stack traces or
 * filesystem paths. Unexpected failures are logged under the correlation id.
 */
@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

	private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

	@ExceptionHandler(NotFoundException.class)
	ResponseEntity<ApiError> notFound(NotFoundException ex) {
		return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of("NOT_FOUND", ex.getMessage()));
	}

	@ExceptionHandler(ConflictException.class)
	ResponseEntity<ApiError> conflict(ConflictException ex) {
		return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of("CONFLICT", ex.getMessage()));
	}

	@ExceptionHandler(InvalidInputException.class)
	ResponseEntity<ApiError> invalidInput(InvalidInputException ex) {
		return ResponseEntity.badRequest()
			.body(ApiError.of("VALIDATION_FAILED", "The request contains invalid fields.", ex.fieldErrors()));
	}

	@ExceptionHandler(Exception.class)
	ResponseEntity<ApiError> unexpected(Exception ex) {
		ApiError error = ApiError.of("INTERNAL_ERROR", "An unexpected error occurred.");
		log.error("Unhandled failure, correlationId={}", error.correlationId(), ex);
		return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
	}

	@Override
	protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex,
			HttpHeaders headers, HttpStatusCode status, WebRequest request) {
		List<ApiError.FieldError> fieldErrors = ex.getBindingResult()
			.getFieldErrors()
			.stream()
			.map(error -> new ApiError.FieldError(error.getField(), error.getDefaultMessage()))
			.toList();
		ApiError body = ApiError.of("VALIDATION_FAILED", "The request contains invalid fields.", fieldErrors);
		return ResponseEntity.badRequest().headers(headers).body(body);
	}

	// Standard Spring MVC failures (malformed JSON, bad parameter types, unknown routes, ...).
	@Override
	protected ResponseEntity<Object> handleExceptionInternal(Exception ex, Object body, HttpHeaders headers,
			HttpStatusCode statusCode, WebRequest request) {
		HttpStatus status = HttpStatus.resolve(statusCode.value());
		ApiError error;
		if (statusCode.is5xxServerError() || status == null) {
			error = ApiError.of("INTERNAL_ERROR", "An unexpected error occurred.");
			log.error("Request failed, correlationId={}", error.correlationId(), ex);
		}
		else if (status == HttpStatus.BAD_REQUEST) {
			error = ApiError.of("INVALID_REQUEST", "The request could not be read or contains invalid values.");
		}
		else {
			error = ApiError.of(status.name(), status.getReasonPhrase());
		}
		return ResponseEntity.status(statusCode).headers(headers).body(error);
	}

}
