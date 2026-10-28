import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { CalendarItem } from '../../api/bridge';
import { useCompactHeight } from '../../app/useCompactHeight';
import {
  dayOfMonth,
  formatDateRange,
  formatHour,
  formatLongDate,
  formatTime,
  formatTimestamp,
  formatWeekday,
  formatZoneOffset,
  localDateOf,
  minutesOfDay,
  type IsoDate,
  type WeekStart,
} from '../../lib/dates';
import { CalendarItemLabel } from './CalendarItemLabel';
import { itemCountLabel } from './DayCell';
import { useGridKeyboard } from './useGridKeyboard';
import styles from './TimeGrid.module.css';

type EventItem = Extract<CalendarItem, { type: 'EVENT' }>;

const DAY_MINUTES = 24 * 60;
/** The shortest an appointment is drawn, so a five-minute one can still be read and clicked. */
const MIN_DRAWN_MINUTES = 20;
/** New appointments start on the half hour that was clicked. */
const SNAP_MINUTES = 30;
const HOUR_HEIGHT = 48;
const COMPACT_HOUR_HEIGHT = 40;
/** Without today on screen, the grid opens at this hour, like a paper planner. */
const DEFAULT_FIRST_HOUR = 7;

interface TimeGridProps {
  /** One date for the day view, seven for the week view. */
  dates: IsoDate[];
  selected: IsoDate;
  today: IsoDate;
  weekStart: WeekStart;
  itemsByDate: Map<IsoDate, CalendarItem[]>;
  onSelect: (date: IsoDate) => boolean;
  /** An empty part of a day was clicked: start a new appointment there. */
  onCreateAt: (date: IsoDate, minutes: number) => void;
  onOpenEvent: (item: EventItem) => void;
}

/** The part of an appointment that falls on one date, in minutes of that day. */
interface Segment {
  item: EventItem;
  start: number;
  end: number;
  /** Side-by-side position among the appointments it overlaps. */
  lane: number;
  lanes: number;
}

const NO_ITEMS: CalendarItem[] = [];

/** Appointments of a day or longer belong with the all-day items, as in a paper planner. */
function isTimed(item: CalendarItem): item is EventItem & { startsAt: string; endsAt: string } {
  if (item.type !== 'EVENT' || item.allDay || !item.startsAt || !item.endsAt) {
    return false;
  }
  return Date.parse(item.endsAt) - Date.parse(item.startsAt) < DAY_MINUTES * 60_000;
}

function segmentOf(item: EventItem & { startsAt: string; endsAt: string }, date: IsoDate) {
  const start = localDateOf(item.startsAt) < date ? 0 : minutesOfDay(item.startsAt);
  const end = localDateOf(item.endsAt) > date ? DAY_MINUTES : minutesOfDay(item.endsAt);
  return { item, start, end: Math.max(end, start) };
}

/**
 * Places overlapping appointments side by side: each group of overlapping ones
 * shares the column width, and each appointment takes the first free lane.
 */
