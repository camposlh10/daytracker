package com.daytracker.common;

import java.util.List;

/**
 * Exceptions services throw to produce a specific API error response.
 */
public final class ApiExceptions {

	private ApiExceptions() {
	}

	public static class NotFoundException extends RuntimeException {

		public NotFoundException(String message) {
			super(message);
		}

	}

	public static class ConflictException extends RuntimeException {

		public ConflictException(String message) {
			super(message);
		}

	}

	public static class InvalidInputException extends RuntimeException {

		private final List<ApiError.FieldError> fieldErrors;

		public InvalidInputException(String field, String message) {
			super(message);
			this.fieldErrors = List.of(new ApiError.FieldError(field, message));
		}

		public List<ApiError.FieldError> fieldErrors() {
			return fieldErrors;
		}

	}

}
