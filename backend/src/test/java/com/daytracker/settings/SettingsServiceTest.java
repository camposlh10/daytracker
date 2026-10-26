package com.daytracker.settings;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneId;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.daytracker.MutableClock;
import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.database.DatabaseConfig;
import com.daytracker.database.MigrationRunner;
import com.daytracker.database.MigrationScript;
import com.daytracker.settings.AppSettings.TimeFormat;

class SettingsServiceTest {

	@TempDir
	Path tempDir;

	private final MutableClock clock = new MutableClock(Instant.parse("2026-10-25T12:00:00Z"));

	private HikariDataSource dataSource;

	private JdbcClient jdbc;

	@BeforeEach
	void openDatabase() {
		dataSource = DatabaseConfig.createDataSource(tempDir.resolve("db").resolve("test.db"));
		new MigrationRunner(dataSource, tempDir.resolve("backups"), clock,
				MigrationScript.loadAll("classpath:db/migration/V*__*.sql"))
			.migrate();
		jdbc = JdbcClient.create(dataSource);
	}

	@AfterEach
	void closeDatabase() {
		dataSource.close();
	}

	private SettingsService service(String systemZone) {
		return new SettingsService(jdbc, clock, ZoneId.of(systemZone));
	}

	@Test
	void theFirstRunStoresTheSystemTimezoneExplicitlyAndLaterRunsKeepIt() {
		AppSettings first = service("America/Sao_Paulo").get();

		assertThat(first.timezone()).isEqualTo("America/Sao_Paulo");
		assertThat(first.displayName()).isEmpty();
		assertThat(first.weekStart()).isEqualTo(1);
		assertThat(first.timeFormat()).isEqualTo(TimeFormat.H12);
		assertThat(jdbc.sql("SELECT value FROM settings WHERE key = 'timezone'").query(String.class).single())
			.isEqualTo("America/Sao_Paulo");

		// The computer moves to another zone: the stored choice is not silently replaced.
		assertThat(service("Asia/Tokyo").get().timezone()).isEqualTo("America/Sao_Paulo");
	}

	@Test
	void aSystemZoneThatIsNotARegionFallsBackToUtc() {
		assertThat(service("UTC").get().timezone()).isEqualTo("UTC");
		jdbc.sql("DELETE FROM settings").update();
		assertThat(service("+03:00").get().timezone()).isEqualTo("UTC");
	}

	@Test
	void settingsAreUpdatedPartiallyAndTheZonePolicyFollowsTheTimezone() {
		SettingsService settings = service("America/Sao_Paulo");
		assertThat(settings.zone()).isEqualTo(ZoneId.of("America/Sao_Paulo"));

		AppSettings changed = settings.update(new SettingsService.Update("  Ana   Souza ", "Europe/Lisbon", 0, TimeFormat.H24));

		assertThat(changed).isEqualTo(new AppSettings("Ana Souza", "Europe/Lisbon", 0, TimeFormat.H24));
		assertThat(settings.zone()).isEqualTo(ZoneId.of("Europe/Lisbon"));

		// Absent properties stay as they are; an empty name clears it.
		AppSettings renamed = settings.update(new SettingsService.Update("", null, null, null));
		assertThat(renamed).isEqualTo(new AppSettings("", "Europe/Lisbon", 0, TimeFormat.H24));
		assertThat(new SettingsService(jdbc, clock, ZoneId.of("UTC")).get()).isEqualTo(renamed);
	}

	@Test
	void invalidValuesAreRejectedAndNothingIsChanged() {
		SettingsService settings = service("America/Sao_Paulo");
		settings.get();

		assertThatThrownBy(() -> settings.update(new SettingsService.Update(null, "Mars/Olympus", null, null)))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> settings.update(new SettingsService.Update(null, "+03:00", null, null)))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> settings.update(new SettingsService.Update(null, null, 7, null)))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> settings.update(new SettingsService.Update(null, null, -1, null)))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> settings.update(new SettingsService.Update("x".repeat(61), null, null, null)))
			.isInstanceOf(InvalidInputException.class);

		assertThat(settings.get()).isEqualTo(new AppSettings("", "America/Sao_Paulo", 1, TimeFormat.H12));
	}

	@Test
	void unknownKeysAndUnreadableValuesInTheTableAreIgnored() {
		SettingsService settings = service("America/Sao_Paulo");
		settings.get();
		jdbc.sql("INSERT INTO settings (key, value, updated_at) VALUES ('somethingElse', 'x', 'now')").update();
		jdbc.sql("UPDATE settings SET value = '9' WHERE key = 'weekStart'").update();
		jdbc.sql("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('timeFormat', 'H99', 'now')").update();

		assertThat(settings.get()).isEqualTo(new AppSettings("", "America/Sao_Paulo", 1, TimeFormat.H12));
	}

}
