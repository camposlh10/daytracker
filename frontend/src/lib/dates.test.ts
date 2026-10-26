import {
  addDays,
  displayTimeZone,
  formatTime,
  formatTimestamp,
  localDateOf,
  setDisplayPrefs,
  addMonths,
  daysInMonth,
  formatDateRange,
  formatLongDate,
  formatMonthTitle,
  monthGrid,
  startOfWeek,
  todayIso,
  weekDates,
  weekdayLabels,
  type WeekStart,
} from './dates';

describe('date arithmetic', () => {
  it('moves across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('is not shifted by daylight-saving changes', () => {
    // US clocks change on 2026-03-08 and 2026-11-01; EU clocks on 2026-03-29 and 2026-10-25.
    for (const date of ['2026-03-07', '2026-03-28', '2026-10-24', '2026-10-31']) {
      expect(addDays(addDays(date, 1), 1)).toBe(addDays(date, 2));
      expect(addDays(addDays(date, 2), -2)).toBe(date);
    }
  });

  it('knows month lengths including leap years', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('adds months across years and clamps the day', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2027-01-15', -1)).toBe('2026-12-15');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-10-31', -13)).toBe('2025-09-30');
  });

  it('reads today from the local calendar, not UTC', () => {
    expect(todayIso(new Date(2026, 9, 4, 23, 59))).toBe('2026-10-04');
    expect(todayIso(new Date(2027, 0, 1, 0, 0))).toBe('2027-01-01');
  });
});

describe('weeks', () => {
  it('starts on the configured day', () => {
    // 2026-10-04 is a Sunday.
    expect(startOfWeek('2026-10-04', 1)).toBe('2026-09-28');
    expect(startOfWeek('2026-10-04', 0)).toBe('2026-10-04');
    expect(startOfWeek('2026-10-05', 1)).toBe('2026-10-05');
    expect(startOfWeek('2026-10-05', 6)).toBe('2026-10-03');
  });

  it('spans a year boundary', () => {
    expect(weekDates('2027-01-01', 1)).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });

  it('labels columns from the week-start day', () => {
    expect(weekdayLabels(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(weekdayLabels(0)[0]).toBe('Sun');
  });
});

describe('month grid', () => {
  it('always has 42 consecutive days starting on the week-start day and containing the whole month', () => {
    for (const weekStart of [0, 1, 6] as WeekStart[]) {
      for (let offset = 0; offset < 60; offset++) {
        const month = addMonths('2024-01-01', offset);
        const grid = monthGrid(month, weekStart);
        expect(grid).toHaveLength(42);
        expect(new Date(`${grid[0]}T00:00:00Z`).getUTCDay()).toBe(weekStart);
        grid.forEach((date, index) => expect(date).toBe(addDays(grid[0], index)));
        const [year, monthNumber] = month.split('-').map(Number);
        expect(grid).toContain(month);
        expect(grid).toContain(`${month.slice(0, 8)}${daysInMonth(year, monthNumber)}`);
      }
    }
  });

  it('shows the right days for December 2026 and January 2027', () => {
    const december = monthGrid('2026-12-10', 1);
    expect(december[0]).toBe('2026-11-30');
    expect(december[41]).toBe('2027-01-10');

    const january = monthGrid('2027-01-20', 1);
    expect(january[0]).toBe('2026-12-28');
    expect(january[4]).toBe('2027-01-01');
    expect(january[41]).toBe('2027-02-07');
  });

  it('handles a February that fits exactly four weeks', () => {
    // February 2027 starts on a Monday and has 28 days.
    const february = monthGrid('2027-02-14', 1);
    expect(february[0]).toBe('2027-02-01');
    expect(february[27]).toBe('2027-02-28');
    expect(february[41]).toBe('2027-03-14');
  });
});

describe('formatting', () => {
  it('formats titles and ranges', () => {
    expect(formatMonthTitle('2026-10-04')).toBe('October 2026');
    expect(formatLongDate('2026-10-04')).toBe('Sunday, October 4, 2026');
    expect(formatDateRange('2026-09-28', '2026-10-04')).toBe('Sep 28 – Oct 4, 2026');
    expect(formatDateRange('2026-12-28', '2027-01-03')).toBe('Dec 28, 2026 – Jan 3, 2027');
  });
});

describe('display preferences', () => {
  // 02:30 UTC on the 25th is still the evening of the 24th in Sao Paulo and already midday in Tokyo.
  const instant = new Date('2026-10-25T02:30:00Z');

  it('decides which day it is from the chosen timezone, not the computer', () => {
    setDisplayPrefs({ timeZone: 'America/Sao_Paulo' });
    expect(todayIso(instant)).toBe('2026-10-24');
    expect(localDateOf(instant.toISOString())).toBe('2026-10-24');

    setDisplayPrefs({ timeZone: 'Asia/Tokyo' });
    expect(todayIso(instant)).toBe('2026-10-25');
    expect(displayTimeZone()).toBe('Asia/Tokyo');
  });

  it('shows times in the chosen timezone and clock style', () => {
    setDisplayPrefs({ timeZone: 'UTC', hourCycle: 'h23' });
    expect(formatTime('2026-10-25T21:30:00Z')).toBe('21:30');
    expect(formatTimestamp('2026-10-25T21:30:00Z')).toContain('21:30');

    setDisplayPrefs({ timeZone: 'UTC', hourCycle: 'h12' });
    expect(formatTime('2026-10-25T21:30:00Z')).toBe('9:30 PM');

    setDisplayPrefs({ timeZone: 'Asia/Tokyo', hourCycle: 'h12' });
    expect(formatTime('2026-10-25T21:30:00Z')).toBe('6:30 AM');
  });

  it('falls back to the computer when nothing is chosen', () => {
    setDisplayPrefs({});
    expect(displayTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(todayIso(instant)).toBe('2026-10-25');
  });
});
