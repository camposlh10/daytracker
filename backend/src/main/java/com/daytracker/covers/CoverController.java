package com.daytracker.covers;

import java.util.List;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.covers.OpenLibraryClient.Candidate;
import com.daytracker.covers.OpenLibraryClient.CoverSource;
import com.daytracker.reading.Book;

@RestController
public class CoverController {

	/** {@code source} defaults to Open Library, where {@code sourceId} is a cover id; for Google Books it is an ISBN. */
	public record UseCover(CoverSource source, @NotNull String sourceId) {
	}

	private final CoverService service;

	public CoverController(CoverService service) {
		this.service = service;
	}

	/** The stored cover image. The bytes go to the Electron main process, which serves them to the page. */
	@GetMapping("/api/v1/books/{id}/cover")
	ResponseEntity<byte[]> cover(@PathVariable UUID id) {
		return image(service.get(id));
	}

	@GetMapping("/api/v1/books/{id}/cover-candidates")
	List<Candidate> candidates(@PathVariable UUID id) {
		return service.candidates(id);
	}

	@GetMapping("/api/v1/cover-candidates/open-library/{coverId}/image")
	ResponseEntity<byte[]> preview(@PathVariable String coverId) {
		return image(service.preview(coverId));
	}

	@GetMapping("/api/v1/cover-candidates/google-books/{isbn}/image")
	ResponseEntity<byte[]> googleBooksPreview(@PathVariable String isbn) {
		return image(service.googleBooksPreview(isbn));
	}

	@PutMapping("/api/v1/books/{id}/cover")
	Book useCover(@PathVariable UUID id, @Valid @RequestBody UseCover request) {
		return service.useCover(id, request.source() == null ? CoverSource.OPEN_LIBRARY : request.source(),
				request.sourceId());
	}

	/** The raw image bytes of a file the user chose; the type is read from the bytes themselves. */
	@PutMapping(path = "/api/v1/books/{id}/cover/file",
			consumes = { MediaType.APPLICATION_OCTET_STREAM_VALUE, MediaType.IMAGE_JPEG_VALUE,
					MediaType.IMAGE_PNG_VALUE, "image/webp" })
	Book useUploadedCover(@PathVariable UUID id, HttpServletRequest request) throws java.io.IOException {
		long declared = request.getContentLengthLong();
		if (declared > CoverImage.MAX_BYTES) {
			throw new InvalidInputException("file", "The image is larger than 2 MB.");
		}
		byte[] data = request.getInputStream().readNBytes(CoverImage.MAX_BYTES + 1);
		return service.useUploadedCover(id, data);
	}

	@DeleteMapping("/api/v1/books/{id}/cover")
	ResponseEntity<Void> remove(@PathVariable UUID id) {
		service.remove(id);
		return ResponseEntity.noContent().build();
	}

	private static ResponseEntity<byte[]> image(CoverImage image) {
		return ResponseEntity.ok()
			.contentType(MediaType.parseMediaType(image.contentType()))
			.cacheControl(CacheControl.noCache())
			.header("X-Content-Type-Options", "nosniff")
			.body(image.data());
	}

}
