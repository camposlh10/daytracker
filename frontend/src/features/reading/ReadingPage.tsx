import { useState } from 'react';
import { booksApi, calendarApi, readingGoalsApi, readingSessionsApi } from '../../api/client';
import type { Book, ReadingSession } from '../../api/bridge';
import { useLoadable } from '../../app/useLoadable';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { formatShortDate, type IsoDate } from '../../lib/dates';
import { BookCover } from './BookCover';
import { BookDialog } from './BookDialog';
import { CoverDialog } from './CoverDialog';
import { GoalDialog } from './GoalDialog';
import { DeleteSessionDialog, SessionDialog, type SessionEditorTarget } from './SessionDialog';
import { BOOK_STATUS_LABELS, pages, positionLabel, sessionSummary } from './readingLabels';
import form from '../../components/form.module.css';
import styles from './reading.module.css';

type OpenDialog =
  | { kind: 'book'; book: Book | null }
  | { kind: 'sessions'; book: Book }
  // `returnTo` reopens that book's session list when the editor closes.
  | { kind: 'session'; target: SessionEditorTarget; returnTo?: Book }
  | { kind: 'delete'; session: ReadingSession; returnTo: Book }
  | { kind: 'goal' }
  | { kind: 'cover'; book: Book };

interface ReadingPageProps {
  today: IsoDate;
  /** False while the backend is down: reads and writes pause. */
  backendReady: boolean;
  dataVersion?: number;
  onDataChanged?: () => void;
}

