import type { CalendarEvent, Weekday } from '../../api/bridge';
import {
  addDays,
  formatDateRange,
  formatShortDate,
  displayTimeZone,
  formatTime,
  formatWeekday,
  localDateOf,
  type IsoDate,
  type WeekStart,
} from '../../lib/dates';

/** Monday first, as the backend lists them. */
export const WEEKDAYS: Weekday[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

/** The day's short name, such as "Mon"; 2023-01-02 was a Monday. */
export function weekdayName(day: Weekday): string {
  return formatWeekday(addDays('2023-01-02', WEEKDAYS.indexOf(day)));
}

/** The days in the order the week starts with (0 = Sunday). */
export function weekdaysFrom(weekStart: WeekStart): Weekday[] {
  return Array.from({ length: 7 }, (_, index) => WEEKDAYS[(weekStart + index + 6) % 7]);
}

/** Which day of the week a date falls on. */
export function weekdayOf(date: IsoDate): Weekday {
  return WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
}

/** "Mon, Wed and Fri". */
function listDays(days: Weekday[]): string {
  const names = WEEKDAYS.filter((day) => days.includes(day)).map(weekdayName);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
}

/**
 * When an event happens, in this computer's timezone: "All day", "9:00 AM – 10:15 AM",
 * or "Oct 9, 10:00 PM – Oct 10, 2:00 AM" across midnight. An event entered in
 * another zone says so.
 */
export function eventWhen(event: CalendarEvent): string {
  if (event.allDay) {
    const last = addDays(event.endDateExclusive!, -1);
    return last === event.startDate ? 'All day' : `All day, ${formatDateRange(event.startDate!, last)}`;
  }
  const startDay = localDateOf(event.startsAt!);
  const endDay = localDateOf(event.endsAt!);
  const when =
    startDay === endDay
      ? `${formatTime(event.startsAt!)} – ${formatTime(event.endsAt!)}`
      : `${formatShortDate(startDay)}, ${formatTime(event.startsAt!)} – ${formatShortDate(endDay)}, ${formatTime(event.endsAt!)}`;
  return event.timezone && event.timezone !== displayTimeZone() ? `${when} (set in ${event.timezone})` : when;
}

/**
 * How an appointment repeats, or null for a one-off: "Every day", "Every day until
 * Oct 20", "Every Mon, Wed and Fri", "On 3 chosen dates".
 */
export function repeatLabel(event: CalendarEvent): string | null {
  const until = event.repeatUntil ? ` until ${formatShortDate(event.repeatUntil)}` : '';
  if (event.repeat === 'DAILY' || (event.repeat === 'WEEKLY' && event.repeatWeekdays.length === 7)) {
    return `Every day${until}`;
  }
  if (event.repeat === 'WEEKLY') {
    return `Every ${listDays(event.repeatWeekdays)}${until}`;
  }
  if (event.repeat === 'DATES') {
    return `On ${event.repeatDates.length} chosen dates`;
  }
  return null;
}

/** A link's site, for a short label: "meet.google.com". */
export function linkLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
