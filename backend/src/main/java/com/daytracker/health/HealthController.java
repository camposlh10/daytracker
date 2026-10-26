package com.daytracker.health;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Reports readiness and the API version only. Protected like the rest of the API.
 */
@RestController
public class HealthController {

	public record HealthResponse(String status, String apiVersion) {
	}

	@GetMapping("/api/v1/health")
	HealthResponse health() {
		return new HealthResponse("READY", "v1");
	}

}
