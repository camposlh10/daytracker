import { useState } from 'react';
import { progressApi } from '../../api/client';
import type { Progress } from '../../api/bridge';
import { useLoadable } from '../../app/useLoadable';
import { Button } from '../../components/Button';
import { ErrorState, LoadingState } from '../../components/States';
import {
  addDays,
  addMonths,
  formatDateRange,
  formatLongDate,
  formatMonthTitle,
  formatShortDate,
  formatTimestamp,
  formatWeekday,
  startOfMonth,
  startOfWeek,
  type IsoDate,
  type WeekStart,
} from '../../lib/dates';
import { CoverThumb } from '../reading/CoverThumb';
import { pages } from '../reading/readingLabels';
import form from '../../components/form.module.css';
import styles from './progress.module.css';

type Period = 'day' | 'week' | 'month';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

interface ProgressPageProps {
  today: IsoDate;
  weekStart: WeekStart;
  /** False while the backend is down: reads pause. */
  backendReady: boolean;
  dataVersion?: number;
}

/** The interval [from, to) a period covers around an anchor date. */
function intervalOf(period: Period, anchor: IsoDate, weekStart: WeekStart): { from: IsoDate; to: IsoDate } {
  if (period === 'day') {
    return { from: anchor, to: addDays(anchor, 1) };
  }
  if (period === 'week') {
    const from = startOfWeek(anchor, weekStart);
    return { from, to: addDays(from, 7) };
  }
  const from = startOfMonth(anchor);
  return { from, to: startOfMonth(addMonths(from, 1)) };
}

function titleOf(period: Period, from: IsoDate, to: IsoDate): string {
  if (period === 'day') {
    return formatLongDate(from);
  }
  if (period === 'week') {
    return `Week of ${formatDateRange(from, addDays(to, -1))}`;
  }
  return formatMonthTitle(from);
}

