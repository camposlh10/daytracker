package com.daytracker.backup;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import javax.sql.DataSource;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.sqlite.SQLiteConfig;
import tools.jackson.databind.ObjectMapper;

import com.daytracker.backup.BackupInfo.Kind;
import com.daytracker.common.Timestamps;
import com.daytracker.config.AppProperties;
import com.daytracker.database.MigrationScript;
import com.daytracker.settings.ZonePolicy;

/**
 * Consistent backups of the live database, and the checks used before a backup
 * is restored.
 *
 * <p>A backup is made with SQLite's {@code VACUUM INTO}, which writes a complete,
 * consistent snapshot even while the database is in use (copying the live file
 * could miss recent writes held in the write-ahead log). It is written under a
 * temporary name, checked, given a small metadata file, and only then renamed,
 * so a failed or half-written backup never appears in the list.
 */
@Service
public class BackupService {

	static final int KEEP_AUTOMATIC = 7;

	private static final Logger log = LoggerFactory.getLogger(BackupService.class);

	private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("uuuuMMdd-HHmmssSSS")
		.withZone(ZoneOffset.UTC);

	/** manual-20261025-153012345.db, auto-20261025.db, pre-migration-v2-..., safety-before-restore-... */
	private static final Pattern NAME = Pattern.compile("(manual|auto|pre-migration|safety)-[A-Za-z0-9\\-]+\\.db");

	/** What the last attempt to make a backup did, so a failure is never reported as success. */
	public record Attempt(Kind kind, boolean ok, Instant at, String message, String fileName) {
	}

	public record Status(String directory, List<BackupInfo> backups, Attempt lastAttempt) {
	}

	/** What a database file chosen for restoring contains. */
	public record RestoreCheck(int schemaVersion, int newestKnownVersion, long sizeBytes, Map<String, Long> counts) {
	}

	private final DataSource dataSource;

	private final AppProperties properties;

	private final Clock clock;

	private final ZonePolicy zonePolicy;

	private final ObjectMapper json;

	private final String appVersion;

	private volatile Attempt lastAttempt;

	public BackupService(DataSource dataSource, AppProperties properties, Clock clock, ZonePolicy zonePolicy,
			ObjectMapper json, @Value("${daytracker.app-version:unknown}") String appVersion) {
		this.dataSource = dataSource;
		this.properties = properties;
		this.clock = clock;
		this.zonePolicy = zonePolicy;
		this.json = json;
		this.appVersion = appVersion;
	}

	public Status status() {
		return new Status(properties.backupsDir().toAbsolutePath().toString(), list(), lastAttempt);
	}

	/** Newest first. */
	public List<BackupInfo> list() {
		Path dir = properties.backupsDir();
		if (!Files.isDirectory(dir)) {
			return List.of();
		}
		try (Stream<Path> files = Files.list(dir)) {
			return files.filter(path -> NAME.matcher(path.getFileName().toString()).matches())
				.map(this::describe)
				.sorted(Comparator.comparing(BackupInfo::createdAt).reversed().thenComparing(BackupInfo::name))
				.toList();
		}
		catch (IOException ex) {
			log.warn("Cannot list the backup folder", ex);
			throw new BackupException("The backup folder could not be read.", ex);
		}
	}

	/** A backup the user asked for. */
	public synchronized BackupInfo backupNow() {
		return create(Kind.MANUAL, "manual-" + STAMP.format(clock.instant()) + ".db");
	}

	/** Made right before a restore replaces the database, so the current data can always be returned to. */
	public synchronized BackupInfo safetyBackup() {
		return create(Kind.SAFETY, "safety-before-restore-" + STAMP.format(clock.instant()) + ".db");
	}

	/** Makes today's automatic backup unless it exists, then keeps only the newest seven. */
	@Scheduled(initialDelayString = "PT30S", fixedDelayString = "PT1H")
	public synchronized void automaticBackupIfDue() {
		LocalDate today = LocalDate.now(clock.withZone(zonePolicy.zone()));
		String name = "auto-" + today.toString().replace("-", "") + ".db";
		try {
			if (Files.exists(properties.backupsDir().resolve(name))) {
				return;
			}
			create(Kind.AUTOMATIC, name);
			pruneAutomatic();
		}
		catch (RuntimeException ex) {
			// create() already recorded and logged the failure; the next hourly check tries again.
			log.warn("Automatic backup did not complete: {}", ex.getMessage());
		}
	}

