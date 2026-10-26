package com.daytracker.covers;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.time.Instant;
import java.util.Arrays;
import java.util.UUID;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.ObjectMapper;

import com.daytracker.MutableClock;
import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.common.ApiExceptions.NotFoundException;
import com.daytracker.covers.OpenLibraryClient.Candidate;
import com.daytracker.covers.OpenLibraryClient.CoverSource;
import com.daytracker.database.DatabaseConfig;
import com.daytracker.database.MigrationRunner;
import com.daytracker.database.MigrationScript;
import com.daytracker.reading.Book;
import com.daytracker.reading.Book.BookStatus;
import com.daytracker.reading.BookRepository;
import com.daytracker.reading.BookRequests;
import com.daytracker.reading.BookService;

class CoverServiceTest {

	@TempDir
	Path tempDir;

	private final MutableClock clock = new MutableClock(Instant.parse("2026-10-17T12:00:00Z"));

	private FakeOpenLibrary fake;

	private HikariDataSource dataSource;

	private BookService books;

	private CoverService covers;

	@BeforeEach
	void setUp() throws Exception {
		fake = new FakeOpenLibrary();
		dataSource = DatabaseConfig.createDataSource(tempDir.resolve("db").resolve("test.db"));
		new MigrationRunner(dataSource, tempDir.resolve("backups"), clock,
				MigrationScript.loadAll("classpath:db/migration/V*__*.sql"))
			.migrate();
		JdbcClient jdbc = JdbcClient.create(dataSource);
		BookRepository bookRepository = new BookRepository(jdbc);
		books = new BookService(bookRepository, clock);
		covers = new CoverService(new CoverRepository(jdbc), bookRepository,
				new OpenLibraryClient(new ObjectMapper(), fake.baseUrl(), fake.baseUrl(), fake.baseUrl()), clock);
	}

	@AfterEach
	void tearDown() {
		dataSource.close();
		fake.close();
	}

	private Book book(String title) {
		return books.create(new BookRequests.Create(UUID.randomUUID(), title, "Frank Herbert", 612, 0,
				BookStatus.READING))
			.book();
	}

	@Test
	void searchReturnsOnlyResultsThatHaveACover() {
		Book dune = book("Dune");

		assertThat(covers.candidates(dune.id())).extracting(Candidate::sourceId, Candidate::title, Candidate::author,
				Candidate::firstPublishYear)
			.containsExactly(org.assertj.core.groups.Tuple.tuple("111", "Dune", "Frank Herbert", 1965),
					org.assertj.core.groups.Tuple.tuple("222", "Dune Messiah", null, null));
		assertThat(covers.candidates(book("Unknown").id())).isEmpty();
	}

	@Test
	void worksWithoutAnOpenLibraryCoverAreOfferedFromGoogleBooksByIsbn() {
		Book book = book("Real-World Software Development");

		assertThat(covers.candidates(book.id()))
			.extracting(Candidate::source, Candidate::sourceId, Candidate::title)
			.containsExactly(org.assertj.core.groups.Tuple.tuple(CoverSource.GOOGLE_BOOKS, "9781491967171",
					"Real-World Software Development"));
		assertThat(covers.googleBooksPreview("9781491967171").data()).isEqualTo(FakeOpenLibrary.JPEG);

		Book withCover = covers.useCover(book.id(), CoverSource.GOOGLE_BOOKS, "9781491967171");

		assertThat(withCover.coverUpdatedAt()).isNotNull();
		assertThat(covers.get(book.id()).data()).isEqualTo(FakeOpenLibrary.JPEG);
	}