function step(period: Period, anchor: IsoDate, direction: 1 | -1): IsoDate {
  return period === 'month' ? addMonths(anchor, direction) : addDays(anchor, direction * (period === 'week' ? 7 : 1));
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/**
 * Progress for a day, week, or month, computed from the saved records. Rates
 * cover only the days that have begun; a period that has not begun shows what
 * is planned and no rates. There is deliberately no combined score.
 */
export function ProgressPage({ today, weekStart, backendReady, dataVersion = 0 }: ProgressPageProps) {
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState<IsoDate>(today);
  const { from, to } = intervalOf(period, anchor, weekStart);
  const report = useLoadable(`progress:${from}:${to}`, dataVersion, backendReady, () => progressApi.get({ from, to }));

  const isCurrent = from <= today && today < to;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Progress</h1>
        <div className={styles.periods} role="group" aria-label="Period">
          {PERIODS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={styles.period}
              aria-pressed={period === id}
              onClick={() => setPeriod(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className={styles.nav}>
        <Button aria-label={`Previous ${period}`} onClick={() => setAnchor(step(period, anchor, -1))}>
          ←
        </Button>
        <h2 className={styles.title}>{titleOf(period, from, to)}</h2>
        <Button aria-label={`Next ${period}`} onClick={() => setAnchor(step(period, anchor, 1))}>
          →
        </Button>
        <Button disabled={isCurrent} onClick={() => setAnchor(today)}>
          Today
        </Button>
      </div>

      {report.status === 'loading' && <LoadingState label="Loading progress…" />}
      {report.status === 'error' && <ErrorState message={`Progress could not be loaded: ${report.message}`} />}
      {report.status === 'loaded' && <Report data={report.data} period={period} />}
    </div>
  );
}

function Report({ data, period }: { data: Progress; period: Period }) {
  const hasStarted = data.elapsedDays > 0;
  const hasActivity = data.tasksCompleted > 0 || data.pagesRead > 0;
  const targetTotal = data.days.filter((day) => !day.future).reduce((sum, day) => sum + day.targetPages, 0);
  // A period is over only once today is past its last day.
  const inProgress = hasStarted && data.today < data.to;

  return (
    <div className={styles.report}>
      <p className={styles.status}>
        {!hasStarted
          ? 'This period has not started.'
          : inProgress
            ? `In progress: ${data.elapsedDays} of ${plural(data.days.length, 'day')} so far.`
            : 'Complete.'}
        {data.tasksPlanned > 0 && ` ${plural(data.tasksPlanned, 'task')} planned for this ${period}.`}
      </p>

      {!hasStarted && data.tasksPlanned === 0 && <p className={styles.muted}>Nothing planned yet.</p>}
      {hasStarted && !hasActivity && <p className={styles.muted}>No activity recorded</p>}

      {hasActivity && (
        <dl className={styles.cards} aria-label="Totals">
          <div className={styles.card}>
            <dt>Tasks completed</dt>
            <dd>{data.tasksCompleted}</dd>
          </div>
          <div className={styles.card}>
            <dt>Pages read</dt>
            <dd>{data.pagesRead}</dd>
            <dd className={styles.sub}>
              {data.targetPercent === null
                ? ''
                : `${data.targetPercent}% of the ${pages(targetTotal)} target`}
            </dd>
          </div>
          <div className={styles.card}>
            <dt>Reading days</dt>
            <dd>
              {data.readingDays} of {data.elapsedDays}
            </dd>
            <dd className={styles.sub}>
              {data.consistencyPercent === null ? '' : `${data.consistencyPercent}% of the days so far`}
            </dd>
          </div>
        </dl>
      )}

      {period !== 'day' && data.days.length > 0 && (
        <section aria-labelledby="progress-days">
          <h3 id="progress-days">Day by day</h3>
          <ul className={styles.days}>
            {data.days.map((day) => (
              <li key={day.date} className={styles.day}>
                <span className={styles.dayLabel}>
                  {formatWeekday(day.date)} {formatShortDate(day.date)}
                </span>
                {day.future ? (
                  <span className={styles.muted}>Upcoming</span>
                ) : (
                  <>
                    {/* The bar stops at 100%; the figures beside it show the real count and percentage. */}
                    <progress
                      className={styles.bar}
                      value={Math.min(day.pagesRead, day.targetPages)}
                      max={day.targetPages}
                      aria-label={`Reading target on ${formatShortDate(day.date)}`}
                    />
                    <span>
                      {day.pagesRead} of {pages(day.targetPages)} ({day.targetPercent}%)
                    </span>
                    <span className={styles.muted}>{plural(day.tasksCompleted, 'task')} done</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.books.length > 0 && (
        <section aria-labelledby="progress-books">
          <h3 id="progress-books">Books read</h3>
          <ul className={styles.records}>
            {data.books.map((book) => (
              <li key={book.bookId} className={styles.record}>
                <CoverThumb bookId={book.bookId} title={book.title} coverUpdatedAt={book.coverUpdatedAt} />
                <span className={styles.recordTitle}>{book.title}</span>
                <span className={styles.muted}>
                  {pages(book.pagesRead)} in this {period} · now on page {book.currentPage} of {book.totalPages} (
                  {book.positionPercent}%)
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.completedTasks.length > 0 && (
        <section aria-labelledby="progress-tasks">
          <h3 id="progress-tasks">Completed tasks</h3>
          <ul className={styles.records}>
            {data.completedTasks.map((task) => (
              <li key={task.id} className={styles.record}>
                <span className={styles.recordTitle}>{task.title}</span>
                <span className={styles.muted}>
                  {task.completedAt ? `Completed ${formatTimestamp(task.completedAt)}` : ''}
                </span>
              </li>
            ))}
          </ul>
          {data.tasksCompleted > data.completedTasks.length && (
            <p className={form.label}>
              Showing the first {data.completedTasks.length} of {data.tasksCompleted}.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
