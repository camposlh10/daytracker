import type { Book, CalendarEvent, Category, DayDetails, ReadingSession, Task } from '../../api/bridge';
import type { Loadable } from '../../app/useLoadable';
import { Button } from '../../components/Button';
import { formatLongDate, type IsoDate } from '../../lib/dates';
import { eventWhen } from '../events/eventLabels';
import { BookCover } from '../reading/BookCover';
import { pages, sessionSummary } from '../reading/readingLabels';
import { TaskRow } from '../tasks/TaskRow';
import styles from './SelectedDayPanel.module.css';

interface SelectedDayPanelProps {
  date: IsoDate;
  day: Loadable<DayDetails>;
  categories: Category[];
  /** Current books, to show each reading session with its cover. */
  books: Book[];
  backendReady: boolean;
  /** True while a one-click task change is being saved. */
  actionBusy: boolean;
  actionError: string | null;
  onToggleDone: (task: Task) => void;
  onOpenTask: (task: Task) => void;
  onMoveToDay: (task: Task) => void;
  /** Why reading cannot be logged for this date right now, or null when it can. */
  readingBlocked: string | null;
  onAddEvent: () => void;
  onEditEvent: (event: CalendarEvent) => void;
  onLogReading: () => void;
  onEditSession: (session: ReadingSession) => void;
  onDeleteSession: (session: ReadingSession) => void;
}

/**
 * What is on the selected date: its tasks and appointments when it has any,
 * unfinished tasks carried over, and reading. The date itself is the calendar's
 * title, so it is only announced, not shown. New tasks, appointments and the
 * daily review come from the calendar's Create menu.
 */
export function SelectedDayPanel({
  date,
  day,
  categories,
  books,
  backendReady,
  actionBusy,
  actionError,
  onToggleDone,
  onOpenTask,
  onMoveToDay,
  readingBlocked,
  onLogReading,
  onEditSession,
  onDeleteSession,
  onAddEvent,
  onEditEvent,
}: SelectedDayPanelProps) {
  const controlsDisabled = !backendReady || actionBusy;
  const carryOver = day.status === 'loaded' ? day.data.carryOver : [];

  const loaded = day.status === 'loaded';
  const hasTasks = loaded && day.data.tasks.length > 0;
  const showAgenda = loaded && day.data.events.length > 0;

  return (
    <aside className={styles.panel} aria-label="Selected day">
      <h2 className={styles.srOnly} aria-live="polite">
        {formatLongDate(date)}
      </h2>

      {actionError && (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      )}

      {day.status === 'loading' && (
        <p className={styles.muted} role="status">
          Loading this day…
        </p>
      )}
      {day.status === 'error' && (
        <p className={styles.error} role="alert">
          This day could not be loaded: {day.message}
        </p>
      )}

      {hasTasks && (
        <section className={styles.section} aria-labelledby="day-tasks-heading">
          <h3 id="day-tasks-heading">Tasks</h3>
          <ul className={styles.tasks} aria-label="Tasks for this day">
            {day.data.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                categories={categories}
                disabled={controlsDisabled}
                onToggleDone={onToggleDone}
                onOpen={onOpenTask}
              />
            ))}
          </ul>
        </section>
      )}

      {carryOver.length > 0 && (
        <section className={styles.section} aria-labelledby="day-carry-over-heading">
          <h3 id="day-carry-over-heading">Carried over</h3>
          <p className={styles.muted}>Unfinished tasks from earlier days. They stay on their original date until moved.</p>
          <ul className={styles.tasks} aria-label="Carried over tasks">
            {carryOver.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                categories={categories}
                disabled={controlsDisabled}
                showPlannedDate
                onToggleDone={onToggleDone}
                onOpen={onOpenTask}
                action={
                  <Button
                    className={styles.move}
                    disabled={controlsDisabled}
                    aria-label={`Move “${task.title}” to this day`}
                    onClick={() => onMoveToDay(task)}
                  >
                    Move here
                  </Button>
                }
              />
            ))}
          </ul>
        </section>
      )}

      {showAgenda && (
        <section className={styles.section} aria-labelledby="day-agenda-heading">
          <h3 id="day-agenda-heading">Agenda</h3>
          {day.status === 'loaded' && (
            <ul className={styles.tasks} aria-label="Appointments for this day">
              {day.data.events.map((event) => (
                <li key={event.id} className={styles.session}>
                  <div className={styles.sessionText}>
                    <span>{event.title}</span>
                    <span className={styles.meta}>{eventWhen(event)}</span>
                    {event.overlapsAnother && (
                      <span className={styles.conflict}>
                        <span aria-hidden="true">⚠ </span>Overlaps another appointment
                      </span>
                    )}
                  </div>
                  <Button
                    className={styles.move}
                    disabled={!backendReady}
                    aria-label={`Edit appointment ${event.title}`}
                    onClick={() => onEditEvent(event)}
                  >
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.row}>
            <Button disabled={!backendReady} onClick={onAddEvent}>
              + Add appointment
            </Button>
          </div>
        </section>
      )}

      <section className={styles.section} aria-labelledby="day-reading-heading">
        <h3 id="day-reading-heading">Reading</h3>
        {day.status === 'loaded' && (
          <>
            <p>
              {day.data.pagesRead} of {pages(day.data.readingGoal.targetPages)} (
              {Math.round((day.data.pagesRead / day.data.readingGoal.targetPages) * 100)}% of the target)
            </p>
            {/* The bar stops at 100%; the text shows the real figure, including over target. */}
            <progress
              className={styles.bar}
              value={Math.min(day.data.pagesRead, day.data.readingGoal.targetPages)}
              max={day.data.readingGoal.targetPages}
              aria-label="Progress toward this day's reading target"
            />
            {day.data.readingSessions.length === 0 ? (
              <p className={styles.muted}>No reading recorded.</p>
            ) : (
              <ul className={styles.tasks} aria-label="Reading sessions for this day">
                {day.data.readingSessions.map((session) => (
                  <li key={session.id} className={styles.session}>
                    {books.some((book) => book.id === session.bookId) && (
                      <BookCover book={books.find((book) => book.id === session.bookId)!} size="small" />
                    )}
                    <div className={styles.sessionText}>
                      <span>{session.bookTitle}</span>
                      <span className={styles.meta}>{sessionSummary(session)}</span>
                    </div>
                    <Button
                      className={styles.move}
                      disabled={!backendReady}
                      aria-label={`Edit reading of ${session.bookTitle}, ${pages(session.pagesRead)}`}
                      onClick={() => onEditSession(session)}
                    >
                      Edit
                    </Button>
                    <Button
                      className={styles.move}
                      disabled={!backendReady}
                      aria-label={`Delete reading of ${session.bookTitle}, ${pages(session.pagesRead)}`}
                      onClick={() => onDeleteSession(session)}
                    >
                      Delete
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className={styles.row}>
          <Button disabled={!backendReady || readingBlocked !== null} onClick={onLogReading}>
            Log reading
          </Button>
        </div>
        {readingBlocked && <p className={styles.muted}>{readingBlocked}</p>}
      </section>

    </aside>
  );
}
