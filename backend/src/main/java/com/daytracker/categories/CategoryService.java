package com.daytracker.categories;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.daytracker.common.ApiExceptions.ConflictException;
import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.common.ApiExceptions.NotFoundException;
import com.daytracker.common.Timestamps;

@Service
public class CategoryService {

	static final int MAX_NAME_LENGTH = 50;

	private static final Pattern COLOR = Pattern.compile("#[0-9a-fA-F]{6}");

	public record CreateResult(Category category, boolean created) {
	}

	private final CategoryRepository repository;

	private final Clock clock;

	public CategoryService(CategoryRepository repository, Clock clock) {
		this.repository = repository;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	public List<Category> list() {
		return repository.findAll();
	}

	/** Creates a category, or returns the existing one when the same request is replayed. */
	@Transactional
	public CreateResult create(CategoryRequests.Create request) {
		String name = cleanName(request.name());
		String color = cleanColor(request.color());

		Optional<Category> existing = repository.findById(request.id());
		if (existing.isPresent()) {
			Category category = existing.get();
			if (!category.name().equals(name) || !category.color().equals(color)) {
				throw new ConflictException("A different category already exists with this id.");
			}
			return new CreateResult(category, false);
		}
		requireUnusedName(name, request.id());

		Instant now = Timestamps.truncate(clock.instant());
		Category category = new Category(request.id(), name, color, null, now, now, 1);
		repository.insert(category, normalize(name));
		return new CreateResult(category, true);
	}

	/** Renames, recolors, archives, or restores. Archiving keeps the category on existing records. */
	@Transactional
	public Category update(UUID id, CategoryRequests.Update request) {
		Category current = repository.findById(id).orElseThrow(() -> new NotFoundException("Category not found."));
		if (current.version() != request.version()) {
			throw staleVersion();
		}
		String name = request.name() == null ? current.name() : cleanName(request.name());
		String color = request.color() == null ? current.color() : cleanColor(request.color());
		boolean archived = request.archived() == null ? current.archivedAt() != null : request.archived();
		Instant now = Timestamps.truncate(clock.instant());
		Instant archivedAt = archived ? (current.archivedAt() != null ? current.archivedAt() : now) : null;

		if (name.equals(current.name()) && color.equals(current.color())
				&& (archivedAt == null) == (current.archivedAt() == null)) {
			return current;
		}
		if (!normalize(name).equals(normalize(current.name()))) {
			requireUnusedName(name, id);
		}
		Category updated = new Category(id, name, color, archivedAt, current.createdAt(), now,
				current.version() + 1);
		if (!repository.update(updated, normalize(name), current.version())) {
			throw staleVersion();
		}
		return updated;
	}

	private void requireUnusedName(String name, UUID ownId) {
		repository.findByNormalizedName(normalize(name)).filter(other -> !other.id().equals(ownId)).ifPresent(other -> {
			throw new ConflictException(other.archivedAt() == null ? "A category with this name already exists."
					: "An archived category already has this name. Restore it instead.");
		});
	}

	private static String cleanName(String value) {
		String name = value == null ? "" : value.strip().replaceAll("\\s+", " ");
		if (name.isEmpty()) {
			throw new InvalidInputException("name", "A name is required.");
		}
		if (name.codePointCount(0, name.length()) > MAX_NAME_LENGTH) {
			throw new InvalidInputException("name", "The name is limited to " + MAX_NAME_LENGTH + " characters.");
		}
		return name;
	}

	private static String cleanColor(String value) {
		if (value == null || !COLOR.matcher(value).matches()) {
			throw new InvalidInputException("color", "The color must look like #3366CC.");
		}
		return value.toUpperCase(Locale.ROOT);
	}

	/** Names differing only in letter case are the same category. */
	static String normalize(String name) {
		return name.toLowerCase(Locale.ROOT);
	}

	private static ConflictException staleVersion() {
		return new ConflictException("The category was changed after it was loaded. Reload it and try again.");
	}

}
