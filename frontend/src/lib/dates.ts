// Calendar-date helpers. Dates are YYYY-MM-DD strings and all arithmetic is done
// in UTC, so daylight-saving changes in the local timezone can never shift a day.

export type IsoDate = string;
/** 0 = Sunday … 6 = Saturday. */
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The week-start used until the settings have loaded. */
export const DEFAULT_WEEK_START: WeekStart = 1;

export const GRID_WEEKS = 6;

const DAY_MS = 86_400_000;
const LOCALE = 'en-US';

function toUtc(date: IsoDate): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * How instants are shown: in the timezone chosen in the settings, with the chosen
 * clock style. Until the settings load, this computer's timezone and the locale default.
 */
export interface DisplayPrefs {
  /** An IANA zone; undefined means this computer's. */
  timeZone?: string;
  hourCycle?: 'h12' | 'h23';
}

let prefs: DisplayPrefs = {};
let dayParts: Intl.DateTimeFormat | null = null;
let timestamp = buildTimestamp();
let clockTime = buildClockTime();
let wallClock: Intl.DateTimeFormat | null = null;
let hourLabel: Intl.DateTimeFormat | null = null;
let zoneLabel: Intl.DateTimeFormat | null = null;

function buildTimestamp(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short', ...prefs });
}

function buildClockTime(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', ...prefs });
}

export function setDisplayPrefs(next: DisplayPrefs): void {
  if (next.timeZone === prefs.timeZone && next.hourCycle === prefs.hourCycle) {
    return;
  }
  prefs = { timeZone: next.timeZone, hourCycle: next.hourCycle };
  dayParts = null;
  wallClock = null;
  hourLabel = null;
  zoneLabel = null;
  timestamp = buildTimestamp();
  clockTime = buildClockTime();
}

/** The timezone instants are shown in: the chosen one, else this computer's. */
export function displayTimeZone(): string {
  return prefs.timeZone ?? systemTimeZone();
}

/** Today's date in the display timezone. */
export function todayIso(now: Date = new Date()): IsoDate {
  if (prefs.timeZone === undefined) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  dayParts ??= new Intl.DateTimeFormat('en-US', {
    timeZone: prefs.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dayParts.formatToParts(now);
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Moves by whole months, keeping the day where possible (Jan 31 + 1 month = Feb 28 or 29). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [year, month, day] = date.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  const newYear = Math.floor(index / 12);
  const newMonth = (((index % 12) + 12) % 12) + 1;
  const newDay = Math.min(day, daysInMonth(newYear, newMonth));
  return `${String(newYear).padStart(4, '0')}-${pad(newMonth)}-${pad(newDay)}`;
}

export function dayOfWeek(date: IsoDate): number {
  return new Date(toUtc(date)).getUTCDay();
}

export function dayOfMonth(date: IsoDate): number {
  return Number(date.slice(8, 10));
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 8)}01`;
}

export function startOfWeek(date: IsoDate, weekStart: WeekStart): IsoDate {
  return addDays(date, -((dayOfWeek(date) - weekStart + 7) % 7));
}

export function isSameMonth(a: IsoDate, b: IsoDate): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** The seven dates of the week containing the given date. */
export function weekDates(date: IsoDate, weekStart: WeekStart): IsoDate[] {
  const start = startOfWeek(date, weekStart);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/**
 * The fixed six-week grid for the month containing the given date, starting on
 * the configured week-start day and including neighboring-month dates.
 */
export function monthGrid(date: IsoDate, weekStart: WeekStart): IsoDate[] {
  const start = startOfWeek(startOfMonth(date), weekStart);
  return Array.from({ length: GRID_WEEKS * 7 }, (_, index) => addDays(start, index));
}

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', ...options });
}

const monthTitle = formatter({ month: 'long', year: 'numeric' });
const longDate = formatter({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = formatter({ month: 'short', day: 'numeric' });
const shortDateWithYear = formatter({ month: 'short', day: 'numeric', year: 'numeric' });
const shortWeekday = formatter({ weekday: 'short' });

/** "October 2026" */
export function formatMonthTitle(date: IsoDate): string {
  return monthTitle.format(toUtc(date));
}

/** "Sunday, October 4, 2026" */
export function formatLongDate(date: IsoDate): string {
  return longDate.format(toUtc(date));
}

/** "Mon" */
export function formatWeekday(date: IsoDate): string {
  return shortWeekday.format(toUtc(date));
}

/** "Sep 28 – Oct 4, 2026", or with both years when the range crosses a year boundary. */
export function formatDateRange(first: IsoDate, last: IsoDate): string {
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  const start = (sameYear ? shortDate : shortDateWithYear).format(toUtc(first));
  return `${start} – ${shortDateWithYear.format(toUtc(last))}`;
}

/** "Oct 4, 2026" */
export function formatShortDate(date: IsoDate): string {
  return shortDateWithYear.format(toUtc(date));
}

/** A stored UTC timestamp shown in the display timezone: "Oct 4, 2026, 9:15 AM". */
export function formatTimestamp(isoTimestamp: string): string {
  return timestamp.format(new Date(isoTimestamp));
}

/** A stored UTC timestamp as a time of day in the display timezone: "9:30 AM". */
export function formatTime(isoTimestamp: string): string {
  return clockTime.format(new Date(isoTimestamp));
}

/** Minutes since midnight of a stored UTC timestamp, on the clock of the display timezone. */
export function minutesOfDay(isoTimestamp: string | Date): number {
  wallClock ??= new Intl.DateTimeFormat('en-US', {
    timeZone: prefs.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = wallClock.formatToParts(typeof isoTimestamp === 'string' ? new Date(isoTimestamp) : isoTimestamp);
  const part = (type: string) => Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
  return (part('hour') % 24) * 60 + part('minute');
}

/** An hour of the day as a time-grid label, in the chosen clock style: "7 AM" or "07:00". */
export function formatHour(hour: number): string {
  hourLabel ??= new Intl.DateTimeFormat(LOCALE, {
    timeZone: 'UTC',
    hour: prefs.hourCycle === 'h23' ? '2-digit' : 'numeric',
    minute: prefs.hourCycle === 'h23' ? '2-digit' : undefined,
    hourCycle: prefs.hourCycle,
  });
  return hourLabel.format(Date.UTC(2023, 0, 1, hour));
}

/** The display timezone's current offset, as shown above a time grid: "GMT-4". */
export function formatZoneOffset(now: Date = new Date()): string {
  zoneLabel ??= new Intl.DateTimeFormat(LOCALE, { timeZone: prefs.timeZone, timeZoneName: 'shortOffset' });
  return zoneLabel.formatToParts(now).find((part) => part.type === 'timeZoneName')?.value ?? '';
}

/** "9:30" for 570 minutes: a time-of-day field value. */
export function timeOfDay(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The calendar date of a stored UTC timestamp in the display timezone. */
export function localDateOf(isoTimestamp: string): IsoDate {
  return todayIso(new Date(isoTimestamp));
}

/** This computer's IANA timezone, such as America/Sao_Paulo. */
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Every IANA timezone the runtime knows, falling back to just this computer's. */
export function timeZones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  return supported ? supported('timeZone') : [systemTimeZone()];
}

/** Column headings for a week starting on the configured day: "Mon", "Tue", … */
export function weekdayLabels(weekStart: WeekStart): string[] {
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, index) => formatWeekday(addDays('2023-01-01', weekStart + index)));
}
