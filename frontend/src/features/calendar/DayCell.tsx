import { dayOfMonth, formatLongDate, type IsoDate } from '../../lib/dates';
import { CalendarItemLabel } from './CalendarItemLabel';
import type { DayItem } from './holidays';
import styles from './MonthGrid.module.css';

/** Month cells never list more than this; short windows show fewer. */
export const MAX_VISIBLE_ITEMS = 3;
export const COMPACT_VISIBLE_ITEMS = 2;

interface DayCellProps {
  date: IsoDate;
  items: DayItem[];
  maxVisible: number;
  inMonth: boolean;
  isToday: boolean;
  /** Before today: shown in the quieter past-day colors. */
  isPast: boolean;
  isSelected: boolean;
  /** Exactly one day in the grid is in the tab order; arrows move between days. */
  tabbable: boolean;
  onSelect: (date: IsoDate) => void;
}

export function itemCountLabel(count: number): string {
  if (count === 0) {
    return 'no items';
  }
  return count === 1 ? '1 item' : `${count} items`;
}

export function DayCell({ date, items, maxVisible, inMonth, isToday, isPast, isSelected, tabbable, onSelect }: DayCellProps) {
  const visible = items.slice(0, maxVisible);
  const hidden = items.length - visible.length;
  const classes = [styles.cell, !inMonth && styles.outside, isPast && styles.past, isSelected && styles.selected]
    .filter(Boolean)
    .join(' ');

  return (
    // Clicking anywhere in the cell, including "+N more", selects the day; the
    // full list is shown in the selected-day panel rather than growing the grid.
    <div role="gridcell" aria-selected={isSelected} className={classes} onClick={() => onSelect(date)}>
      <button
        type="button"
        className={styles.day}
        data-date={date}
        tabIndex={tabbable ? 0 : -1}
        aria-current={isToday ? 'date' : undefined}
        aria-label={`${formatLongDate(date)}${isToday ? ', today' : ''}, ${itemCountLabel(items.length)}`}
      >
        <span className={isToday ? `${styles.number} ${styles.today}` : styles.number}>{dayOfMonth(date)}</span>
      </button>
      {visible.length > 0 && (
        <ul className={styles.items}>
          {visible.map((item) => (
            <li key={item.id}>
              <CalendarItemLabel item={item} />
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <button
          type="button"
          className={styles.more}
          tabIndex={-1}
          aria-label={`Show all ${items.length} items for ${formatLongDate(date)}`}
        >
          +{hidden} more
        </button>
      )}
    </div>
  );
}
