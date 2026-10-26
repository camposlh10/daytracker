package com.daytracker.database;

/**
 * Startup must abort when the schema cannot be brought to a known, valid state.
 */
public class MigrationException extends RuntimeException {

	public MigrationException(String message) {
		super(message);
	}

	public MigrationException(String message, Throwable cause) {
		super(message, cause);
	}

}
