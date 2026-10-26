package com.daytracker.config;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * Tells the parent process which port was assigned once startup (including
 * migrations) has finished. The line carries the port only, never the token.
 */
@Component
public class ReadinessAnnouncer {

	public static final String READY_PREFIX = "DAYTRACKER_READY ";

	private final Environment environment;

	public ReadinessAnnouncer(Environment environment) {
		this.environment = environment;
	}

	@EventListener(ApplicationReadyEvent.class)
	public void announce() {
		String port = environment.getProperty("local.server.port");
		System.out.println(READY_PREFIX + "{\"port\":" + port + "}");
		System.out.flush();
	}

}