	private BackupInfo create(Kind kind, String name) {
		Path dir = properties.backupsDir();
		Path temporary = dir.resolve(name + ".tmp");
		Path target = dir.resolve(name);
		try {
			Files.createDirectories(dir);
			requireFreeSpace(dir);
			Files.deleteIfExists(temporary);
			try (Connection connection = dataSource.getConnection();
					PreparedStatement statement = connection.prepareStatement("VACUUM INTO ?")) {
				statement.setString(1, temporary.toAbsolutePath().toString());
				statement.execute();
			}
			Inspection inspection = inspect(temporary, true);
			if (!inspection.ok()) {
				throw new BackupException("The new backup did not pass its integrity check, so it was discarded.");
			}
			writeMetadata(dir.resolve(name + ".json"), inspection);
			Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
			BackupInfo info = describe(target);
			lastAttempt = new Attempt(kind, true, clock.instant(), "Backup saved.", name);
			log.info("Created {} backup {}", kind, name);
			return info;
		}
		catch (BackupException | IOException | SQLException ex) {
			deleteQuietly(temporary);
			deleteQuietly(dir.resolve(name + ".json"));
			String message = ex instanceof BackupException ? ex.getMessage() : "The backup could not be written. "
					+ "Check that there is free disk space and that the folder can be written to.";
			lastAttempt = new Attempt(kind, false, clock.instant(), message, name);
			log.error("Backup {} failed", name, ex);
			throw ex instanceof BackupException failed ? failed : new BackupException(message, ex);
		}
	}

	private void requireFreeSpace(Path dir) throws IOException {
		long needed = Files.exists(properties.databaseFile()) ? Files.size(properties.databaseFile()) : 0;
		// A snapshot is never larger than the database; leave room for the checks as well.
		if (Files.getFileStore(dir).getUsableSpace() < needed * 2 + 1_000_000) {
			throw new BackupException("There is not enough free disk space to make a backup.");
		}
	}

	private void pruneAutomatic() {
		List<BackupInfo> automatic = list().stream().filter(info -> info.kind() == Kind.AUTOMATIC).toList();
		for (BackupInfo old : automatic.stream().skip(KEEP_AUTOMATIC).toList()) {
			deleteQuietly(properties.backupsDir().resolve(old.name()));
			deleteQuietly(properties.backupsDir().resolve(old.name() + ".json"));
			log.info("Removed old automatic backup {}", old.name());
		}
	}

	/** Checks a database file the user chose, copied into the staging folder, before anything is replaced. */
	public RestoreCheck validateStaged(String fileName) {
		Path staged = staged(fileName);
		if (!Files.isRegularFile(staged)) {
			throw new RestoreRejectedException("The chosen backup file could not be found.");
		}
		int newest = MigrationScript.loadAll("classpath:db/migration/V*__*.sql")
			.stream()
			.mapToInt(MigrationScript::version)
			.max()
			.orElse(0);
		Inspection inspection;
		try {
			inspection = inspect(staged, false);
		}
		catch (SQLException ex) {
			throw new RestoreRejectedException("This file is not a Day Tracker backup, or it is damaged.", ex);
		}
		if (!inspection.ok()) {
			throw new RestoreRejectedException("This backup is damaged (it failed its integrity check), so it cannot be restored.");
		}
		if (inspection.schemaVersion() == null || inspection.schemaVersion() == 0) {
			throw new RestoreRejectedException("This file is not a Day Tracker backup.");
		}
		if (inspection.schemaVersion() > newest) {
			throw new RestoreRejectedException("This backup was made by a newer version of Day Tracker (database version "
					+ inspection.schemaVersion() + "; this version understands up to " + newest + "). Update the app to restore it.");
		}
		if (!inspection.compatible()) {
			throw new RestoreRejectedException("This backup does not match this version of Day Tracker's database and cannot be restored.");
		}
		try {
			return new RestoreCheck(inspection.schemaVersion(), newest, Files.size(staged), counts(staged));
		}
		catch (IOException | SQLException ex) {
			throw new RestoreRejectedException("This backup could not be read.", ex);
		}
	}

	Path staged(String fileName) {
		if (fileName == null || !fileName.matches("staged-\\d{1,20}\\.db")) {
			throw new RestoreRejectedException("The chosen backup file is not valid.");
		}
		return properties.stagingDir().resolve(fileName);
	}

	// ----------------------------------------------------------------------------------------------

	private record Inspection(boolean ok, Integer schemaVersion, boolean compatible) {
	}

