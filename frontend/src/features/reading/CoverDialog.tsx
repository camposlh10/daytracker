import { useState } from 'react';
import { ApiError, booksApi, candidateCoverUrl, COVER_SOURCE_NAMES, errorMessage } from '../../api/client';
import type { Book, CoverCandidate } from '../../api/bridge';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { BookCover } from './BookCover';
import form from '../../components/form.module.css';
import styles from './CoverDialog.module.css';

interface CoverDialogProps {
  book: Book;
  backendReady: boolean;
  onClose: () => void;
  /** Called after the cover was set or removed. */
  onChanged: () => void;
}

type Search = { status: 'idle' } | { status: 'searching' } | { status: 'done'; candidates: CoverCandidate[] };

/**
 * Chooses a book's cover: from an Open Library search (only when asked, since it
 * sends the title and author over the internet), from an image file, or none.
 */
export function CoverDialog({ book, backendReady, onClose, onChanged }: CoverDialogProps) {
  const [search, setSearch] = useState<Search>({ status: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy || !backendReady || search.status === 'searching';

  const find = async () => {
    setSearch({ status: 'searching' });
    setError(null);
    try {
      setSearch({ status: 'done', candidates: await booksApi.findCovers(book.id) });
    } catch (failure) {
      setSearch({ status: 'idle' });
      setError(errorMessage(failure));
    }
  };

  const change = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      onChanged();
      onClose();
    } catch (failure) {
      // Closing the file picker without choosing is not an error.
      if (!(failure instanceof ApiError && failure.code === 'CANCELLED')) {
        setError(errorMessage(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Cover: ${book.title}`}
      size="large"
      onCancel={onClose}
      actions={
        <>
          {book.coverUpdatedAt && (
            <Button
              className={styles.pushLeft}
              disabled={disabled}
              onClick={() => void change(() => booksApi.removeCover(book.id))}
            >
              Remove cover
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className={styles.current}>
        <BookCover book={book} size="large" showProgress />
        <div className={styles.choices}>
          <Button variant="primary" disabled={disabled} onClick={() => void find()}>
            {search.status === 'searching' ? 'Searching…' : 'Search Open Library'}
          </Button>
          <Button disabled={disabled} onClick={() => void change(() => booksApi.chooseCoverFile(book.id))}>
            Choose an image file…
          </Button>
          <p className={styles.note}>
            Searching sends the title and author to Open Library (openlibrary.org). For books it has no cover for,
            the cover is looked up on Google Books by ISBN; check it is the right book. The cover you pick is saved
            in Day Tracker, so it keeps showing offline.
          </p>
        </div>
      </div>

      {error && (
        <p className={form.error} role="alert">
          {error}
        </p>
      )}

      {search.status === 'done' &&
        (search.candidates.length === 0 ? (
          <p>No covers were found for this title and author. You can choose an image file instead.</p>
        ) : (
          <ul className={styles.candidates} aria-label="Covers found">
            {search.candidates.map((candidate) => (
              <li key={candidate.sourceId}>
                <button
                  type="button"
                  className={styles.candidate}
                  disabled={disabled}
                  aria-label={`Use the cover of ${describe(candidate)}`}
                  onClick={() => void change(() => booksApi.setCover(book.id, candidate.sourceId, candidate.source))}
                >
                  <img className={styles.preview} src={candidateCoverUrl(candidate)} alt="" loading="lazy" />
                  <span className={styles.caption}>{candidate.title}</span>
                  {candidate.source === 'GOOGLE_BOOKS' && (
                    <span className={styles.source}>{COVER_SOURCE_NAMES.GOOGLE_BOOKS}</span>
                  )}
                  {(candidate.author || candidate.firstPublishYear) && (
                    <span className={styles.meta}>
                      {[candidate.author, candidate.firstPublishYear].filter(Boolean).join(', ')}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ))}
    </Dialog>
  );
}

function describe(candidate: CoverCandidate): string {
  return [candidate.title, candidate.author, candidate.firstPublishYear].filter(Boolean).join(', ');
}
