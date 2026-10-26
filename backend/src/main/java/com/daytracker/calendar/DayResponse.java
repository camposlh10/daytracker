package com.daytracker.calendar;

import java.time.LocalDate;
import java.util.List;

import com.daytracker.events.EventResponse;
import com.daytracker.reading.ReadingGoals.EffectiveGoal;
import com.daytracker.reading.ReadingSession;
import com.daytracker.reviews.DailyReview;
import com.daytracker.tasks.TaskResponse;

/**
 * Everything shown for one selected date: the tasks planned on it, the
 * unfinished tasks carried over from earlier dates, the reading recorded on it
 * and the target in force on it, the appointments that overlap it, and its
 * review ({@code null} until one is written).
 */
public record DayResponse(LocalDate date, List<TaskResponse> tasks, List<TaskResponse> carryOver,
		List<ReadingSession> readingSessions, long pagesRead, EffectiveGoal readingGoal, List<EventResponse> events,
		DailyReview review) {
}
