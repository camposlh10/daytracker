import { useRef, useState, type FormEvent } from 'react';
import { ApiError, booksApi, errorMessage, readingSessionsApi } from '../../api/client';
import type { Book, ReadingSession, UpdateReadingSessionInput } from '../../api/bridge';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import type { IsoDate } from '../../lib/dates';
import form from '../../components/form.module.css';
import styles from './reading.module.css';

export type SessionEditorTarget =
  | { kind: 'create'; date: IsoDate; bookId?: string }
  | { kind: 'edit'; session: ReadingSession };

interface SessionDialogProps {
  target: SessionEditorTarget;
  /** Every current book; a new session can be recorded for any that is not archived. */
  books: Book[];
  /** Reading cannot be recorded for a later date. */
  today: IsoDate;
  backendReady: boolean;
  onClose: () => void;
  /** Called after any successful change. */
  onSaved: () => void;
}

interface FormValues {
  bookId: string;
  activityDate: string;
  pagesRead: string;
  endingPage: string;
  notes: string;
}

function valuesOf(target: SessionEditorTarget, books: Book[]): FormValues {
  if (target.kind === 'edit') {
    const { session } = target;
    return {
      bookId: session.bookId,
      activityDate: session.activityDate,
      pagesRead: String(session.pagesRead),
      endingPage: session.endingPage === null ? '' : String(session.endingPage),
      notes: session.notes ?? '',
    };
  }
  const reading = books.find((book) => book.status === 'READING') ?? books[0];
  return { bookId: target.bookId ?? reading?.id ?? '', activityDate: target.date, pagesRead: '', endingPage: '', notes: '' };
}

const WHOLE_NUMBER = /^\d+$/;

