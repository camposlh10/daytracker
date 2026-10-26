import type { CalendarEvent } from '../../api/bridge';
import { addDays, formatDateRange, formatShortDate, displayTimeZone, formatTime, localDateOf } from '../../lib/dates';

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
