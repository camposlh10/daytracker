package com.daytracker.exports;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Builds CSV text that opens safely in a spreadsheet.
 *
 * <p>A field is quoted when it contains a comma, a quote, or a line break, and
 * quotes inside it are doubled. Text typed by the user that starts with a
 * character a spreadsheet treats as a formula ({@code = + - @}, tab, or carriage
 * return) is prefixed with an apostrophe, so opening the file cannot run it.
 * Numbers and dates are written as they are and are never altered.
 */
final class CsvWriter {

	/** Lets Excel read the file as UTF-8. */
	private static final String BYTE_ORDER_MARK = "﻿";

	private final StringBuilder out = new StringBuilder(BYTE_ORDER_MARK);

	private int rows;

	CsvWriter(List<String> header) {
		appendRow(header.stream().map(CsvWriter::text).toList());
		rows = 0;
	}

	/** Each value is a number, a date, or text; null is an empty field. */
	void row(Object... values) {
		appendRow(java.util.Arrays.stream(values).map(CsvWriter::cell).toList());
		rows++;
	}

	int rows() {
		return rows;
	}

	byte[] bytes() {
		return out.toString().getBytes(StandardCharsets.UTF_8);
	}

	private void appendRow(List<String> cells) {
		out.append(String.join(",", cells)).append("\r\n");
	}

	private static String cell(Object value) {
		if (value == null) {
			return "";
		}
		if (value instanceof Number || value instanceof Boolean || value instanceof java.time.temporal.TemporalAccessor) {
			return escape(value.toString());
		}
		return text(value.toString());
	}

	/** A free-text field: neutralized, then quoted if needed. */
	static String text(String value) {
		return escape(neutralize(value));
	}

	static String neutralize(String value) {
		if (!value.isEmpty()) {
			char first = value.charAt(0);
			if (first == '=' || first == '+' || first == '-' || first == '@' || first == '\t' || first == '\r') {
				return "'" + value;
			}
		}
		return value;
	}

	private static String escape(String value) {
		boolean quote = value.indexOf(',') >= 0 || value.indexOf('"') >= 0 || value.indexOf('\n') >= 0
				|| value.indexOf('\r') >= 0;
		return quote ? '"' + value.replace("\"", "\"\"") + '"' : value;
	}

}