/** Books with their position and effort, today's reading against the target, and the session history. */
export function ReadingPage({ today, backendReady, dataVersion = 0, onDataChanged }: ReadingPageProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [changes, setChanges] = useState(0);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const refresh = changes + dataVersion;

  const books = useLoadable(`books:${showArchived}`, refresh, backendReady, () => booksApi.list(showArchived));
  const todayDetails = useLoadable(`day:${today}`, refresh, backendReady, () => calendarApi.getDay(today));
  const goals = useLoadable('goals', refresh, backendReady, () => readingGoalsApi.list());

  const changed = () => {
    setChanges((count) => count + 1);
    onDataChanged?.();
  };

  // After a change the list holds fresher copies of the books than an open dialog does.
  const latest = (book: Book): Book =>
    (books.status === 'loaded' ? books.data.find((candidate) => candidate.id === book.id) : undefined) ?? book;
  const currentBooks = books.status === 'loaded' && !showArchived ? books.data : [];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Reading</h1>
        <div className={styles.headerActions}>
          <Button
            disabled={currentBooks.length === 0}
            onClick={() => setDialog({ kind: 'session', target: { kind: 'create', date: today } })}
          >
            Log reading
          </Button>
          <Button variant="primary" onClick={() => setDialog({ kind: 'book', book: null })}>
            + Add book
          </Button>
        </div>
      </header>

      <section className={styles.goal} aria-label="Today's reading">
        {todayDetails.status === 'loaded' ? (
          <>
            <div className={styles.goalText}>
              <strong>
                {todayDetails.data.pagesRead} of {pages(todayDetails.data.readingGoal.targetPages)} today
              </strong>
              <span className={styles.muted}>
                {Math.round((todayDetails.data.pagesRead / todayDetails.data.readingGoal.targetPages) * 100)}% of the
                daily target
                {todayDetails.data.readingGoal.effectiveDate
                  ? `, set from ${formatShortDate(todayDetails.data.readingGoal.effectiveDate)}`
                  : ' (the starting default)'}
              </span>
            </div>
            {/* The bar stops at 100%; the text above shows the real figure, including over target. */}
            <progress
              className={styles.bar}
              value={Math.min(todayDetails.data.pagesRead, todayDetails.data.readingGoal.targetPages)}
              max={todayDetails.data.readingGoal.targetPages}
              aria-label="Progress toward today's reading target"
            />
            <Button onClick={() => setDialog({ kind: 'goal' })}>Change target</Button>
          </>
        ) : todayDetails.status === 'error' ? (
          <p className={form.error} role="alert">
            Today's reading could not be loaded: {todayDetails.message}
          </p>
        ) : (
          <p className={styles.muted}>Loading…</p>
        )}
      </section>

      <div className={styles.scope}>
        <label className={form.label} htmlFor="reading-scope">
          Show
        </label>
        <select
          id="reading-scope"
          className={`${form.control} ${styles.scopeSelect}`}
          value={showArchived ? 'archived' : 'current'}
          onChange={(event) => setShowArchived(event.target.value === 'archived')}
        >
          <option value="current">Current books</option>
          <option value="archived">Archived books</option>
        </select>
      </div>

      {books.status === 'loading' && <LoadingState label="Loading books…" />}
      {books.status === 'error' && <ErrorState message={`Books could not be loaded: ${books.message}`} />}
      {books.status === 'loaded' &&
        books.data.length === 0 &&
        (showArchived ? (
          <EmptyState title="No archived books" />
        ) : (
          <EmptyState title="No books yet">Add a book to start recording what you read.</EmptyState>
        ))}
      {books.status === 'loaded' && books.data.length > 0 && (
        <ul className={styles.books} aria-label="Books">
          {books.data.map((book) => (
            <li key={book.id} className={styles.book}>
              <BookCover book={book} size="large" showProgress progressLabel={`Position in ${book.title}`} />
              <div className={styles.bookBody}>
                <h2>{book.title}</h2>
                <p className={styles.muted}>
                  {book.author ? `${book.author} · ` : ''}
                  {BOOK_STATUS_LABELS[book.status]}
                </p>
                <p>{positionLabel(book)}</p>
                <p className={styles.muted}>{pages(book.pagesReadTotal)} read in total</p>
                <div className={styles.bookActions}>
                  {!book.archivedAt && (
                    <Button
                      aria-label={`Log reading for ${book.title}`}
                      onClick={() =>
                        setDialog({ kind: 'session', target: { kind: 'create', date: today, bookId: book.id } })
                      }
                    >
                      Log reading
                    </Button>
                  )}
                  <Button
                    aria-label={`Sessions of ${book.title}`}
                    onClick={() => setDialog({ kind: 'sessions', book })}
                  >
                    Sessions
                  </Button>
                  <Button aria-label={`Cover of ${book.title}`} onClick={() => setDialog({ kind: 'cover', book })}>
                    Cover
                  </Button>
                  <Button aria-label={`Edit ${book.title}`} onClick={() => setDialog({ kind: 'book', book })}>
                    Edit
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === 'book' && (
        <BookDialog book={dialog.book} backendReady={backendReady} onClose={() => setDialog(null)} onSaved={changed} />
      )}
      {dialog?.kind === 'sessions' && (
        <BookSessionsDialog
          book={latest(dialog.book)}
          refresh={refresh}
          backendReady={backendReady}
          onClose={() => setDialog(null)}
          onEdit={(session) =>
            setDialog({ kind: 'session', target: { kind: 'edit', session }, returnTo: dialog.book })
          }
          onDelete={(session) => setDialog({ kind: 'delete', session, returnTo: dialog.book })}
        />
      )}
      {dialog?.kind === 'session' && (
        <SessionDialog
          target={dialog.target}
          books={dialog.returnTo ? [latest(dialog.returnTo)] : currentBooks}
          today={today}
          backendReady={backendReady}
          onClose={() => setDialog(dialog.returnTo ? { kind: 'sessions', book: dialog.returnTo } : null)}
          onSaved={changed}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteSessionDialog
          session={dialog.session}
          backendReady={backendReady}
          onClose={() => setDialog({ kind: 'sessions', book: dialog.returnTo })}
          onDeleted={changed}
        />
      )}
      {dialog?.kind === 'cover' && (
        <CoverDialog
          book={latest(dialog.book)}
          backendReady={backendReady}
          onClose={() => setDialog(null)}
          onChanged={changed}
        />
      )}
      {dialog?.kind === 'goal' && todayDetails.status === 'loaded' && (
        <GoalDialog
          current={todayDetails.data.readingGoal}
          history={goals.status === 'loaded' ? goals.data : []}
          today={today}
          backendReady={backendReady}
          onClose={() => setDialog(null)}
          onSaved={changed}
        />
      )}
    </div>
  );
}

interface BookSessionsDialogProps {
  book: Book;
  refresh: number;
  backendReady: boolean;
  onClose: () => void;
  onEdit: (session: ReadingSession) => void;
  onDelete: (session: ReadingSession) => void;
}

const MAX_SESSIONS_SHOWN = 200;

/** A book's reading history, newest first, where each session can be corrected or deleted. */
function BookSessionsDialog({ book, refresh, backendReady, onClose, onEdit, onDelete }: BookSessionsDialogProps) {
  const sessions = useLoadable(`sessions:${book.id}`, refresh, backendReady, () =>
    readingSessionsApi.list({ bookId: book.id, size: MAX_SESSIONS_SHOWN }),
  );

  return (
    <Dialog
      title={`Sessions: ${book.title}`}
      size="large"
      onCancel={onClose}
      actions={<Button onClick={onClose}>Close</Button>}
    >
      <p>
        {positionLabel(book)} · {pages(book.pagesReadTotal)} read in total
      </p>
      {sessions.status === 'loading' && <p>Loading sessions…</p>}
      {sessions.status === 'error' && (
        <p className={form.error} role="alert">
          Sessions could not be loaded: {sessions.message}
        </p>
      )}
      {sessions.status === 'loaded' && sessions.data.items.length === 0 && <p>No reading recorded for this book.</p>}
      {sessions.status === 'loaded' && sessions.data.items.length > 0 && (
        <>
          <ul className={styles.sessions} aria-label="Reading sessions">
            {sessions.data.items.map((session) => (
              <li key={session.id} className={styles.session}>
                <div className={styles.sessionText}>
                  <strong>{formatShortDate(session.activityDate)}</strong>
                  <span>{sessionSummary(session)}</span>
                  {session.notes && <span className={styles.notes}>{session.notes}</span>}
                </div>
                <Button
                  className={styles.small}
                  aria-label={`Edit session of ${formatShortDate(session.activityDate)}, ${pages(session.pagesRead)}`}
                  onClick={() => onEdit(session)}
                >
                  Edit
                </Button>
                <Button
                  className={styles.small}
                  aria-label={`Delete session of ${formatShortDate(session.activityDate)}, ${pages(session.pagesRead)}`}
                  onClick={() => onDelete(session)}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
          {sessions.data.total > sessions.data.items.length && (
            <p>
              Showing the latest {sessions.data.items.length} of {sessions.data.total} sessions.
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
