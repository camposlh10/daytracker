import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  addDays,
  addMonths,
  dayOfMonth,
  formatLongDate,
  formatMonthTitle,
  isSameMonth,
  monthGrid,
  startOfMonth,
  startOfWeek,
  weekdayLabels,
  type IsoDate,
  type WeekStart,
} from '../../lib/dates';
import styles from './MiniMonth.module.css';

interface MiniMonthProps {
  selected: IsoDate;
  today: IsoDate;
  weekStart: WeekStart;
  /** The dates the main calendar shows, highlighted here. */
  visible: IsoDate[];
  onSelect: (date: IsoDate) => boolean;
}

/**
 * A small month for jumping to a date, beside the main calendar. Its arrows browse
 * months without changing the main calendar; choosing a day selects it there.
 * It is one tab stop: the arrow keys move between days, Enter chooses one.
 */
export function MiniMonth({ selected, today, weekStart, visible, onSelect }: MiniMonthProps) {
  const [month, setMonth] = useState(() => startOfMonth(selected));
  const [focusDate, setFocusDate] = useState(selected);
  const moved = useRef(false);
  const table = useRef<HTMLTableElement>(null);

  // Follow the main calendar when its selection changes.
  useEffect(() => {
    setMonth(startOfMonth(selected));
    setFocusDate(selected);
  }, [selected]);

  useEffect(() => {
    if (moved.current) {
      moved.current = false;
      table.current?.querySelector<HTMLElement>(`[data-mini="${focusDate}"]`)?.focus();
    }
  }, [focusDate]);

  const dates = monthGrid(month, weekStart);
  const tabbable = dates.includes(focusDate) && isSameMonth(focusDate, month) ? focusDate : startOfMonth(month);
  const weeks = Array.from({ length: 6 }, (_, week) => dates.slice(week * 7, week * 7 + 7));

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const date = (event.target as HTMLElement).dataset?.mini;
    if (!date) {
      return;
    }
    const steps: Record<string, IsoDate> = {
      ArrowLeft: addDays(date, -1),
      ArrowRight: addDays(date, 1),
      ArrowUp: addDays(date, -7),
      ArrowDown: addDays(date, 7),
      Home: startOfWeek(date, weekStart),
      End: addDays(startOfWeek(date, weekStart), 6),
      PageUp: addMonths(date, -1),
      PageDown: addMonths(date, 1),
    };
    const next = steps[event.key];
    if (!next) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    moved.current = true;
    setMonth(startOfMonth(next));
    setFocusDate(next);
  };

  return (
    <section className={styles.mini} aria-label="Choose a date">
      <div className={styles.header}>
        <h2 className={styles.title} aria-live="polite">
          {formatMonthTitle(month)}
        </h2>
        <button
          type="button"
          className={styles.arrow}
          aria-label="Show the previous month here"
          onClick={() => setMonth(addMonths(month, -1))}
        >
          ‹
        </button>
        <button
          type="button"
          className={styles.arrow}
          aria-label="Show the next month here"
          onClick={() => setMonth(addMonths(month, 1))}
        >
          ›
        </button>
      </div>
      <table ref={table} className={styles.table} onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {weekdayLabels(weekStart).map((label) => (
              <th key={label} scope="col" abbr={label}>
                {label.slice(0, 1)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((date) => {
                const classes = [
                  styles.date,
                  !isSameMonth(date, month) && styles.outside,
                  visible.includes(date) && styles.inView,
                  date === selected && styles.selected,
                  date === today && styles.today,
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <td key={date}>
                    <button
                      type="button"
                      className={classes}
                      data-mini={date}
                      tabIndex={date === tabbable ? 0 : -1}
                      aria-current={date === today ? 'date' : undefined}
                      aria-pressed={date === selected}
                      aria-label={`Go to ${formatLongDate(date)}`}
                      onClick={() => {
                        setFocusDate(date);
                        onSelect(date);
                      }}
                    >
                      {dayOfMonth(date)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
