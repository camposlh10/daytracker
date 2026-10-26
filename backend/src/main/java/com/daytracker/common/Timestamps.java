package com.daytracker.common;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;

/**
 * Stored system times use one fixed-width UTC format so that text comparison
 * in SQLite orders them chronologically.
 */
public final class Timestamps {

	private static final DateTimeFormatter FORMAT = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'")
		.withZone(ZoneOffset.UTC);

	private Timestamps() {
	}

	public static Instant truncate(Instant instant) {
		return instant.truncatedTo(ChronoUnit.MILLIS);
	}

	public static String format(Instant instant) {
		return FORMAT.format(instant);
	}

	public static Instant parse(String value) {
		return value == null ? null : Instant.parse(value);
	}

}
