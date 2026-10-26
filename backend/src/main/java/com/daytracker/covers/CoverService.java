package com.daytracker.covers;

import java.time.Clock;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.daytracker.common.ApiExceptions.InvalidInputException;
import com.daytracker.common.ApiExceptions.NotFoundException;
import com.daytracker.common.Timestamps;
import com.daytracker.covers.CoverRepository.Source;
import com.daytracker.covers.OpenLibraryClient.Candidate;
import com.daytracker.covers.OpenLibraryClient.CoverSource;
import com.daytracker.covers.OpenLibraryClient.Size;
import com.daytracker.reading.Book;
import com.daytracker.reading.BookRepository;

/**
 * Book covers. A cover is either downloaded once from Open Library, after the
 * user picks it from a search, or read from an image file the user chooses.
 * Either way it is stored in the database, so it keeps working offline and is
 * part of every backup. Network calls happen outside database transactions.
 */
@Service
public class CoverService {

	private final CoverRepository covers;

	private final BookRepository books;

	private final OpenLibraryClient openLibrary;

	private final Clock clock;

	public CoverService(CoverRepository covers, BookRepository books, OpenLibraryClient openLibrary, Clock clock) {
		this.covers = covers;
		this.books = books;
		this.openLibrary = openLibrary;
		this.clock = clock;
	}

	/** Open Library works that match the book's title and author and have a cover. */
	public List<Candidate> candidates(UUID bookId) {
		Book book = book(bookId);
		return openLibrary.search(book.title(), book.author());
	}

	/** A small preview of a search result's cover; not stored. */
	public CoverImage preview(String coverId) {
		return openLibrary.image(requireCoverId(coverId), Size.MEDIUM);
	}

	/** A preview of the Google Books cover of an ISBN; not stored. */
	public CoverImage googleBooksPreview(String isbn) {
		return openLibrary.googleBooksImage(requireIsbn(isbn));
	}

	/** Downloads the chosen cover and makes it the book's cover. */
	public Book useCover(UUID bookId, CoverSource source, String sourceId) {
		if (source == CoverSource.GOOGLE_BOOKS) {
			book(bookId);
			CoverImage image = openLibrary.googleBooksImage(requireIsbn(sourceId));
			return store(bookId, image, Source.GOOGLE_BOOKS, sourceId);
		}
		return useOpenLibraryCover(bookId, sourceId);
	}

	/** Downloads the chosen Open Library cover and makes it the book's cover. */
	public Book useOpenLibraryCover(UUID bookId, String coverId) {
		book(bookId);
		CoverImage image;
		try {
			image = openLibrary.image(requireCoverId(coverId), Size.LARGE);
		}
		catch (OpenLibraryClient.NotFoundException ex) {
			// Some works only have the medium size.
			image = openLibrary.image(coverId, Size.MEDIUM);
		}
		return store(bookId, image, Source.OPEN_LIBRARY, coverId);
	}

	/** Makes an image file chosen by the user the book's cover. */
	public Book useUploadedCover(UUID bookId, byte[] data) {
		book(bookId);
		return store(bookId, CoverImage.of(data, "file"), Source.FILE, null);
	}

	@Transactional
	public void remove(UUID bookId) {
		book(bookId);
		covers.delete(bookId);
	}

	@Transactional(readOnly = true)
	public CoverImage get(UUID bookId) {
		return covers.find(bookId).orElseThrow(() -> new NotFoundException("This book has no cover."));
	}

	private Book store(UUID bookId, CoverImage image, Source source, String sourceId) {
		// The book may have been archived meanwhile, but not deleted: books are never deleted.
		covers.save(bookId, image, source, sourceId, Timestamps.truncate(clock.instant()));
		return book(bookId);
	}

	private Book book(UUID bookId) {
		return books.findById(bookId).orElseThrow(() -> new NotFoundException("Book not found."));
	}

	private static String requireIsbn(String isbn) {
		if (isbn == null || !isbn.matches("\\d{9}[\\dX]|\\d{13}")) {
			throw new InvalidInputException("sourceId", "A Google Books cover is looked up by an ISBN of 10 or 13 digits.");
		}
		return isbn;
	}

	private static String requireCoverId(String coverId) {
		if (coverId == null || !coverId.matches("\\d{1,12}")) {
			throw new InvalidInputException("sourceId", "An Open Library cover id is a number.");
		}
		return coverId;
	}

}
