package com.daytracker.calendar;

import java.time.LocalDate;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class CalendarController {

	private final CalendarService service;

	public CalendarController(CalendarService service) {
		this.service = service;
	}

	@GetMapping("/calendar")
	CalendarRangeResponse range(@RequestParam LocalDate from, @RequestParam LocalDate to) {
		return service.range(from, to);
	}

	@GetMapping("/days/{date}")
	DayResponse day(@PathVariable LocalDate date) {
		return service.day(date);
	}

}
