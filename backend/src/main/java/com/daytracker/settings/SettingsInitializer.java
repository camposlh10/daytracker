package com.daytracker.settings;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * Stores the timezone explicitly on the first run, once the database schema is
 * in place, so it is never silently re-derived from the computer's clock later.
 */
@Component
class SettingsInitializer implements ApplicationRunner {

	private final SettingsService settings;

	SettingsInitializer(SettingsService settings) {
		this.settings = settings;
	}

	@Override
	public void run(ApplicationArguments arguments) {
		settings.get();
	}

}
