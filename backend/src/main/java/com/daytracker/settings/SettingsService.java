package com.daytracker.settings;

import java.time.Clock;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.common.Timestamps;
import com.daytracker.settings.AppSettings.TimeFormat;

/**
 * Preferences kept in the {@code settings} table as allowlisted, validated
 * key/value pairs. The reading goal is deliberately not here: changing it is a
 * domain operation with its own history.
 */
@Service
public class SettingsService implements ZonePolicy {

	static final String DISPLAY_NAME = "displayName";

	static final String TIMEZONE = "timezone";

	static final String WEEK_START = "weekStart";

	static final String TIME_FORMAT = "timeFormat";

	static final Set<String> KEYS = Set.of(DISPLAY_NAME, TIMEZONE, WEEK_START, TIME_FORMAT);

	static final int MAX_NAME_LENGTH = 60;

	/** Monday, the common default in Europe and Brazil. */
	static final int DEFAULT_WEEK_START = 1;

	/** Absent properties are left unchanged. */
	public record Update(String displayName, String timezone, Integer weekStart, TimeFormat timeFormat) {
	}

	private final JdbcClient jdbc;

	private final Clock clock;

	private final ZoneId systemZone;

	// The zone is read for every date calculation, so it is remembered until a change.
	private volatile ZoneId cachedZone;

	@Autowired
	public SettingsService(JdbcClient jdbc, Clock clock) {
		this(jdbc, clock, ZoneId.systemDefault());
	}

	SettingsService(JdbcClient jdbc, Clock clock, ZoneId systemZone) {
		this.jdbc = jdbc;
		this.clock = clock;
		this.systemZone = systemZone;
	}

	@Override
	public ZoneId zone() {
		ZoneId zone = cachedZone;
		if (zone == null) {
			zone = ZoneId.of(get().timezone());
			cachedZone = zone;
		}
		return zone;
	}

	/**
	 * The current settings. On first use the timezone is taken from the system
	 * and stored explicitly, so later changes of the computer's zone do not
	 * silently change how the user's days are grouped.
	 */
	@Transactional
	public AppSettings get() {
		Map<String, String> stored = readAll();
		if (!stored.containsKey(TIMEZONE)) {
			String initial = isUsableZone(systemZone.getId()) ? systemZone.getId() : "UTC";
			write(TIMEZONE, initial);
			stored.put(TIMEZONE, initial);
		}
		return new AppSettings(stored.getOrDefault(DISPLAY_NAME, ""), stored.get(TIMEZONE),
				parseWeekStart(stored.get(WEEK_START)), parseTimeFormat(stored.get(TIME_FORMAT)));
	}

	@Transactional
	public AppSettings update(Update update) {
		if (update.displayName() != null) {
			String name = update.displayName().strip().replaceAll("\\s+", " ");
			if (name.codePointCount(0, name.length()) > MAX_NAME_LENGTH) {
				throw new InvalidInputException("displayName", "The name is limited to " + MAX_NAME_LENGTH + " characters.");
			}
			write(DISPLAY_NAME, name);
		}
		if (update.timezone() != null) {
			if (!isUsableZone(update.timezone())) {
				throw new InvalidInputException("timezone", "Choose a timezone such as America/Sao_Paulo.");
			}
			write(TIMEZONE, update.timezone());
			cachedZone = null;
		}
		if (update.weekStart() != null) {
			if (update.weekStart() < 0 || update.weekStart() > 6) {
				throw new InvalidInputException("weekStart", "The week starts on a day from 0 (Sunday) to 6 (Saturday).");
			}
			write(WEEK_START, String.valueOf(update.weekStart()));
		}
		if (update.timeFormat() != null) {
			write(TIME_FORMAT, update.timeFormat().name());
		}
		return get();
	}

	/** Only region identifiers: fixed offsets would not follow daylight-saving rules. */
	static boolean isUsableZone(String id) {
		return id != null && ZoneId.getAvailableZoneIds().contains(id) && id.matches("[A-Za-z_]+(/[A-Za-z0-9_+\\-]+)*");
	}

	private Map<String, String> readAll() {
		Map<String, String> values = new HashMap<>();
		jdbc.sql("SELECT key, value FROM settings").query((row, rowNumber) -> values.put(row.getString(1), row.getString(2))).list();
		values.keySet().retainAll(KEYS);
		return values;
	}

	private void write(String key, String value) {
		jdbc.sql("""
				INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :now)
				ON CONFLICT (key) DO UPDATE SET value = :value, updated_at = :now""")
			.param("key", key)
			.param("value", value)
			.param("now", Timestamps.format(Timestamps.truncate(clock.instant())))
			.update();
	}

	private static int parseWeekStart(String value) {
		try {
			int day = value == null ? DEFAULT_WEEK_START : Integer.parseInt(value);
			return day >= 0 && day <= 6 ? day : DEFAULT_WEEK_START;
		}
		catch (NumberFormatException ex) {
			return DEFAULT_WEEK_START;
		}
	}

	private static TimeFormat parseTimeFormat(String value) {
		try {
			return value == null ? TimeFormat.H12 : TimeFormat.valueOf(value);
		}
		catch (IllegalArgumentException ex) {
			return TimeFormat.H12;
		}
	}

}
