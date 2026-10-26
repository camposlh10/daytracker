package com.daytracker.covers;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.groups.Tuple.tuple;

import java.time.Duration;
import java.time.Instant;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import com.daytracker.MutableClock;
import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.covers.BookSuggestions.SuggestionService;
import com.daytracker.covers.OpenLibraryClient.CoverSource;
import com.daytracker.covers.OpenLibraryClient.Suggestion;

class BookSuggestionsTest {

	private final MutableClock clock = new MutableClock(Instant.parse("2026-10-17T12:00:00Z"));

	private FakeOpenLibrary fake;

	private SuggestionService suggestions;

	@BeforeEach
	void setUp() throws Exception {
		fake = new FakeOpenLibrary();
		suggestions = new SuggestionService(new OpenLibraryClient(new ObjectMapper(), fake.baseUrl(), fake.baseUrl(),
				fake.baseUrl()),
				clock);
	}

	@AfterEach
	void tearDown() {
		fake.close();
	}

	@Test
	void suggestsBooksWithWhateverDetailsOpenLibraryHas() {
		assertThat(suggestions.suggest("  Project   Hail ", false))
			.extracting(Suggestion::title, Suggestion::author, Suggestion::publisher, Suggestion::firstPublishYear,
					Suggestion::totalPages, Suggestion::coverId)
			.containsExactly(tuple("Project Hail Mary", "Andy Weir", null, 2021, 496, "111"),
					tuple("Summary of Project Hail Mary", "Someone", null, null, null, null));
	}

	@Test
	void aBookWithoutAnOpenLibraryCoverIsOfferedTheGoogleBooksCoverOfItsIsbn() {
		assertThat(suggestions.suggest("real-world software", true))
			.extracting(Suggestion::title, Suggestion::publisher, Suggestion::coverSource, Suggestion::coverId)
			.containsExactly(tuple("Real-World Software Development", "O'Reilly", CoverSource.GOOGLE_BOOKS,
					"9781491967171"));
		assertThat(suggestions.suggest("project hail", false).get(0).coverSource()).isEqualTo(CoverSource.OPEN_LIBRARY);
		assertThat(suggestions.suggest("project hail", false).get(1).coverSource()).isNull();
	}

	@Test
	void techBooksOnlyAsksForComputingSubjectsAndNamesTechPublishers() {
		assertThat(suggestions.suggest("learning go", false)).extracting(Suggestion::title)
			.containsExactly("Never Let Me Go");

		assertThat(suggestions.suggest("learning go", true))
			.extracting(Suggestion::title, Suggestion::publisher)
			.containsExactly(tuple("Learning Go", "O'Reilly"), tuple("Learning Go programming", "Packt"));
		// The two modes are remembered separately.
		assertThat(fake.searches.get()).isEqualTo(2);
	}

	@Test
	void searchSyntaxTypedByTheUserIsTreatedAsPlainWords() {
		// Parentheses, colons, and quotes would otherwise change the search; here they become spaces.
		assertThat(suggestions.suggest("C (programming): \"tips\"", false)).extracting(Suggestion::title)
			.containsExactly("C Programming Tips");
		assertThat(fake.searches.get()).isEqualTo(1);
	}

	@Test
	void repeatsOfTheSameSearchAreAnsweredFromMemoryForAWhile() {
		suggestions.suggest("project hail", false);
		suggestions.suggest("PROJECT HAIL", false);
		assertThat(fake.searches.get()).isEqualTo(1);

		clock.advance(Duration.ofMinutes(16));
		suggestions.suggest("project hail", false);
		assertThat(fake.searches.get()).isEqualTo(2);
	}

	@Test
	void shortOrOverlongTextIsRefusedWithoutAsking() {
		assertThatThrownBy(() -> suggestions.suggest("du", false)).isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> suggestions.suggest("   ", true)).isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> suggestions.suggest("x".repeat(201), false))
			.isInstanceOf(InvalidInputException.class);
		assertThat(fake.searches.get()).isZero();
	}

	@Test
	void anUnreadableAnswerOrNoConnectionIsReportedAsUnavailable() {
		assertThatThrownBy(() -> suggestions.suggest("broken", false))
			.isInstanceOf(OpenLibraryClient.UnavailableException.class);
		fake.close();
		assertThatThrownBy(() -> suggestions.suggest("anything", true))
			.isInstanceOf(OpenLibraryClient.UnavailableException.class);
	}

}
