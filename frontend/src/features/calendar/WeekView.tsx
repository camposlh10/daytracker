import { useRef } from 'react';
import type { CalendarItem } from '../../api/bridge';
import {
  dayOfMonth,
  formatDateRange,
  formatLongDate,
  formatWeekday,
  weekDates,
  type IsoDate,
  type WeekStart,
} from '../../lib/dates';
import { CalendarItemLabel } from './CalendarItemLabel';
import { itemCountLabel } from './DayCell';
import { useGridKeyboard } from './useGridKeyboard';
import styles from './WeekView.module.css';

interface WeekViewProps {
  /** Any date in the week to show. */
  anchor: IsoDate;
  selected: IsoDate;
  today: IsoDate;
  weekStart: WeekStart;
  itemsByDate: Map<IsoDate, CalendarItem[]>;
  onSelect: (date: IsoDate) => boolean;
}

/** Seven day columns, each listing everything on that date. */
export function WeekView({ anchor, selected, today, weekStart, itemsByDate, onSelect }: WeekViewProps) {
  const grid = useRef<HTMLDivElement>(null);
  const onKeyDown = useGridKeyboard(grid, selected, weekStart, 'week', onSelect);
  const dates = weekDates(anchor, weekStart);
  const tabbableDate = dates.includes(selected) ? selected : dates[0];

  return (
    <div
      ref={grid}
      role="grid"
      aria-label={`Week of ${formatDateRange(dates[0], dates[6])}`}
      className={styles.week}
      onKeyDown={onKeyDown}
    >
      <div role="row" className={styles.row}>
        {dates.map((date) => {
          const items = itemsByDate.get(date) ?? [];
          const isToday = date === today;
          const isSelected = date === selected;
          return (
            <div
              key={date}
              role="gridcell"
              aria-selected={isSelected}
              className={isSelected ? `${styles.column} ${styles.selected}` : styles.column}
              onClick={() => onSelect(date)}
            >
              <button
                type="button"
                className={styles.day}
                data-date={date}
                tabIndex={date === tabbableDate ? 0 : -1}
                aria-current={isToday ? 'date' : undefined}
                aria-label={`${formatLongDate(date)}${isToday ? ', today' : ''}, ${itemCountLabel(items.length)}`}
              >
                <span className={styles.weekday}>{formatWeekday(date)}</span>
                <span className={isToday ? `${styles.number} ${styles.today}` : styles.number}>
                  {dayOfMonth(date)}
                </span>
              </button>
              {items.length > 0 ? (
                <ul className={styles.items}>
                  {items.map((item) => (
                    <li key={item.id}>
                      <CalendarItemLabel item={item} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>Nothing planned</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
