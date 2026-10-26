package com.daytracker.categories;

import java.time.Instant;
import java.util.UUID;

public record Category(UUID id, String name, String color, Instant archivedAt, Instant createdAt, Instant updatedAt,
		long version) {
}
