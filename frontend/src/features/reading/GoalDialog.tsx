import { useState, type FormEvent } from 'react';
import { errorMessage, readingGoalsApi } from '../../api/client';
import type { EffectiveReadingGoal, ReadingGoal } from '../../api/bridge';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { formatShortDate, type IsoDate } from '../../lib/dates';
import { pages } from './readingLabels';
import form from '../../components/form.module.css';
import styles from './reading.module.css';

interface GoalDialogProps {
  current: EffectiveReadingGoal;
  history: ReadingGoal[];
  today: IsoDate;
  backendReady: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Changes the daily reading target from a chosen date onward; earlier days keep theirs. */
export function GoalDialog({ current, history, today, backendReady, onClose, onSaved }: GoalDialogProps) {
  const [target, setTarget] = useState(String(current.targetPages));
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d+$/.test(target) || Number(target) < 1) {
      setError('Enter a number of pages, at least 1.');
      return;
    }
    if (!effectiveDate) {
      setError('Choose the date the new target starts.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await readingGoalsApi.set(effectiveDate, Number(target));
      onSaved();
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      title="Daily reading target"
      onCancel={onClose}
      actions={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button type="submit" form="goal-form" variant="primary" disabled={saving || !backendReady}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="goal-form" className={styles.form} onSubmit={(event) => void save(event)} noValidate>
        <div className={styles.columns}>
          <div className={form.field}>
            <label className={form.label} htmlFor="goal-target">
              Pages per day
            </label>
            <input
              id="goal-target"
              className={form.control}
              inputMode="numeric"
              value={target}
              onChange={(event) => setTarget(event.target.value.trim())}
            />
          </div>
          <div className={form.field}>
            <label className={form.label} htmlFor="goal-date">
              Starting from
            </label>
            <input
              id="goal-date"
              type="date"
              className={form.control}
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
            />
          </div>
        </div>
        <p className={styles.hint}>Days before the starting date keep the target they had.</p>
        {error && (
          <p className={form.error} role="alert">
            {error}
          </p>
        )}
      </form>

      {history.length > 0 && (
        <section className={styles.history} aria-labelledby="goal-history-heading">
          <h3 id="goal-history-heading">Target history</h3>
          <ul>
            {history.map((goal) => (
              <li key={goal.effectiveDate}>
                {pages(goal.targetPages)} a day from {formatShortDate(goal.effectiveDate)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  );
}
