package com.daytracker.covers;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.covers.OpenLibraryClient.Suggestion;

/**
 * Suggestions for the book form while a title is being typed, from Open Library.
 * Recent answers are kept in memory for a while, so typing back and forth does
 * not repeat requests. Nothing is stored in the database.
 */
public final class BookSuggestions {

	static final int MIN_QUERY_LENGTH = 3;

	static final int MAX_QUERY_LENGTH = 200;

	static final int MAX_SUGGESTIONS = 8;

	private BookSuggestions() {
	}

	@Service
	public static class SuggestionService {

		private static final int CACHE_ENTRIES = 200;

		private static final Duration CACHE_TIME = Duration.ofMinutes(15);

		private record Cached(List<Suggestion> suggestions, Instant at) {
		}

		private final OpenLibraryClient openLibrary;

		private final Clock clock;

		// Access-ordered, so the least recently used entry is dropped first.
		private final Map<String, Cached> cache = new LinkedHashMap<>(16, 0.75f, true) {
			@Override
			protected boolean removeEldestEntry(Map.Entry<String, Cached> eldest) {
				return size() > CACHE_ENTRIES;
			}
		};

		public SuggestionService(OpenLibraryClient openLibrary, Clock clock) {
			this.openLibrary = openLibrary;
			this.clock = clock;
		}

		public List<Suggestion> suggest(String query, boolean techOnly) {
			String cleaned = query == null ? "" : query.strip().replaceAll("\\s+", " ");
			if (cleaned.codePointCount(0, cleaned.length()) < MIN_QUERY_LENGTH) {
				throw new InvalidInputException("q", "Type at least " + MIN_QUERY_LENGTH + " characters.");
			}
			if (cleaned.length() > MAX_QUERY_LENGTH) {
				throw new InvalidInputException("q", "The search is limited to " + MAX_QUERY_LENGTH + " characters.");
			}
			String key = (techOnly ? "tech:" : "all:") + cleaned.toLowerCase(Locale.ROOT);
			Instant now = clock.instant();
			synchronized (cache) {
				Cached hit = cache.get(key);
				if (hit != null && hit.at().plus(CACHE_TIME).isAfter(now)) {
					return hit.suggestions();
				}
			}
			List<Suggestion> suggestions = List.copyOf(openLibrary.suggest(cleaned, MAX_SUGGESTIONS, techOnly));
			synchronized (cache) {
				cache.put(key, new Cached(suggestions, now));
			}
			return suggestions;
		}

	}

	@RestController
	public static class SuggestionController {

		private final SuggestionService service;

		public SuggestionController(SuggestionService service) {
			this.service = service;
		}

		/** Sends what was typed to openlibrary.org; 502 when it cannot be reached. */
		@GetMapping("/api/v1/book-suggestions")
		List<Suggestion> suggest(@RequestParam String q, @RequestParam(defaultValue = "false") boolean tech) {
			return service.suggest(q, tech);
		}

	}

}
