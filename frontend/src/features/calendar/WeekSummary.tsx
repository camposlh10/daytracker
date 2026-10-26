import type { CalendarRange, Progress } from '../../api/bridge';
import type { Loadable } from '../../app/useLoadable';
import { formatDateRange, type IsoDate } from '../../lib/dates';
import styles from './WeekSummary.module.css';

interface WeekSummaryProps {
  /** First and last date of the week containing the selected date. */
  first: IsoDate;
  last: IsoDate;
  week: Loadable<CalendarRange>;
  progress: Loadable<Progress>;
}

function planned(week: CalendarRange): number {
  return week.items.filter((item) => item.type === 'TASK').length;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/**
 * Compact totals for the selected date's week, computed from saved records.
 * "Planned" counts tasks planned on a date in the week; "completed" counts
 * tasks finished during the week, whenever they were planned; pages are those
 * of reading sessions dated in the week.
 */
export function WeekSummary({ first, last, week, progress }: WeekSummaryProps) {
  const failure = week.status === 'error' ? week.message : progress.status === 'error' ? progress.message : null;

  return (
    <section className={styles.summary} aria-label="Week summary">
      <h2 className={styles.range}>Week of {formatDateRange(first, last)}</h2>
      {failure !== null ? (
        <p className={styles.error} role="alert">
          The week summary could not be loaded: {failure}
        </p>
      ) : week.status !== 'loaded' || progress.status !== 'loaded' ? (
        <p className={styles.muted}>Loading…</p>
      ) : planned(week.data) === 0 && progress.data.tasksCompleted === 0 && progress.data.pagesRead === 0 ? (
        <p className={styles.muted}>No activity recorded</p>
      ) : (
        <p className={styles.totals}>
          <span>{plural(planned(week.data), 'task')} planned</span>
          <span>{plural(progress.data.tasksCompleted, 'task')} completed</span>
          <span>
            {plural(progress.data.pagesRead, 'page')} read on {plural(progress.data.readingDays, 'day')}
          </span>
        </p>
      )}
    </section>
  );
}
