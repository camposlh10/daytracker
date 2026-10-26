package com.daytracker.categories;

import java.time.Instant;
import java.util.UUID;

public record CategoryResponse(UUID id, String name, String color, Instant archivedAt, Instant createdAt,
		Instant updatedAt, long version) {

	static CategoryResponse from(Category category) {
		return new CategoryResponse(category.id(), category.name(), category.color(), category.archivedAt(),
				category.createdAt(), category.updatedAt(), category.version());
	}

}
