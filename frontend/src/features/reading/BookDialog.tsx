import { useRef, useState, type FormEvent } from 'react';
import { ApiError, booksApi, COVER_SOURCE_NAMES, coverPreviewUrl, errorMessage } from '../../api/client';
import type { Book, BookStatus, BookSuggestion, CoverSource, UpdateBookInput } from '../../api/bridge';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { BookTitleField } from './BookTitleField';
import { BOOK_STATUSES, BOOK_STATUS_LABELS } from './readingLabels';
import form from '../../components/form.module.css';
import styles from './reading.module.css';

interface BookDialogProps {
  /** The book to edit, or null to add one. */
  book: Book | null;
  backendReady: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface FormValues {
  title: string;
  author: string;
  totalPages: string;
  initialPage: string;
  status: BookStatus;
}

const WHOLE_NUMBER = /^\d+$/;

/** Adds a book or edits one, including its status (finishing it) and archive state. */
export function BookDialog({ book, backendReady, onClose, onSaved }: BookDialogProps) {
  const [initial] = useState<FormValues>(() => ({
    title: book?.title ?? '',
    author: book?.author ?? '',
    totalPages: book ? String(book.totalPages) : '',
    initialPage: book ? String(book.initialPage) : '0',
    status: book?.status ?? 'TO_READ',
  }));
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // The id belongs to this draft, so retrying a create cannot make a duplicate.
  const draftId = useRef(crypto.randomUUID());
  // The cover of a picked suggestion, added right after the book is created.
  const [suggestedCover, setSuggestedCover] = useState<{ source: CoverSource; id: string } | null>(null);
  const [useSuggestedCover, setUseSuggestedCover] = useState(true);

  const dirty = (Object.keys(values) as (keyof FormValues)[]).some((key) => values[key] !== initial[key]);
  const archived = book?.archivedAt != null;
  const busy = saving || !backendReady;

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    draftId.current = crypto.randomUUID();
  };

  /** Fills the form from a suggestion; every field stays editable. */
  const pick = (suggestion: BookSuggestion) => {
    setValues((current) => ({
      ...current,
      title: suggestion.title,
      author: suggestion.author ?? current.author,
      totalPages: suggestion.totalPages ? String(suggestion.totalPages) : current.totalPages,
    }));
    draftId.current = crypto.randomUUID();
    setSuggestedCover(
      suggestion.coverId && suggestion.coverSource ? { source: suggestion.coverSource, id: suggestion.coverId } : null,
    );
    setUseSuggestedCover(true);
    setFieldErrors({});
  };

  const create = async () => {
    const created = await booksApi.create({
      id: draftId.current,
      title: values.title,
      author: values.author.trim() === '' ? null : values.author,
      totalPages: Number(values.totalPages),
      initialPage: Number(values.initialPage),
      status: values.status,
    });
    if (suggestedCover && useSuggestedCover) {
      try {
        await booksApi.setCover(created.id, suggestedCover.id, suggestedCover.source);
      } catch {
        // The book is saved either way; a cover can still be added later from its Cover button.
      }
    }
  };

  const validate = (): Record<string, string> => {
    const problems: Record<string, string> = {};
    if (values.title.trim() === '') {
      problems.title = 'A title is required.';
    }
    if (!WHOLE_NUMBER.test(values.totalPages) || Number(values.totalPages) < 1) {
      problems.totalPages = 'Enter the number of pages, at least 1.';
    }
    if (!WHOLE_NUMBER.test(values.initialPage)) {
      problems.initialPage = 'Enter a page number, or 0 to start from the beginning.';
    } else if (!problems.totalPages && Number(values.initialPage) > Number(values.totalPages)) {
      problems.initialPage = 'The starting page cannot be past the last page.';
    }
    return problems;
  };

