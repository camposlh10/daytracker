import { useState } from 'react';
import { bookCoverUrl } from '../../api/client';
import type { Book } from '../../api/bridge';
import styles from './BookCover.module.css';

interface BookCoverProps {
  book: Book;
  size: 'small' | 'medium' | 'large';
  /** Shows how far through the book the reader is, along the bottom edge of the cover. */
  showProgress?: boolean;
  /** Names the progress bar for assistive technology; without it the bar is decorative. */
  progressLabel?: string;
}

/**
 * The book's cover, or a typographic placeholder when it has none or the image
 * cannot be shown. The picture is decorative: the title is always written next to it.
 */
export function BookCover({ book, size, showProgress = false, progressLabel }: BookCoverProps) {
  const url = bookCoverUrl(book);
  // Remembers which address failed, so a new cover is tried again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = url !== null && url !== failedUrl;
  const finished = book.status === 'FINISHED';

  return (
    <div className={`${styles.cover} ${styles[size]}`} data-testid="book-cover">
      {showImage ? (
        <img className={styles.image} src={url} alt="" draggable={false} onError={() => setFailedUrl(url)} />
      ) : (
        <span className={styles.placeholder} aria-hidden="true">
          {book.title.trim().charAt(0).toUpperCase()}
        </span>
      )}
      {showProgress && (
        <progress
          className={styles.progress}
          value={book.currentPage}
          max={book.totalPages}
          aria-label={progressLabel}
          aria-hidden={progressLabel ? undefined : true}
        />
      )}
      {finished && (
        <span className={styles.finished} aria-hidden="true">
          ✓
        </span>
      )}
    </div>
  );
}
