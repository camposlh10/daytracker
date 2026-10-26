package com.daytracker.backup;

/** The chosen backup cannot be restored (damaged, from a newer version, not a Day Tracker file, ...). */
public class RestoreRejectedException extends BackupException {

	public RestoreRejectedException(String message) {
		super(message);
	}

	public RestoreRejectedException(String message, Throwable cause) {
		super(message, cause);
	}

}
