package com.daytracker.settings;

/**
 * The user's preferences.
 *
 * @param displayName shown in the sidebar; may be empty
 * @param timezone an IANA region such as America/Sao_Paulo; stored explicitly on first run
 * @param weekStart 0 = Sunday ... 6 = Saturday
 * @param timeFormat how times of day are shown
 */
public record AppSettings(String displayName, String timezone, int weekStart, TimeFormat timeFormat) {

	public enum TimeFormat {

		H12, H24

	}

}
