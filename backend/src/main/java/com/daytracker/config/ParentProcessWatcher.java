package com.daytracker.config;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Component;

/**
 * Private lifecycle channel with the Electron main process over stdin.
 * A "shutdown" line requests a graceful stop; end-of-stream means the parent
 * is gone, so the backend stops instead of staying behind as an orphan.
 */
@Component
public class ParentProcessWatcher {

	private static final Logger log = LoggerFactory.getLogger(ParentProcessWatcher.class);

	private static final long FORCED_EXIT_DELAY_MS = 10_000;

	private final ApplicationContext context;

	private final AtomicBoolean stopping = new AtomicBoolean();

	public ParentProcessWatcher(ApplicationContext context, AppProperties properties) {
		this.context = context;
		if (properties.parentWatch()) {
			Thread watcher = new Thread(this::watch, "parent-watch");
			watcher.setDaemon(true);
			watcher.start();
		}
	}

	private void watch() {
		try (BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
			String line;
			while ((line = reader.readLine()) != null) {
				if ("shutdown".equals(line.trim())) {
					stop("shutdown requested by parent process");
					return;
				}
			}
			stop("parent process closed the lifecycle pipe");
		}
		catch (IOException ex) {
			stop("lifecycle pipe failed");
		}
	}

	private void stop(String reason) {
		if (!stopping.compareAndSet(false, true)) {
			return;
		}
		log.info("Stopping backend: {}", reason);
		Thread guard = new Thread(() -> {
			try {
				Thread.sleep(FORCED_EXIT_DELAY_MS);
			}
			catch (InterruptedException ex) {
				return;
			}
			Runtime.getRuntime().halt(1);
		}, "forced-exit-guard");
		guard.setDaemon(true);
		guard.start();
		System.exit(SpringApplication.exit(context));
	}

}