/** Records a reading session or corrects an existing one. */
export function SessionDialog({ target, books, today, backendReady, onClose, onSaved }: SessionDialogProps) {
  const editing = target.kind === 'edit' ? target.session : null;
  const [initial] = useState(() => valuesOf(target, books));
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Set after saving a session that ends on the last page of an unfinished book.
  const [finishable, setFinishable] = useState<Book | null>(null);
  // The id belongs to this draft, so retrying a create cannot count the pages twice.
  const draftId = useRef(crypto.randomUUID());

  const book = books.find((candidate) => candidate.id === values.bookId);
  const dirty = (Object.keys(values) as (keyof FormValues)[]).some((key) => values[key] !== initial[key]);
  const busy = saving || !backendReady;

  const set = (key: keyof FormValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    draftId.current = crypto.randomUUID();
  };

  const validate = (): Record<string, string> => {
    const problems: Record<string, string> = {};
    if (!values.bookId) {
      problems.bookId = 'Choose a book.';
    }
    if (!values.activityDate) {
      problems.activityDate = 'Choose a date.';
    } else if (values.activityDate > today) {
      problems.activityDate = 'Reading cannot be recorded for a future date.';
    }
    if (!WHOLE_NUMBER.test(values.pagesRead) || Number(values.pagesRead) < 1) {
      problems.pagesRead = 'Enter how many pages you read, at least 1.';
    }
    if (values.endingPage !== '') {
      if (!WHOLE_NUMBER.test(values.endingPage)) {
        problems.endingPage = 'Enter a page number, or leave it empty.';
      } else if (book && Number(values.endingPage) > book.totalPages) {
        problems.endingPage = `This book has ${book.totalPages} pages.`;
      }
    }
    return problems;
  };

  const run = async (operation: () => Promise<unknown>, afterwards: () => void) => {
    if (busy) {
      return;
    }
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      await operation();
      onSaved();
      afterwards();
    } catch (failure) {
      // The form stays open with everything typed still in it.
      setError(errorMessage(failure));
      if (failure instanceof ApiError) {
        setFieldErrors(Object.fromEntries(failure.fieldErrors.map(({ field, message }) => [field, message])));
      }
    } finally {
      setSaving(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const problems = validate();
    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems);
      return;
    }
    const pagesRead = Number(values.pagesRead);
    const endingPage = values.endingPage === '' ? null : Number(values.endingPage);
    const notes = values.notes.trim() === '' ? null : values.notes;
    // Finishing a book is always the user's decision; reaching the last page only prompts it.
    const afterwards = () => {
      if (book && endingPage === book.totalPages && book.status !== 'FINISHED') {
        setFinishable(book);
      } else {
        onClose();
      }
    };

    if (!editing) {
      void run(
        () =>
          readingSessionsApi.create({
            id: draftId.current,
            bookId: values.bookId,
            activityDate: values.activityDate,
            pagesRead,
            endingPage,
            notes,
          }),
        afterwards,
      );
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }
    const changes: UpdateReadingSessionInput = { version: editing.version };
    if (values.activityDate !== initial.activityDate) changes.activityDate = values.activityDate;
    if (values.pagesRead !== initial.pagesRead) changes.pagesRead = pagesRead;
    if (values.endingPage !== initial.endingPage) changes.endingPage = endingPage;
    if (values.notes !== initial.notes) changes.notes = notes;
    void run(() => readingSessionsApi.update(editing.id, changes), afterwards);
  };

  if (finishable) {
    return (
      <Dialog
        title="Finished the book?"
        onCancel={onClose}
        actions={
          <>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void run(
                  () => booksApi.update(finishable.id, { version: finishable.version, status: 'FINISHED' }),
                  onClose,
                )
              }
            >
              Mark as finished
            </Button>
            <Button onClick={onClose}>Not now</Button>
          </>
        }
      >
        <p>
          Your reading was saved. You reached the last page of “{finishable.title}”. Mark it as finished?
        </p>
        {error && (
          <p className={form.error} role="alert">
            {error}
          </p>
        )}
      </Dialog>
    );
  }

  const selectable = books.filter((candidate) => candidate.archivedAt === null);

  return (
    <Dialog
      title={editing ? 'Edit reading session' : 'Log reading'}
      size="large"
      // Escape never throws away typed changes; closing a changed form is explicit.
      onCancel={() => {
        if (!dirty) {
          onClose();
        }
      }}
      actions={
        <>
          <Button onClick={onClose}>{dirty ? 'Discard changes' : 'Close'}</Button>
          <Button type="submit" form="session-form" variant="primary" disabled={busy}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="session-form" className={styles.form} onSubmit={save} noValidate>
        <div className={form.field}>
          <label className={form.label} htmlFor="session-book">
            Book
          </label>
          {editing ? (
            // A session stays with its book; a wrong book is fixed by deleting and logging again.
            <input id="session-book" className={form.control} value={editing.bookTitle} disabled readOnly />
          ) : (
            <select
              id="session-book"
              className={form.control}
              value={values.bookId}
              aria-invalid={fieldErrors.bookId !== undefined}
              onChange={(event) => set('bookId', event.target.value)}
            >
              {selectable.length === 0 && <option value="">No books yet</option>}
              {selectable.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </option>
              ))}
            </select>
          )}
          {fieldErrors.bookId && <span className={form.error}>{fieldErrors.bookId}</span>}
        </div>

        <div className={styles.columns}>
          <div className={form.field}>
            <label className={form.label} htmlFor="session-date">
              Date
            </label>
            <input
              id="session-date"
              type="date"
              className={form.control}
              value={values.activityDate}
              max={today}
              aria-invalid={fieldErrors.activityDate !== undefined}
              onChange={(event) => set('activityDate', event.target.value)}
            />
            {fieldErrors.activityDate && <span className={form.error}>{fieldErrors.activityDate}</span>}
          </div>

          <div className={form.field}>
            <label className={form.label} htmlFor="session-pages">
              Pages read
            </label>
            <input
              id="session-pages"
              className={form.control}
              inputMode="numeric"
              value={values.pagesRead}
              aria-invalid={fieldErrors.pagesRead !== undefined}
              onChange={(event) => set('pagesRead', event.target.value.trim())}
            />
            {fieldErrors.pagesRead && <span className={form.error}>{fieldErrors.pagesRead}</span>}
          </div>

          <div className={form.field}>
            <label className={form.label} htmlFor="session-ending">
              Ended on page (optional)
            </label>
            <input
              id="session-ending"
              className={form.control}
              inputMode="numeric"
              value={values.endingPage}
              aria-invalid={fieldErrors.endingPage !== undefined}
              aria-describedby="session-position"
              onChange={(event) => set('endingPage', event.target.value.trim())}
            />
            {fieldErrors.endingPage && <span className={form.error}>{fieldErrors.endingPage}</span>}
            {book && (
              <span id="session-position" className={styles.hint}>
                Now on page {book.currentPage} of {book.totalPages}
              </span>
            )}
          </div>
        </div>

        <div className={form.field}>
          <label className={form.label} htmlFor="session-notes">
            Notes (optional)
          </label>
          <textarea
            id="session-notes"
            className={form.control}
            value={values.notes}
            maxLength={5000}
            onChange={(event) => set('notes', event.target.value)}
          />
          {fieldErrors.notes && <span className={form.error}>{fieldErrors.notes}</span>}
        </div>

        <p className={styles.hint}>
          Pages read is how much you read. The ending page is where you are in the book; re-reading counts as pages
          read without moving it forward.
        </p>

        {error && (
          <p className={form.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

interface DeleteSessionDialogProps {
  session: ReadingSession;
  backendReady: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

/** Deleting a session removes it from every total, so it is always confirmed first. */
export function DeleteSessionDialog({ session, backendReady, onClose, onDeleted }: DeleteSessionDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await readingSessionsApi.delete(session.id, session.version);
      onDeleted();
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog
      title="Delete this reading session?"
      onCancel={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={deleting || !backendReady} onClick={() => void confirm()}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      }
    >
      <p>
        {session.pagesRead === 1 ? '1 page' : `${session.pagesRead} pages`} of “{session.bookTitle}” will be removed
        from that day, its week, and the book.
      </p>
      {error && (
        <p className={form.error} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
