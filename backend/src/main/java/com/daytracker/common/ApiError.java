package com.daytracker.common;

import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiError(String code, String message, List<FieldError> fieldErrors, String correlationId) {

	public record FieldError(String field, String message) {
	}

	public static ApiError of(String code, String message) {
		return new ApiError(code, message, null, UUID.randomUUID().toString());
	}

	public static ApiError of(String code, String message, List<FieldError> fieldErrors) {
		return new ApiError(code, message, fieldErrors, UUID.randomUUID().toString());
	}

}
