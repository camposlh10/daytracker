import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { booksApi, coverPreviewUrl } from '../../api/client';
import type { BookSuggestion } from '../../api/bridge';
import form from '../../components/form.module.css';
import styles from './BookTitleField.module.css';

const MIN_LETTERS = 3;
const TYPING_PAUSE_MS = 350;
const TECH_ONLY_KEY = 'daytracker.bookSuggestions.techOnly';

// A per-computer preference; storage can be unavailable, and then it is simply not remembered.
function readTechOnly(): boolean {
  try {
    return window.localStorage.getItem(TECH_ONLY_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeTechOnly(value: boolean): void {
  try {
    window.localStorage.setItem(TECH_ONLY_KEY, String(value));
  } catch {
    // Not remembered this time.
  }
}

type Results =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; items: BookSuggestion[] }
  | { status: 'error' };

interface BookTitleFieldProps {
  value: string;
  invalid: boolean;
  errorId?: string;
  /** Look up suggestions while typing; off when editing an existing book or while the backend is down. */
  suggest: boolean;
  onChange: (title: string) => void;
  onPick: (suggestion: BookSuggestion) => void;
}

export function suggestionDetails(suggestion: BookSuggestion): string {
  return [
    suggestion.author,
    suggestion.publisher,
    suggestion.firstPublishYear,
    suggestion.totalPages ? `about ${suggestion.totalPages} pages` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The book title, with a list of Open Library suggestions that appears after a
 * short pause in typing. Choosing one fills in the rest of the form. Follows the
 * combobox pattern: arrows move through the list, Enter picks, Escape closes it.
 */
export function BookTitleField({ value, invalid, errorId, suggest, onChange, onPick }: BookTitleFieldProps) {
  const [results, setResults] = useState<Results>({ status: 'idle' });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [techOnly, setTechOnly] = useState(readTechOnly);
  // A title filled in by picking a suggestion should not start a new search.
  const skipNextSearch = useRef(false);

  useEffect(() => {
    if (!suggest) {
      return;
    }
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    const text = value.trim();
    if (text.length < MIN_LETTERS) {
      setResults({ status: 'idle' });
      setOpen(false);
      return;
    }
    // Only the answer for the latest text is shown; earlier ones are ignored.
    let current = true;
    const timer = setTimeout(() => {
      setResults({ status: 'loading' });
      booksApi.suggest(text, techOnly).then(
        (items) => {
          if (current) {
            setResults({ status: 'loaded', items });
            setActive(-1);
            setOpen(items.length > 0);
          }
        },
        () => {
          if (current) {
            setResults({ status: 'error' });
            setOpen(false);
          }
        },
      );
    }, TYPING_PAUSE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [value, suggest, techOnly]);

  const items = results.status === 'loaded' ? results.items : [];
  const listShown = suggest && open && items.length > 0;

  const pick = (suggestion: BookSuggestion) => {
    skipNextSearch.current = true;
    setOpen(false);
    setActive(-1);
    onPick(suggestion);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && items.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === 'ArrowUp' && listShown) {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && listShown && active >= 0) {
      // Picks the highlighted book instead of submitting the form.
      event.preventDefault();
      pick(items[active]);
    } else if (event.key === 'Escape' && listShown) {
      // Closes only the list, not the dialog around it.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  };

  const hint =
    results.status === 'loading'
      ? 'Looking for matching books…'
      : results.status === 'error'
        ? 'Suggestions are unavailable right now; fill in the details yourself.'
        : results.status === 'loaded' && items.length === 0
          ? 'No matching books found; fill in the details yourself.'
          : `Type ${MIN_LETTERS} or more letters for suggestions from Open Library. What you type is sent to openlibrary.org.`;

  return (
    <div className={form.field}>
      <label className={form.label} htmlFor="book-title">
        Title
      </label>
      <input
        id="book-title"
        className={form.control}
        value={value}
        maxLength={300}
        autoComplete="off"
        role={suggest ? 'combobox' : undefined}
        aria-autocomplete={suggest ? 'list' : undefined}
        aria-expanded={suggest ? listShown : undefined}
        aria-controls={suggest ? 'book-suggestions' : undefined}
        aria-activedescendant={listShown && active >= 0 ? `book-suggestion-${active}` : undefined}
        aria-invalid={invalid}
        aria-describedby={[errorId, suggest ? 'book-title-hint' : null].filter(Boolean).join(' ') || undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(items.length > 0)}
        onBlur={() => setOpen(false)}
      />
      {listShown && (
        <ul id="book-suggestions" role="listbox" aria-label="Suggested books" className={styles.list}>
          {items.map((suggestion, index) => (
            <li
              key={`${suggestion.title}-${suggestion.author}-${index}`}
              id={`book-suggestion-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? `${styles.option} ${styles.active}` : styles.option}
              // Keeps focus in the title field so the list does not close before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(suggestion)}
            >
              {/* Google Books previews load only after a book is picked, so typing sends nothing to Google. */}
              {suggestion.coverId && suggestion.coverSource === 'OPEN_LIBRARY' ? (
                <img
                  className={styles.thumb}
                  src={coverPreviewUrl(suggestion.coverSource, suggestion.coverId)}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <span className={`${styles.thumb} ${styles.noCover}`} aria-hidden="true">
                  {suggestion.title.charAt(0).toUpperCase()}
                </span>
              )}
              <span className={styles.text}>
                <span className={styles.title}>{suggestion.title}</span>
                <span className={styles.details}>{suggestionDetails(suggestion)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {suggest && (
        <div className={styles.footer}>
          <span id="book-title-hint" className={styles.hint} aria-live="polite">
            {hint}
          </span>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={techOnly}
              onChange={(event) => {
                setTechOnly(event.target.checked);
                writeTechOnly(event.target.checked);
              }}
            />
            Tech books only
          </label>
        </div>
      )}
    </div>
  );
}
