package com.daytracker.backup;

import java.time.Instant;

/**
 * A backup file in the application's backup folder.
 *
 * @param name the file name, which is also its identity
 * @param schemaVersion the newest migration the backup contains, or null if it could not be read
 * @param appVersion the application version that made it, or null for older files
 * @param verified true when the file passed an integrity check when it was made
 */
public record BackupInfo(String name, Kind kind, Instant createdAt, long sizeBytes, Integer schemaVersion,
		String appVersion, boolean verified) {

	public enum Kind {

		/** Made on request. Never deleted automatically. */
		MANUAL,

		/** At most one per day while the application runs; the newest seven are kept. */
		AUTOMATIC,

		/** Made just before a database upgrade. */
		PRE_MIGRATION,

		/** Made just before a restore replaces the database. */
		SAFETY

	}

}
