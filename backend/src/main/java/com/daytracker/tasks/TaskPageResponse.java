package com.daytracker.tasks;

import java.util.List;

public record TaskPageResponse(List<TaskResponse> items, int page, int size, long total) {
}
