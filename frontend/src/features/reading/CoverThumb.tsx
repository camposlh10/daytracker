import { useState } from 'react';
import { bookCoverUrl } from '../../api/client';
import styles from './CoverThumb.module.css';

interface CoverThumbProps {
  bookId: string;
  title: string;
  /** When the cover last changed; null when the book has none. */
  coverUpdatedAt: string | null;
}

/**
 * A very small cover for dense lists such as calendar cells: the stored cover,
 * or the first letter of the title when there is none or it cannot be shown.
 * Decorative: the title is always written next to it.
 */
export function CoverThumb({ bookId, title, coverUpdatedAt }: CoverThumbProps) {
  const url = bookCoverUrl({ id: bookId, coverUpdatedAt });
  // Remembers which address failed, so a new cover is tried again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  return url !== null && url !== failedUrl ? (
    <img className={styles.thumb} src={url} alt="" draggable={false} onError={() => setFailedUrl(url)} />
  ) : (
    <span className={`${styles.thumb} ${styles.letter}`} aria-hidden="true">
      {title.trim().charAt(0).toUpperCase()}
    </span>
  );
}
