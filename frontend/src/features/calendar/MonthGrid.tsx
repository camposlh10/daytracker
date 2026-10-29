import { useRef } from 'react';
import type { DayItem } from './holidays';
import {
  formatMonthTitle,
  isSameMonth,
  monthGrid,
  startOfMonth,
  weekdayLabels,
  type IsoDate,
  type WeekStart,
} from '../../lib/dates';
import { useCompactHeight } from '../../app/useCompactHeight';
import { COMPACT_VISIBLE_ITEMS, DayCell, MAX_VISIBLE_ITEMS } from './DayCell';
import { useGridKeyboard } from './useGridKeyboard';
import styles from './MonthGrid.module.css';

interface MonthGridProps {
  /** Any date in the month to show. */
  anchor: IsoDate;
  selected: IsoDate;
  today: IsoDate;
  weekStart: WeekStart;
  itemsByDate: Map<IsoDate, DayItem[]>;
  onSelect: (date: IsoDate) => boolean;
}

const NO_ITEMS: DayItem[] = [];

/** Seven columns and a fixed six-week grid, including neighboring-month dates. */
export function MonthGrid({ anchor, selected, today, weekStart, itemsByDate, onSelect }: MonthGridProps) {
  const grid = useRef<HTMLDivElement>(null);
  const onKeyDown = useGridKeyboard(grid, selected, weekStart, 'month', onSelect);
  const compact = useCompactHeight();
  const dates = monthGrid(anchor, weekStart);
  const tabbableDate = dates.includes(selected) ? selected : startOfMonth(anchor);
  const weeks = Array.from({ length: dates.length / 7 }, (_, week) => dates.slice(week * 7, week * 7 + 7));

  return (
    <div
      ref={grid}
      role="grid"
      aria-label={formatMonthTitle(anchor)}
      className={compact ? `${styles.month} ${styles.compact}` : styles.month}
      onKeyDown={onKeyDown}
    >
      <div role="row" className={styles.weekdays}>
        {weekdayLabels(weekStart).map((label) => (
          <div key={label} role="columnheader" className={styles.weekday}>
            {label}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} role="row" className={styles.week}>
          {week.map((date) => (
            <DayCell
              key={date}
              date={date}
              items={itemsByDate.get(date) ?? NO_ITEMS}
              maxVisible={compact ? COMPACT_VISIBLE_ITEMS : MAX_VISIBLE_ITEMS}
              inMonth={isSameMonth(date, anchor)}
              isToday={date === today}
              isPast={date < today}
              isSelected={date === selected}
              tabbable={date === tabbableDate}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
