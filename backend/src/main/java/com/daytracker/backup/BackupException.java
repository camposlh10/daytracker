package com.daytracker.backup;

/**
 * A backup or restore step failed. The message is meant for the user and never
 * includes stack traces or system details; the cause is logged.
 */
public class BackupException extends RuntimeException {

	public BackupException(String message) {
		super(message);
	}

	public BackupException(String message, Throwable cause) {
		super(message, cause);
	}

}
