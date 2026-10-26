package com.daytracker.settings;

import java.time.ZoneId;

/**
 * The timezone used to turn timestamps into calendar dates ("today", the day a
 * task was completed, which events overlap a date). It follows the timezone
 * setting, so it can change while the application runs.
 */
@FunctionalInterface
public interface ZonePolicy {

	ZoneId zone();

	/** A policy that never changes, for tests and fixed uses. */
	static ZonePolicy fixed(ZoneId zone) {
		return () -> zone;
	}

}
