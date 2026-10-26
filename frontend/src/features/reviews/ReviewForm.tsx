import type { FormEvent } from 'react';
import type { DailyReview } from '../../api/bridge';
import { Button } from '../../components/Button';
import { formatTimestamp } from '../../lib/dates';
import form from '../../components/form.module.css';
import styles from './ReviewForm.module.css';

export interface ReviewFields {
  wins: string;
  obstacles: string;
  tomorrowPriority: string;
}

export const EMPTY_REVIEW: ReviewFields = { wins: '', obstacles: '', tomorrowPriority: '' };

const QUESTIONS: { field: keyof ReviewFields; label: string }[] = [
  { field: 'wins', label: 'Wins' },
  { field: 'obstacles', label: 'Obstacles' },
  { field: 'tomorrowPriority', label: "Tomorrow's priority" },
];

interface ReviewFormProps {
  values: ReviewFields;
  /** The saved review, or null before the first save. */
  saved: DailyReview | null;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  /** Why the review cannot be edited right now, or null when it can. */
  blocked: string | null;
  onChange: (field: keyof ReviewFields, value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}

/**
 * The daily reflection. Nothing is saved until Save is pressed; unsaved edits
 * are marked, and leaving the day with them asks first.
 */
export function ReviewForm({ values, saved, dirty, saving, error, blocked, onChange, onSave, onDiscard }: ReviewFormProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave();
  };

  if (blocked) {
    return <p className={styles.muted}>{blocked}</p>;
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-label="Daily review">
      {QUESTIONS.map(({ field, label }) => (
        <div key={field} className={form.field}>
          <label className={form.label} htmlFor={`review-${field}`}>
            {label}
          </label>
          <textarea
            id={`review-${field}`}
            className={`${form.control} ${styles.answer}`}
            value={values[field]}
            maxLength={5000}
            onChange={(event) => onChange(field, event.target.value)}
          />
        </div>
      ))}

      <div className={styles.footer}>
        <span className={dirty ? styles.unsaved : styles.muted} role="status">
          {dirty
            ? 'Unsaved changes'
            : saved
              ? saved.updatedAt === saved.createdAt
                ? `Saved ${formatTimestamp(saved.createdAt)}`
                : `Saved ${formatTimestamp(saved.updatedAt)} (first written ${formatTimestamp(saved.createdAt)})`
              : 'Not written yet'}
        </span>
        <div className={styles.actions}>
          {dirty && (
            <Button className={styles.small} disabled={saving} onClick={onDiscard}>
              Discard
            </Button>
          )}
          <Button type="submit" variant="primary" className={styles.small} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save review'}
          </Button>
        </div>
      </div>

      {error && (
        <p className={form.error} role="alert">
          Not saved: {error}
        </p>
      )}
    </form>
  );
}
