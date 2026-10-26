package com.daytracker.categories;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.daytracker.common.Timestamps;

@Repository
public class CategoryRepository {

	private static final String COLUMNS = "id, name, color, archived_at, created_at, updated_at, version";

	private final JdbcClient jdbc;

	public CategoryRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/** Every category, archived ones included, by name. */
	public List<Category> findAll() {
		return jdbc.sql("SELECT " + COLUMNS + " FROM categories ORDER BY normalized_name, id")
			.query(CategoryRepository::mapCategory)
			.list();
	}

	public Optional<Category> findById(UUID id) {
		return jdbc.sql("SELECT " + COLUMNS + " FROM categories WHERE id = :id")
			.param("id", id.toString())
			.query(CategoryRepository::mapCategory)
			.optional();
	}

	public Optional<Category> findByNormalizedName(String normalizedName) {
		return jdbc.sql("SELECT " + COLUMNS + " FROM categories WHERE normalized_name = :name")
			.param("name", normalizedName)
			.query(CategoryRepository::mapCategory)
			.optional();
	}

	public boolean existsActive(UUID id) {
		return jdbc.sql("SELECT COUNT(*) FROM categories WHERE id = :id AND archived_at IS NULL")
			.param("id", id.toString())
			.query(Integer.class)
			.single() == 1;
	}

	public void insert(Category category, String normalizedName) {
		jdbc.sql("""
				INSERT INTO categories (id, name, normalized_name, color, archived_at, created_at, updated_at, version)
				VALUES (:id, :name, :normalizedName, :color, :archivedAt, :createdAt, :updatedAt, :version)""")
			.param("id", category.id().toString())
			.param("name", category.name())
			.param("normalizedName", normalizedName)
			.param("color", category.color())
			.param("archivedAt", timestamp(category.archivedAt()))
			.param("createdAt", timestamp(category.createdAt()))
			.param("updatedAt", timestamp(category.updatedAt()))
			.param("version", category.version())
			.update();
	}

	/** @return false when another change got there first */
	public boolean update(Category category, String normalizedName, long expectedVersion) {
		return jdbc.sql("""
				UPDATE categories SET name = :name, normalized_name = :normalizedName, color = :color,
				    archived_at = :archivedAt, updated_at = :updatedAt, version = :version
				WHERE id = :id AND version = :expectedVersion""")
			.param("id", category.id().toString())
			.param("name", category.name())
			.param("normalizedName", normalizedName)
			.param("color", category.color())
			.param("archivedAt", timestamp(category.archivedAt()))
			.param("updatedAt", timestamp(category.updatedAt()))
			.param("version", category.version())
			.param("expectedVersion", expectedVersion)
			.update() == 1;
	}

	private static Category mapCategory(ResultSet row, int rowNumber) throws SQLException {
		return new Category(UUID.fromString(row.getString("id")), row.getString("name"), row.getString("color"),
				Timestamps.parse(row.getString("archived_at")), Timestamps.parse(row.getString("created_at")),
				Timestamps.parse(row.getString("updated_at")), row.getLong("version"));
	}

	private static String timestamp(Instant value) {
		return value == null ? null : Timestamps.format(value);
	}

}
