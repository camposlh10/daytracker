package com.daytracker.backup;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.daytracker.common.ApiError;

@RestController
public class BackupController {

	public record Staged(@NotNull String fileName) {
	}

	private final BackupService service;

	public BackupController(BackupService service) {
		this.service = service;
	}

	/** The backup folder, every backup in it, and what the last attempt did. */
	@GetMapping("/api/v1/backups")
	BackupService.Status status() {
		return service.status();
	}

	/** Makes a consistent, verified backup in the application's backup folder. */
	@PostMapping("/api/v1/backups")
	ResponseEntity<BackupInfo> backupNow() {
		return ResponseEntity.status(HttpStatus.CREATED).body(service.backupNow());
	}

	/**
	 * Restore step 1, used only by the Electron main process (the page cannot call
	 * it): checks a staged copy of the chosen file and says what it contains.
	 */
	@PostMapping("/api/v1/lifecycle/restore/validate")
	BackupService.RestoreCheck validate(@Valid @RequestBody Staged request) {
		return service.validateStaged(request.fileName());
	}

	/** Restore step 2: saves the current data before it is replaced. */
	@PostMapping("/api/v1/lifecycle/restore/safety-backup")
	ResponseEntity<BackupInfo> safetyBackup() {
		return ResponseEntity.status(HttpStatus.CREATED).body(service.safetyBackup());
	}

	@RestControllerAdvice(assignableTypes = BackupController.class)
	static class Errors {

		@ExceptionHandler(RestoreRejectedException.class)
		ResponseEntity<ApiError> rejected(RestoreRejectedException ex) {
			return ResponseEntity.badRequest().body(ApiError.of("RESTORE_REJECTED", ex.getMessage()));
		}

		@ExceptionHandler(BackupException.class)
		ResponseEntity<ApiError> failed(BackupException ex) {
			return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
				.body(ApiError.of("BACKUP_FAILED", ex.getMessage()));
		}

	}

}
