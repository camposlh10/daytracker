import type { Book, CalendarEvent, Category, DayDetails, Holiday, ReadingSession, Task } from '../../api/bridge';
import { openLink } from '../../api/client';
import type { Loadable } from '../../app/useLoadable';
import { Button } from '../../components/Button';
import { formatLongDate, type IsoDate } from '../../lib/dates';
import { eventWhen, linkLabel, repeatLabel } from '../events/eventLabels';
import { BookCover } from '../reading/BookCover';
import { CurrentlyReading } from '../reading/CurrentlyReading';
import { pages, sessionSummary } from '../reading/readingLabels';
import { TaskRow } from '../tasks/TaskRow';
import styles from './SelectedDayPanel.module.css';

interface SelectedDayPanelProps {
  date: IsoDate;
  day: Loadable<DayDetails>;
  /** Public holidays on this date. */
  holidays?: Holiday[];
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
  /** Logs reading, of the book on show in the Currently reading carousel when there is one. */
  onLogReading: (bookId?: string) => void;
  /** The book on show in the Currently reading carousel; kept by the calendar so it stays across days. */
  shownBookId: string | null;
  onShowBook: (id: string) => void;
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
  holidays = [],
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
  shownBookId,
  onShowBook,
  onEditSession,
  onDeleteSession,
  onAddEvent,
  onEditEvent,
}: SelectedDayPanelProps) {
  const controlsDisabled = !backendReady || actionBusy;
  const carryOver = day.status === 'loaded' ? day.data.carryOver : [];

  const loaded = day.status === 'loaded';
  const hasTasks = loaded && day.data.tasks.length > 0;
  // The books being read, for the carousel; the one on show stays across days.
  const readingNow = books.filter((book) => book.status === 'READING' && book.archivedAt === null);
  const shownBook = readingNow.find((book) => book.id === shownBookId) ?? readingNow[0];
  const showAgenda = loaded && day.data.events.length > 0;

  return (
    <aside className={styles.panel} aria-label="Selected day">
      <h2 className={styles.srOnly} aria-live="polite">
        {formatLongDate(date)}
      </h2>

      {holidays.map((holiday) => (
        <p key={holiday.name} className={styles.holiday}>
          <span aria-hidden="true">★ </span>
          <span className={styles.srOnly}>Holiday: </span>
          {holiday.name}
          {holiday.localName && holiday.localName !== holiday.name && (
            <span className={styles.holidayLocal}> · {holiday.localName}</span>
          )}
        </p>
      ))}

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

      {/* Reading first: the book being read stays in view; the day's tasks and appointments follow. */}
      <section className={styles.section} aria-labelledby="day-reading-heading">
        <h3 id="day-reading-heading">Reading</h3>
        {/* With no books at all, the reason below already says to add one. */}
        {books.length > 0 && (
          <CurrentlyReading books={readingNow} shownId={shownBook?.id ?? null} onShow={onShowBook} />
        )}
        {day.status === 'loaded' && (
          <>
            <div className={styles.readingLine}>
              <span>
                Read <strong>{day.data.pagesRead}</strong> / {pages(day.data.readingGoal.targetPages)}
              </span>
              {readingBlocked === null && (
                <Button
                  className={styles.logButton}
                  disabled={!backendReady}
                  aria-label="Log reading"
                  onClick={() => onLogReading(shownBook?.id)}
                >
                  + Log
                </Button>
              )}
            </div>
            {/* The bar stops at 100%; the text shows the real figure, including over target. */}
            <progress
              className={styles.bar}
              value={Math.min(day.data.pagesRead, day.data.readingGoal.targetPages)}
              max={day.data.readingGoal.targetPages}
              aria-label="Progress toward this day's reading target"
            />
            {day.data.readingSessions.length > 0 && (
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
        {readingBlocked && <p className={styles.muted}>{readingBlocked}</p>}
      </section>

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
                    {repeatLabel(event) && (
                      <span className={styles.meta}>
                        <span aria-hidden="true">↻ </span>
                        {repeatLabel(event)}
                      </span>
                    )}
                    {event.links.length > 0 && (
                      <span className={styles.links}>
                        {event.links.map((url) => (
                          <a
                            key={url}
                            href={url}
                            className={styles.link}
                            title={url}
                            onClick={(click) => {
                              // The window never leaves the app; the default browser opens it.
                              click.preventDefault();
                              void openLink(url).catch(() => undefined);
                            }}
                          >
                            {linkLabel(url)}
                          </a>
                        ))}
                      </span>
                    )}
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
    </aside>
  );
}