	/**
	 * Opens a database file of our own making (a fresh backup, or a staged copy)
	 * and checks it. With {@code convertJournal}, also switches it to a plain
	 * rollback journal so the finished file stands alone, without -wal/-shm files.
	 */
	private Inspection inspect(Path file, boolean convertJournal) throws SQLException {
		SQLiteConfig config = new SQLiteConfig();
		config.enforceForeignKeys(false);
		try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + file.toAbsolutePath(),
				config.toProperties()); Statement statement = connection.createStatement()) {
			if (convertJournal) {
				statement.execute("PRAGMA journal_mode = DELETE");
			}
			boolean ok = singleString(statement, "PRAGMA integrity_check").equalsIgnoreCase("ok");
			if (ok) {
				try (ResultSet violations = statement.executeQuery("PRAGMA foreign_key_check")) {
					ok = !violations.next();
				}
			}
			Integer version = null;
			boolean compatible = false;
			if (ok && tableExists(statement, "schema_migrations")) {
				Map<Integer, String> applied = new LinkedHashMap<>();
				try (ResultSet rows = statement.executeQuery("SELECT version, checksum FROM schema_migrations ORDER BY version")) {
					while (rows.next()) {
						applied.put(rows.getInt(1), rows.getString(2));
					}
				}
				version = applied.keySet().stream().max(Integer::compare).orElse(null);
				Map<Integer, String> known = new LinkedHashMap<>();
				MigrationScript.loadAll("classpath:db/migration/V*__*.sql").forEach(script -> known.put(script.version(), script.checksum()));
				// Every applied script must be one we know, unchanged; a newer version is reported separately.
				compatible = applied.entrySet().stream().allMatch(entry -> !known.containsKey(entry.getKey())
						|| known.get(entry.getKey()).equals(entry.getValue()));
			}
			return new Inspection(ok, version, compatible);
		}
	}

	private Map<String, Long> counts(Path file) throws SQLException {
		Map<String, Long> counts = new LinkedHashMap<>();
		try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + file.toAbsolutePath());
				Statement statement = connection.createStatement()) {
			counts.put("tasks", count(statement, "SELECT COUNT(*) FROM tasks"));
			counts.put("books", count(statement, "SELECT COUNT(*) FROM books"));
			counts.put("readingSessions", count(statement, "SELECT COUNT(*) FROM reading_sessions WHERE deleted_at IS NULL"));
			counts.put("appointments", count(statement, "SELECT COUNT(*) FROM calendar_events"));
			counts.put("reviews", count(statement, "SELECT COUNT(*) FROM daily_reviews"));
		}
		return counts;
	}

	private static long count(Statement statement, String sql) throws SQLException {
		try (ResultSet rows = statement.executeQuery(sql)) {
			return rows.next() ? rows.getLong(1) : 0;
		}
	}

	private static String singleString(Statement statement, String sql) throws SQLException {
		try (ResultSet rows = statement.executeQuery(sql)) {
			return rows.next() ? rows.getString(1) : "";
		}
	}

	private static boolean tableExists(Statement statement, String table) throws SQLException {
		try (ResultSet rows = statement.executeQuery("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '" + table + "'")) {
			return rows.next();
		}
	}

	private void writeMetadata(Path file, Inspection inspection) throws IOException {
		Map<String, Object> metadata = new LinkedHashMap<>();
		metadata.put("createdAt", Timestamps.format(Timestamps.truncate(clock.instant())));
		metadata.put("appVersion", appVersion);
		metadata.put("schemaVersion", inspection.schemaVersion());
		metadata.put("integrity", "ok");
		Files.writeString(file, json.writeValueAsString(metadata));
	}

	private BackupInfo describe(Path file) {
		String name = file.getFileName().toString();
		Instant createdAt;
		long size;
		try {
			createdAt = Files.getLastModifiedTime(file).toInstant();
			size = Files.size(file);
		}
		catch (IOException ex) {
			throw new BackupException("A backup file could not be read.", ex);
		}
		Integer schemaVersion = null;
		String version = null;
		boolean verified = false;
		Path sidecar = file.resolveSibling(name + ".json");
		if (Files.isRegularFile(sidecar)) {
			try {
				var metadata = json.readTree(Files.readString(sidecar));
				schemaVersion = metadata.path("schemaVersion").isIntegralNumber() ? metadata.path("schemaVersion").asInt() : null;
				version = metadata.path("appVersion").asString(null);
				verified = "ok".equals(metadata.path("integrity").asString(""));
				if (metadata.path("createdAt").isString()) {
					createdAt = Timestamps.parse(metadata.path("createdAt").asString());
				}
			}
			catch (IOException | RuntimeException ex) {
				log.warn("Unreadable backup metadata {}", sidecar.getFileName());
			}
		}
		return new BackupInfo(name, kindOf(name), createdAt, size, schemaVersion, version, verified);
	}

	private static Kind kindOf(String name) {
		Matcher matcher = NAME.matcher(name);
		String prefix = matcher.matches() ? name.substring(0, name.indexOf('-')).toLowerCase(Locale.ROOT) : "";
		return switch (prefix) {
			case "auto" -> Kind.AUTOMATIC;
			case "pre" -> Kind.PRE_MIGRATION;
			case "safety" -> Kind.SAFETY;
			default -> Kind.MANUAL;
		};
	}

	private static void deleteQuietly(Path path) {
		try {
			Files.deleteIfExists(path);
		}
		catch (IOException ex) {
			log.warn("Could not remove {}", path.getFileName());
		}
	}

}
