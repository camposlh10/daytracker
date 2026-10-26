package com.daytracker.database;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Clock;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import javax.sql.DataSource;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.daytracker.common.Timestamps;

/**
 * Applies ordered SQL scripts and records each one in {@code schema_migrations}.
 * A script and its ledger entry are committed in one transaction. Startup aborts
 * on a checksum mismatch, a failed script, or a schema newer than this build.
 */
public class MigrationRunner {

	private static final Logger log = LoggerFactory.getLogger(MigrationRunner.class);

	private static final DateTimeFormatter BACKUP_STAMP = DateTimeFormatter.ofPattern("uuuuMMdd-HHmmssSSS")
		.withZone(ZoneOffset.UTC);

	private final DataSource dataSource;

	private final Path backupsDir;

	private final Clock clock;

	private final List<MigrationScript> scripts;

	public MigrationRunner(DataSource dataSource, Path backupsDir, Clock clock, List<MigrationScript> scripts) {
		this.dataSource = dataSource;
		this.backupsDir = backupsDir;
		this.clock = clock;
		this.scripts = List.copyOf(scripts);
		Set<Integer> versions = new HashSet<>();
		for (MigrationScript script : this.scripts) {
			if (!versions.add(script.version())) {
				throw new MigrationException("Duplicate migration version " + script.version() + ".");
			}
		}
	}

	public void migrate() {
		try (Connection connection = dataSource.getConnection()) {
			connection.setAutoCommit(true);
			createLedger(connection);
			Map<Integer, String> applied = readLedger(connection);
			validate(applied);
			int current = applied.keySet().stream().max(Integer::compare).orElse(0);
			List<MigrationScript> pending = scripts.stream().filter(script -> script.version() > current).toList();
			if (pending.isEmpty()) {
				return;
			}
			if (!applied.isEmpty()) {
				backupBeforeUpgrade(connection, current);
			}
			for (MigrationScript script : pending) {
				apply(connection, script);
			}
		}
		catch (SQLException ex) {
			throw new MigrationException("Database migration failed.", ex);
		}
	}

	private void createLedger(Connection connection) throws SQLException {
		try (Statement statement = connection.createStatement()) {
			statement.execute("""
					CREATE TABLE IF NOT EXISTS schema_migrations (
					    version     INTEGER PRIMARY KEY,
					    description TEXT NOT NULL,
					    checksum    TEXT NOT NULL,
					    applied_at  TEXT NOT NULL
					)""");
		}
	}

	private Map<Integer, String> readLedger(Connection connection) throws SQLException {
		Map<Integer, String> applied = new LinkedHashMap<>();
		try (Statement statement = connection.createStatement();
				ResultSet rows = statement
					.executeQuery("SELECT version, checksum FROM schema_migrations ORDER BY version")) {
			while (rows.next()) {
				applied.put(rows.getInt("version"), rows.getString("checksum"));
			}
		}
		return applied;
	}

	private void validate(Map<Integer, String> applied) {
		int newestKnown = scripts.stream().mapToInt(MigrationScript::version).max().orElse(0);
		int current = applied.keySet().stream().max(Integer::compare).orElse(0);
		if (current > newestKnown) {
			throw new MigrationException("The database schema (version " + current
					+ ") is newer than this application supports (version " + newestKnown + ").");
		}
		for (MigrationScript script : scripts) {
			String recorded = applied.get(script.version());
			if (recorded == null) {
				if (script.version() < current) {
					throw new MigrationException(
							"Migration " + script.version() + " was never applied but later migrations were.");
				}
			}
			else if (!recorded.equals(script.checksum())) {
				throw new MigrationException(
						"Checksum mismatch for applied migration " + script.version() + "; the script was modified.");
			}
		}
		for (Integer version : applied.keySet()) {
			if (scripts.stream().noneMatch(script -> script.version() == version)) {
				throw new MigrationException("Applied migration " + version + " has no matching script.");
			}
		}
	}

	private void backupBeforeUpgrade(Connection connection, int currentVersion) throws SQLException {
		Path target = backupsDir
			.resolve("pre-migration-v" + currentVersion + "-" + BACKUP_STAMP.format(clock.instant()) + ".db");
		try {
			Files.createDirectories(backupsDir);
		}
		catch (IOException ex) {
			throw new MigrationException("Cannot create the backup directory before upgrading.", ex);
		}
		try (PreparedStatement statement = connection.prepareStatement("VACUUM INTO ?")) {
			statement.setString(1, target.toAbsolutePath().toString());
			statement.execute();
		}
		log.info("Created pre-migration backup {}", target.getFileName());
	}

	private void apply(Connection connection, MigrationScript script) throws SQLException {
		connection.setAutoCommit(false);
		try {
			try (Statement statement = connection.createStatement()) {
				for (String sql : script.statements()) {
					statement.execute(sql);
				}
			}
			try (PreparedStatement ledger = connection.prepareStatement(
					"INSERT INTO schema_migrations (version, description, checksum, applied_at) VALUES (?, ?, ?, ?)")) {
				ledger.setInt(1, script.version());
				ledger.setString(2, script.description());
				ledger.setString(3, script.checksum());
				ledger.setString(4, Timestamps.format(clock.instant()));
				ledger.executeUpdate();
			}
			connection.commit();
			log.info("Applied migration {} ({})", script.version(), script.description());
		}
		catch (SQLException ex) {
			connection.rollback();
			throw new MigrationException("Migration " + script.version() + " failed and was rolled back.", ex);
		}
		finally {
			connection.setAutoCommit(true);
		}
	}

}
