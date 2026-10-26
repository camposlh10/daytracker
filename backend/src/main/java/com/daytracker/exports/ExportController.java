package com.daytracker.exports;

import java.time.LocalDate;

import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ExportController {

	private final ExportService service;

	public ExportController(ExportService service) {
		this.service = service;
	}

	/** A bounded CSV file. {@code from} and {@code to} (exclusive) apply to the summaries export only. */
	@GetMapping("/api/v1/exports/{dataset}")
	ResponseEntity<byte[]> export(@PathVariable String dataset, @RequestParam(required = false) LocalDate from,
			@RequestParam(required = false) LocalDate to) {
		ExportService.CsvFile file = service.export(dataset, from, to);
		return ResponseEntity.ok()
			.contentType(new MediaType("text", "csv", java.nio.charset.StandardCharsets.UTF_8))
			.header(HttpHeaders.CONTENT_DISPOSITION,
					ContentDisposition.attachment().filename(file.fileName()).build().toString())
			.header("X-Export-Truncated", String.valueOf(file.truncated()))
			.header("X-Content-Type-Options", "nosniff")
			.body(file.bytes());
	}

}
