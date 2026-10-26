package com.daytracker.calendar;

import java.time.LocalDate;
import java.util.List;

/** {@code from} is inclusive and {@code to} is exclusive. */
public record CalendarRangeResponse(LocalDate from, LocalDate to, List<CalendarItemResponse> items) {
}
