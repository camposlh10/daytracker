import { useEffect, useState } from 'react';
import { holidaysApi } from '../../api/client';
import type { CalendarItem, Holiday } from '../../api/bridge';
import type { IsoDate } from '../../lib/dates';

/** A public holiday shown on the calendar alongside the stored items. */
export interface HolidayItem {
  type: 'HOLIDAY';
  id: string;
  date: IsoDate;
  /** In English. */
  title: string;
  /** In the country's own language. */
  localName: string;
}

/** What a calendar date shows: the stored items and any holiday. */
export type DayItem = CalendarItem | HolidayItem;

export function holidayItem(holiday: Holiday): HolidayItem {
  return {
    type: 'HOLIDAY',
    id: `holiday-${holiday.date}-${holiday.name}`,
    date: holiday.date,
    title: holiday.name,
    localName: holiday.localName,
  };
}

// Lists already asked for, by year, shared by every calendar on screen.
const byYear = new Map<number, Promise<Holiday[]>>();

/** For tests: forget the lists already loaded. */
export function forgetHolidays(): void {
  byYear.clear();
}

function yearList(year: number): Promise<Holiday[]> {
  let list = byYear.get(year);
  if (!list) {
    // Without holidays the calendar still works: a failure shows none and is tried again later.
    list = holidaysApi.list(year).catch(() => {
      byYear.delete(year);
      return [];
    });
    byYear.set(year, list);
  }
  return list;
}

/** The holidays on the given dates, by date. */
export function useHolidays(dates: IsoDate[]): Map<IsoDate, Holiday[]> {
  const [holidays, setHolidays] = useState<Map<IsoDate, Holiday[]>>(() => new Map());
  const first = dates[0];
  const last = dates[dates.length - 1];

  useEffect(() => {
    if (!first || !last) {
      return;
    }
    let live = true;
    const years = Array.from(
      { length: Number(last.slice(0, 4)) - Number(first.slice(0, 4)) + 1 },
      (_, index) => Number(first.slice(0, 4)) + index,
    );
    void Promise.all(years.map(yearList)).then((lists) => {
      if (!live) return;
      const shown = new Map<IsoDate, Holiday[]>();
      for (const holiday of lists.flat()) {
        if (holiday.date >= first && holiday.date <= last) {
          shown.set(holiday.date, [...(shown.get(holiday.date) ?? []), holiday]);
        }
      }
      setHolidays(shown);
    });
    return () => {
      live = false;
    };
  }, [first, last]);

  return holidays;
}
