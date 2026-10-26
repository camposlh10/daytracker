package com.daytracker.config;

import java.nio.file.Path;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Startup configuration handed over by the Electron main process.
 */
@ConfigurationProperties("daytracker")
public record AppProperties(String dataDir, String launchToken, boolean parentWatch) {

	private static final int MIN_TOKEN_LENGTH = 32;

	public AppProperties {
		if (dataDir == null || dataDir.isBlank()) {
			throw new IllegalStateException("DAYTRACKER_DATA_DIR must point to the application data directory.");
		}
		if (launchToken == null || launchToken.length() < MIN_TOKEN_LENGTH) {
			throw new IllegalStateException(
					"DAYTRACKER_TOKEN must contain a launch token of at least " + MIN_TOKEN_LENGTH + " characters.");
		}
	}

	public Path databaseFile() {
		return Path.of(dataDir, "db", "daytracker.db");
	}

	public Path backupsDir() {
		return Path.of(dataDir, "backups");
	}

	/** Where a database file chosen for restoring is copied and checked before anything is replaced. */
	public Path stagingDir() {
		return Path.of(dataDir, "restore-staging");
	}

	// The generated record toString would print the launch token.
	@Override
	public String toString() {
		return "AppProperties[dataDir=" + dataDir + ", parentWatch=" + parentWatch + "]";
	}

}