  const run = async (operation: () => Promise<unknown>) => {
    if (busy) {
      return;
    }
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      await operation();
      onSaved();
      onClose();
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
    if (!book) {
      void run(create);
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }
    const changes: UpdateBookInput = { version: book.version };
    if (values.title !== initial.title) changes.title = values.title;
    if (values.author !== initial.author) changes.author = values.author;
    if (values.totalPages !== initial.totalPages) changes.totalPages = Number(values.totalPages);
    if (values.initialPage !== initial.initialPage) changes.initialPage = Number(values.initialPage);
    if (values.status !== initial.status) changes.status = values.status;
    void run(() => booksApi.update(book.id, changes));
  };

  return (
    <Dialog
      title={book ? 'Edit book' : 'Add book'}
      size="large"
      // Escape never throws away typed changes; closing a changed form is explicit.
      onCancel={() => {
        if (!dirty) {
          onClose();
        }
      }}
      actions={
        <>
          {book && (
            <Button
              className={styles.pushLeft}
              disabled={busy}
              onClick={() => void run(() => booksApi.update(book.id, { version: book.version, archived: !archived }))}
            >
              {archived ? 'Restore' : 'Archive'}
            </Button>
          )}
          <Button onClick={onClose}>{dirty ? 'Discard changes' : 'Close'}</Button>
          <Button type="submit" form="book-form" variant="primary" disabled={busy}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="book-form" className={styles.form} onSubmit={save} noValidate>
        <div className={form.field}>
          <BookTitleField
            value={values.title}
            invalid={fieldErrors.title !== undefined}
            errorId={fieldErrors.title ? 'book-title-error' : undefined}
            suggest={!book && backendReady}
            onChange={(title) => {
              set('title', title);
              // A typed change means the picked book, and its cover, may no longer apply.
              setSuggestedCover(null);
            }}
            onPick={pick}
          />
          {fieldErrors.title && (
            <span id="book-title-error" className={form.error}>
              {fieldErrors.title}
            </span>
          )}
        </div>

        {suggestedCover && (
          <label className={styles.coverChoice}>
            <input
              type="checkbox"
              checked={useSuggestedCover}
              onChange={(event) => setUseSuggestedCover(event.target.checked)}
            />
            <img className={styles.coverThumb} src={coverPreviewUrl(suggestedCover.source, suggestedCover.id)} alt="" />
            Use this cover from {COVER_SOURCE_NAMES[suggestedCover.source]}
          </label>
        )}

        <div className={form.field}>
          <label className={form.label} htmlFor="book-author">
            Author
          </label>
          <input
            id="book-author"
            className={form.control}
            value={values.author}
            maxLength={200}
            onChange={(event) => set('author', event.target.value)}
          />
          {fieldErrors.author && <span className={form.error}>{fieldErrors.author}</span>}
        </div>

        <div className={styles.columns}>
          <div className={form.field}>
            <label className={form.label} htmlFor="book-total">
              Total pages
            </label>
            <input
              id="book-total"
              className={form.control}
              inputMode="numeric"
              value={values.totalPages}
              aria-invalid={fieldErrors.totalPages !== undefined}
              onChange={(event) => set('totalPages', event.target.value.trim())}
            />
            {fieldErrors.totalPages && <span className={form.error}>{fieldErrors.totalPages}</span>}
          </div>

          <div className={form.field}>
            <label className={form.label} htmlFor="book-initial">
              Starting page
            </label>
            <input
              id="book-initial"
              className={form.control}
              inputMode="numeric"
              value={values.initialPage}
              aria-invalid={fieldErrors.initialPage !== undefined}
              onChange={(event) => set('initialPage', event.target.value.trim())}
            />
            {fieldErrors.initialPage && <span className={form.error}>{fieldErrors.initialPage}</span>}
          </div>

          <div className={form.field}>
            <label className={form.label} htmlFor="book-status">
              Status
            </label>
            <select
              id="book-status"
              className={form.control}
              value={values.status}
              onChange={(event) => set('status', event.target.value as BookStatus)}
            >
              {BOOK_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {BOOK_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className={styles.hint}>
          The starting page is where you already were when you added the book. Archiving hides the book and keeps its
          reading history.
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
