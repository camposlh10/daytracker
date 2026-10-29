import type { TaskStatus } from '../../api/bridge';
import { formatTime } from '../../lib/dates';
import { CoverThumb } from '../reading/CoverThumb';
import { pages } from '../reading/readingLabels';
import { PRIORITY_LABELS, STATUS_LABELS } from '../tasks/taskLabels';
import type { DayItem } from './holidays';
import styles from './CalendarItemLabel.module.css';

// Status is carried by the symbol's shape as well as its color.
const STATUS_SYMBOLS: Record<TaskStatus, string> = {
  PENDING: '○',
  IN_PROGRESS: '◐',
  DONE: '✓',
};

export function StatusSymbol({ status }: { status: TaskStatus }) {
  return (
    <span className={`${styles.symbol} ${styles[status]}`} role="img" aria-label={STATUS_LABELS[status]}>
      {STATUS_SYMBOLS[status]}
    </span>
  );
}

/** One compact line for an item inside a calendar cell. */
export function CalendarItemLabel({ item }: { item: DayItem }) {
  if (item.type === 'HOLIDAY') {
    // The country's own name is in the tooltip when it differs.
    return (
      <span
        className={`${styles.item} ${styles.holiday}`}
        title={item.localName && item.localName !== item.title ? `${item.title} (${item.localName})` : item.title}
      >
        <span className={styles.lead} role="img" aria-label="Holiday">
          ★
        </span>
        <span className={styles.title}>{item.title}</span>
      </span>
    );
  }
  if (item.type === 'EVENT') {
    // A timed event shows its start time on its first day; later days of a
    // longer event, and all-day events, show a marker instead.
    const lead = item.continued ? '↳' : item.allDay || !item.startsAt ? '▬' : formatTime(item.startsAt);
    const leadLabel = item.continued ? 'Continues' : item.allDay ? 'All day' : 'Starts at';
    return (
      <span className={styles.item}>
        <span className={`${styles.lead} ${styles.event}`} aria-label={leadLabel}>
          {lead}
        </span>
        {item.overlapsAnother && (
          <span className={styles.conflict} role="img" aria-label="Overlaps another appointment">
            ⚠
          </span>
        )}
        <span className={styles.title}>{item.title}</span>
      </span>
    );
  }
  if (item.type === 'READING') {
    // The book's cover and name; the page count is in the tooltip and read out for screen readers.
    return (
      <span className={`${styles.item} ${styles.readingItem}`} title={`${item.title}: ${pages(item.pagesRead)} read`}>
        <CoverThumb bookId={item.bookId} title={item.title} coverUpdatedAt={item.coverUpdatedAt} />
        <span className={styles.title}>{item.title}</span>
        <span className={styles.srOnly}>, {pages(item.pagesRead)} read</span>
      </span>
    );
  }
  return (
    <span className={styles.item}>
      <StatusSymbol status={item.status} />
      {item.priority === 'HIGH' && (
        <span className={styles.high} role="img" aria-label={PRIORITY_LABELS.HIGH}>
          !
        </span>
      )}
      <span className={item.status === 'DONE' ? `${styles.title} ${styles.done}` : styles.title}>{item.title}</span>
    </span>
  );
}
