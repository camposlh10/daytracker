import type { KeyboardEvent } from 'react';
import type { Book } from '../../api/bridge';
import { BookCover } from './BookCover';
import styles from './CurrentlyReading.module.css';

interface CurrentlyReadingProps {
  /** The books being read, in the order to show them. */
  books: Book[];
  /** The book on show; the first one when it is not among the books. */
  shownId: string | null;
  onShow: (id: string) => void;
}

/**
 * The book being read, with its cover, title, author and page. With more than one,
 * arrows (or the arrow keys) move between them, wrapping around like a carousel.
 */
export function CurrentlyReading({ books, shownId, onShow }: CurrentlyReadingProps) {
  if (books.length === 0) {
    return <p className={styles.none}>Not reading a book right now.</p>;
  }
  const index = Math.max(
    0,
    books.findIndex((book) => book.id === shownId),
  );
  const book = books[index];
  const several = books.length > 1;
  const step = (by: number) => onShow(books[(index + by + books.length) % books.length].id);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (several && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      event.stopPropagation();
      step(event.key === 'ArrowLeft' ? -1 : 1);
    }
  };

  return (
    <section
      className={styles.carousel}
      aria-roledescription="carousel"
      aria-label="Currently reading"
      onKeyDown={onKeyDown}
    >
      <div
        className={styles.slide}
        role="group"
        aria-roledescription="slide"
        aria-label={several ? `${index + 1} of ${books.length}` : undefined}
        aria-live="polite"
      >
        <BookCover key={book.id} book={book} size="medium" showProgress />
        <div className={styles.text}>
          <span className={styles.title}>{book.title}</span>
          {book.author && <span className={styles.author}>{book.author}</span>}
          <span className={styles.page}>
            {book.currentPage} of {book.totalPages} pages
          </span>
        </div>
      </div>
      {several && (
        <div className={styles.nav}>
          <button type="button" className={styles.arrow} aria-label="Previous book" onClick={() => step(-1)}>
            ‹
          </button>
          <span className={styles.dots} aria-hidden="true">
            {books.map((other) => (
              <span key={other.id} className={other.id === book.id ? `${styles.dot} ${styles.current}` : styles.dot} />
            ))}
          </span>
          <button type="button" className={styles.arrow} aria-label="Next book" onClick={() => step(1)}>
            ›
          </button>
        </div>
      )}
    </section>
  );
}
