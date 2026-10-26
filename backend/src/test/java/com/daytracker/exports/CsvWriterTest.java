package com.daytracker.exports;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;

import org.junit.jupiter.api.Test;

class CsvWriterTest {

	private static String render(CsvWriter csv) {
		String text = new String(csv.bytes(), StandardCharsets.UTF_8);
		assertThat(text).startsWith("﻿");
		return text.substring(1);
	}

	@Test
	void fieldsWithCommasQuotesAndLineBreaksAreQuotedAndQuotesDoubled() {
		CsvWriter csv = new CsvWriter(List.of("title", "notes"));
		csv.row("Buy milk, eggs", "She said \"hi\"\nthen left");
		csv.row("plain", null);

		assertThat(render(csv)).isEqualTo("title,notes\r\n\"Buy milk, eggs\",\"She said \"\"hi\"\"\nthen left\"\r\nplain,\r\n");
		assertThat(csv.rows()).isEqualTo(2);
	}

	@Test
	void textThatASpreadsheetWouldRunAsAFormulaIsNeutralized() {
		CsvWriter csv = new CsvWriter(List.of("title"));
		for (String dangerous : List.of("=HYPERLINK(\"http://x\")", "+1+2", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd")) {
			csv.row(dangerous);
		}
		csv.row("safe = text");
		csv.row("a-b");

		String text = render(csv);
		assertThat(text).contains("\"'=HYPERLINK(\"\"http://x\"\")\"\r\n")
			.contains("'+1+2\r\n")
			.contains("'-2+3\r\n")
			.contains("'@SUM(A1)\r\n")
			.contains("safe = text\r\n")
			.contains("a-b\r\n");
		assertThat(text).doesNotContain("\r\n=").doesNotContain("\r\n+1").doesNotContain("\r\n@");
	}

	@Test
	void numbersDatesAndBooleansAreWrittenAsTheyAreEvenWhenNegative() {
		CsvWriter csv = new CsvWriter(List.of("n", "date", "flag"));
		csv.row(-5, LocalDate.parse("2026-10-25"), true);

		assertThat(render(csv)).isEqualTo("n,date,flag\r\n-5,2026-10-25,true\r\n");
	}

	@Test
	void unicodeSurvives() {
		CsvWriter csv = new CsvWriter(List.of("title"));
		csv.row("Café — 日本語");

		assertThat(render(csv)).contains("Café — 日本語");
	}

}