function layOut(items: (EventItem & { startsAt: string; endsAt: string })[], date: IsoDate): Segment[] {
  const pieces = items
    .map((item) => segmentOf(item, date))
    .filter((piece) => piece.end > piece.start || !piece.item.continued)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: Segment[] = [];
  let group: Segment[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const closeGroup = () => {
    for (const segment of group) {
      segment.lanes = laneEnds.length;
    }
    group = [];
    laneEnds = [];
  };
  for (const piece of pieces) {
    const drawnEnd = Math.max(piece.end, piece.start + MIN_DRAWN_MINUTES);
    if (piece.start >= groupEnd) {
      closeGroup();
    }
    let lane = laneEnds.findIndex((end) => end <= piece.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(drawnEnd);
    } else {
      laneEnds[lane] = drawnEnd;
    }
    const segment = { ...piece, lane, lanes: 1 };
    group.push(segment);
    placed.push(segment);
    groupEnd = Math.max(groupEnd, drawnEnd);
  }
  closeGroup();
  return placed;
}

function eventTimes(item: EventItem & { startsAt: string; endsAt: string }): string {
  return localDateOf(item.startsAt) === localDateOf(item.endsAt)
    ? `${formatTime(item.startsAt)} – ${formatTime(item.endsAt)}`
    : `${formatTimestamp(item.startsAt)} – ${formatTimestamp(item.endsAt)}`;
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * The day and week views: a header with each date and its untimed items (tasks,
 * reading, all-day appointments), then the hours of the day with appointments
 * drawn at their times. Clicking an empty hour starts a new appointment there.
 */
export function TimeGrid({
  dates,
  selected,
  today,
  weekStart,
  itemsByDate,
  onSelect,
  onCreateAt,
  onOpenEvent,
}: TimeGridProps) {
  const header = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const compact = useCompactHeight();
  const hourHeight = compact ? COMPACT_HOUR_HEIGHT : HOUR_HEIGHT;
  const onKeyDown = useGridKeyboard(header, selected, weekStart, 'week', onSelect);
  const now = useNow();
  const single = dates.length === 1;
  const tabbableDate = dates.includes(selected) ? selected : dates[0];
  // Untimed items listed per day before "+N more"; the selected-day panel has them all.
  const maxUntimed = single ? 6 : compact ? 2 : 3;

  // Open at the current time when today is shown, otherwise at the start of a working day.
  const showsToday = dates.includes(today);
  useLayoutEffect(() => {
    if (body.current) {
      const firstMinute = showsToday ? Math.max(0, minutesOfDay(new Date()) - 90) : DEFAULT_FIRST_HOUR * 60;
      body.current.scrollTop = (firstMinute / 60) * hourHeight;
    }
    // Only when the grid first appears; afterwards the user's scroll position is kept.
  }, []);

  const createAt = (date: IsoDate, event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    const offset = event.clientY - event.currentTarget.getBoundingClientRect().top;
    const minutes = Math.floor(((offset / hourHeight) * 60) / SNAP_MINUTES) * SNAP_MINUTES;
    onCreateAt(date, Math.min(Math.max(minutes, 0), DAY_MINUTES - SNAP_MINUTES));
  };

  const nowMinutes = minutesOfDay(now);
  const label = single ? formatLongDate(dates[0]) : `Week of ${formatDateRange(dates[0], dates[dates.length - 1])}`;

  return (
    <div className={single ? `${styles.grid} ${styles.single}` : styles.grid} style={{ '--columns': dates.length } as CSSProperties}>
      <div className={styles.head}>
        <div className={styles.zone} aria-hidden="true">
          {formatZoneOffset(now)}
        </div>
        <div ref={header} role="grid" aria-label={label} className={styles.days} onKeyDown={onKeyDown}>
          <div role="row" className={styles.row}>
            {dates.map((date) => {
              const items = itemsByDate.get(date) ?? NO_ITEMS;
              const untimed = items.filter((item) => !isTimed(item));
              const visible = untimed.slice(0, maxUntimed);
              const hidden = untimed.length - visible.length;
              const isToday = date === today;
              const isSelected = date === selected;
              return (
                <div
                  key={date}
                  role="gridcell"
                  aria-selected={isSelected}
                  className={isSelected ? `${styles.dayHead} ${styles.selected}` : styles.dayHead}
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
                    <span className={isToday ? `${styles.weekday} ${styles.todayText}` : styles.weekday}>
                      {formatWeekday(date)}
                    </span>
                    <span className={isToday ? `${styles.number} ${styles.today}` : styles.number}>
                      {dayOfMonth(date)}
                    </span>
                  </button>
                  {visible.length > 0 && (
                    <ul className={styles.untimed}>
                      {visible.map((item) => (
                        <li key={item.id} className={styles.chip} data-type={item.type}>
                          <CalendarItemLabel item={item} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {hidden > 0 && (
                    <button
                      type="button"
                      className={styles.more}
                      tabIndex={-1}
                      aria-label={`Show all ${untimed.length} items for ${formatLongDate(date)}`}
                    >
                      +{hidden} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div ref={body} className={styles.body} data-testid="time-grid">
        <div className={styles.canvas} style={{ height: 24 * hourHeight, '--hour': `${hourHeight}px` } as CSSProperties}>
          <div className={styles.hours} aria-hidden="true">
            {Array.from({ length: 23 }, (_, index) => (
              <span key={index} className={styles.hour} style={{ top: (index + 1) * hourHeight }}>
                {formatHour(index + 1)}
              </span>
            ))}
          </div>
          {dates.map((date) => {
            const timed = (itemsByDate.get(date) ?? NO_ITEMS).filter(isTimed);
            return (
              <div
                key={date}
                className={date === selected ? `${styles.column} ${styles.selectedColumn}` : styles.column}
                data-column={date}
                onClick={(event) => createAt(date, event)}
              >
                {layOut(timed, date).map((segment) => {
                  const height = Math.max(segment.end - segment.start, MIN_DRAWN_MINUTES);
                  const times = eventTimes(segment.item as EventItem & { startsAt: string; endsAt: string });
                  return (
                    <button
                      key={segment.item.id}
                      type="button"
                      tabIndex={-1}
                      className={height < 45 ? `${styles.event} ${styles.short}` : styles.event}
                      style={{
                        top: (segment.start / 60) * hourHeight,
                        height: (height / 60) * hourHeight - 2,
                        left: `calc(${(segment.lane / segment.lanes) * 100}% + 2px)`,
                        width: `calc(${100 / segment.lanes}% - 6px)`,
                      }}
                      aria-label={`${segment.item.title}, ${times}${segment.item.overlapsAnother ? ', overlaps another appointment' : ''}`}
                      title={`${segment.item.title}\n${times}`}
                      onClick={() => onOpenEvent(segment.item)}
                    >
                      <span className={styles.eventTitle}>
                        {segment.item.overlapsAnother && <span aria-hidden="true">⚠ </span>}
                        {segment.item.title}
                      </span>
                      <span className={styles.eventTime}>{times}</span>
                    </button>
                  );
                })}
                {date === today && (
                  <div className={styles.now} style={{ top: (nowMinutes / 60) * hourHeight }} aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
