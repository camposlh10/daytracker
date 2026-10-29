import type { CalendarEvent } from '../../api/bridge';
import { calendarEvent } from '../../test/fakeBridge';
import { repeatLabel, weekdayOf, weekdaysFrom } from './eventLabels';

describe('repeatLabel', () => {
  const cases: [Partial<CalendarEvent>, string | null][] = [
    [{ repeat: null }, null],
    [{ repeat: 'DAILY' }, 'Every day'],
    [{ repeat: 'DAILY', repeatUntil: '2026-10-31' }, 'Every day until Oct 31, 2026'],
    [{ repeat: 'WEEKLY', repeatWeekdays: ['FRIDAY', 'MONDAY', 'WEDNESDAY'] }, 'Every Mon, Wed and Fri'],
    [{ repeat: 'WEEKLY', repeatWeekdays: ['TUESDAY'], repeatUntil: '2026-12-01' }, 'Every Tue until Dec 1, 2026'],
    [
      { repeat: 'WEEKLY', repeatWeekdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] },
      'Every day',
    ],
    [{ repeat: 'DATES', repeatDates: ['2026-10-06', '2026-10-13'] }, 'On 2 chosen dates'],
  ];

  it.each(cases)('describes %o as %s', (overrides, label) => {
    expect(repeatLabel(calendarEvent(overrides))).toBe(label);
  });

  it('knows the day of a date, and orders the week from its first day', () => {
    expect(weekdayOf('2026-10-09')).toBe('FRIDAY');
    expect(weekdayOf('2026-10-11')).toBe('SUNDAY');
    expect(weekdaysFrom(0)[0]).toBe('SUNDAY');
    expect(weekdaysFrom(1)).toEqual(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']);
  });
});
