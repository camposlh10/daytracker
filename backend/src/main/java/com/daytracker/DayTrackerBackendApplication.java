package com.daytracker;

import java.nio.file.Path;
import java.util.Map;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class DayTrackerBackendApplication {

	public static void main(String[] args) {
		SpringApplication application = new SpringApplication(DayTrackerBackendApplication.class);
		String dataDir = System.getenv("DAYTRACKER_DATA_DIR");
		if (dataDir != null && !dataDir.isBlank()) {
			application.setDefaultProperties(
					Map.of("logging.file.name", Path.of(dataDir, "logs", "backend.log").toString()));
		}
		application.run(args);
	}

}
