import { useState } from 'react';
import {
  addMonths,
  dayOfMonth,
  formatLongDate,
  formatMonthTitle,
  formatShortDate,
  isSameMonth,
  monthGrid,
  startOfMonth,
  todayIso,
  weekdayLabels,
  type IsoDate,
  type WeekStart,
} from '../../lib/dates';
import styles from './DatesPicker.module.css';

interface DatesPickerProps {
  /** Chosen dates, in order. */
  dates: IsoDate[];
  weekStart: WeekStart;
  invalid?: boolean;
  onChange: (dates: IsoDate[]) => void;
}

/**
 * A month where each date is pressed to choose it and pressed again to drop it,
 * for an appointment on chosen dates. The arrows move between months; the chosen
 * dates are listed below, each with a button to remove it.
 */
export function DatesPicker({ dates, weekStart, invalid = false, onChange }: DatesPickerProps) {
  const [month, setMonth] = useState(() => startOfMonth(dates[0] ?? todayIso()));
  const chosen = new Set(dates);
  const grid = monthGrid(month, weekStart);
  const weeks = Array.from({ length: 6 }, (_, week) => grid.slice(week * 7, week * 7 + 7));

  const toggle = (date: IsoDate) =>
    onChange(chosen.has(date) ? dates.filter((other) => other !== date) : [...dates, date].sort());

  return (
    <div className={styles.picker} role="group" aria-label="Dates of the appointment" aria-invalid={invalid}>
      <div className={styles.header}>
        <button type="button" className={styles.arrow} aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
          ‹
        </button>
        <span className={styles.title} aria-live="polite">
          {formatMonthTitle(month)}
        </span>
        <button type="button" className={styles.arrow} aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          ›
        </button>
      </div>
      <table className={styles.table}>
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
              {week.map((date) => (
                <td key={date}>
                  <button
                    type="button"
                    className={[styles.date, !isSameMonth(date, month) && styles.outside, chosen.has(date) && styles.chosen]
                      .filter(Boolean)
                      .join(' ')}
                    aria-pressed={chosen.has(date)}
                    aria-label={formatLongDate(date)}
                    onClick={() => toggle(date)}
                  >
                    {dayOfMonth(date)}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {dates.length > 0 ? (
        <ul className={styles.chosenList} aria-label="Chosen dates">
          {dates.map((date) => (
            <li key={date} className={styles.chip}>
              {formatShortDate(date)}
              <button type="button" className={styles.remove} aria-label={`Remove ${formatLongDate(date)}`} onClick={() => toggle(date)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>Press the dates the appointment is on.</p>
      )}
    </div>
  );
}