	@Test
	void googleBooksPlaceholdersAndBadIsbnsAreRefused() {
		Book book = book("Real-World Software Development");

		// Google answers an unknown ISBN with an "image not available" PNG.
		assertThatThrownBy(() -> covers.useCover(book.id(), CoverSource.GOOGLE_BOOKS, "9780000000002"))
			.isInstanceOf(OpenLibraryClient.NotFoundException.class);
		assertThatThrownBy(() -> covers.useCover(book.id(), CoverSource.GOOGLE_BOOKS, "97814919671"))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> covers.useCover(book.id(), CoverSource.GOOGLE_BOOKS, "../../x"))
			.isInstanceOf(InvalidInputException.class);
		assertThat(books.get(book.id()).coverUpdatedAt()).isNull();
	}

	@Test
	void aChosenCoverIsDownloadedOnceAndStoredWithTheBook() {
		Book dune = book("Dune");
		assertThat(dune.coverUpdatedAt()).isNull();

		Book withCover = covers.useOpenLibraryCover(dune.id(), "111");

		assertThat(withCover.coverUpdatedAt()).isEqualTo(Instant.parse("2026-10-17T12:00:00Z"));
		assertThat(covers.get(dune.id()).data()).isEqualTo(FakeOpenLibrary.JPEG);
		assertThat(covers.get(dune.id()).contentType()).isEqualTo("image/jpeg");
		// Stored locally: it is still there with the source gone.
		fake.close();
		assertThat(covers.get(dune.id()).data()).isEqualTo(FakeOpenLibrary.JPEG);
		assertThat(books.get(dune.id()).coverUpdatedAt()).isNotNull();
	}

	@Test
	void fallsBackToTheMediumSizeAndReplacesAnEarlierCover() {
		Book dune = book("Dune");
		covers.useOpenLibraryCover(dune.id(), "111");
		clock.advance(java.time.Duration.ofMinutes(5));

		Book replaced = covers.useOpenLibraryCover(dune.id(), "222");

		assertThat(covers.get(dune.id()).contentType()).isEqualTo("image/png");
		assertThat(replaced.coverUpdatedAt()).isEqualTo(Instant.parse("2026-10-17T12:05:00Z"));
	}

	@Test
	void refusesImagesThatAreNotImagesTooLargeOrFromElsewhere() {
		Book dune = book("Dune");

		assertThatThrownBy(() -> covers.useOpenLibraryCover(dune.id(), "333")).isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> covers.useOpenLibraryCover(dune.id(), "444"))
			.isInstanceOf(OpenLibraryClient.UnavailableException.class)
			.hasMessageContaining("unexpected location");
		assertThatThrownBy(() -> covers.useOpenLibraryCover(dune.id(), "555"))
			.isInstanceOf(OpenLibraryClient.UnavailableException.class);
		assertThatThrownBy(() -> covers.useOpenLibraryCover(dune.id(), "666"))
			.isInstanceOf(OpenLibraryClient.UnavailableException.class);
		assertThatThrownBy(() -> covers.useOpenLibraryCover(dune.id(), "../../etc"))
			.isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> covers.useOpenLibraryCover(dune.id(), "777"))
			.isInstanceOf(OpenLibraryClient.NotFoundException.class);
		assertThat(books.get(dune.id()).coverUpdatedAt()).isNull();
	}

	@Test
	void reportsTheSourceAsUnavailableWhenOffline() {
		Book dune = book("Dune");
		fake.close();

		assertThatThrownBy(() -> covers.candidates(dune.id())).isInstanceOf(OpenLibraryClient.UnavailableException.class);
		assertThatThrownBy(() -> covers.useOpenLibraryCover(dune.id(), "111"))
			.isInstanceOf(OpenLibraryClient.UnavailableException.class);
	}

	@Test
	void anImageFileCanBeUsedAndTheCoverRemoved() {
		Book dune = book("Dune");

		assertThat(covers.useUploadedCover(dune.id(), FakeOpenLibrary.PNG).coverUpdatedAt()).isNotNull();
		assertThat(covers.get(dune.id()).contentType()).isEqualTo("image/png");

		covers.remove(dune.id());
		assertThat(books.get(dune.id()).coverUpdatedAt()).isNull();
		assertThatThrownBy(() -> covers.get(dune.id())).isInstanceOf(NotFoundException.class);
		// Removing again is harmless.
		covers.remove(dune.id());
	}

	@Test
	void uploadedFilesAreCheckedByTheirContent() {
		Book dune = book("Dune");
		byte[] gif = "GIF89a....".getBytes();
		byte[] tooLarge = Arrays.copyOf(FakeOpenLibrary.JPEG, CoverImage.MAX_BYTES + 1);
		byte[] webp = { 'R', 'I', 'F', 'F', 0, 0, 0, 0, 'W', 'E', 'B', 'P', 1 };

		assertThatThrownBy(() -> covers.useUploadedCover(dune.id(), gif)).isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> covers.useUploadedCover(dune.id(), tooLarge)).isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> covers.useUploadedCover(dune.id(), new byte[0])).isInstanceOf(InvalidInputException.class);
		assertThatThrownBy(() -> covers.useUploadedCover(UUID.randomUUID(), FakeOpenLibrary.PNG))
			.isInstanceOf(NotFoundException.class);
		covers.useUploadedCover(dune.id(), webp);
		assertThat(covers.get(dune.id()).contentType()).isEqualTo("image/webp");
	}

}
