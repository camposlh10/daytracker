import { useEffect, useState, type FormEvent, type RefObject } from 'react';
import type { Book, CalendarEvent, Category, DayDetails, ReadingSession, Task } from '../../api/bridge';
import type { Loadable } from '../../app/useLoadable';
import { Button } from '../../components/Button';
import { formatLongDate, type IsoDate } from '../../lib/dates';
import { eventWhen } from '../events/eventLabels';
import { BookCover } from '../reading/BookCover';
import { pages, sessionSummary } from '../reading/readingLabels';
import { ReviewForm, type ReviewFields } from '../reviews/ReviewForm';
import { TaskRow } from '../tasks/TaskRow';
import styles from './SelectedDayPanel.module.css';

interface SelectedDayPanelProps {
  date: IsoDate;
  isToday: boolean;
  day: Loadable<DayDetails>;
  categories: Category[];
  /** Current books, to show each reading session with its cover. */
  books: Book[];
  backendReady: boolean;
  /** True while a one-click task change is being saved. */
  actionBusy: boolean;
  actionError: string | null;
  draftTitle: string;
  saving: boolean;
  saveError: string | null;
  titleInput: RefObject<HTMLInputElement | null>;
  onDraftChange: (title: string) => void;
  onSubmit: () => void;
  onToggleDone: (task: Task) => void;
  onOpenTask: (task: Task) => void;
  onMoveToDay: (task: Task) => void;
  /** Why reading cannot be logged for this date right now, or null when it can. */
  readingBlocked: string | null;
  onAddEvent: () => void;
  onEditEvent: (event: CalendarEvent) => void;
  review: {
    values: ReviewFields;
    dirty: boolean;
    saving: boolean;
    error: string | null;
    /** Why the review cannot be edited right now, or null when it can. */
    blocked: string | null;
    onChange: (field: keyof ReviewFields, value: string) => void;
    onSave: () => void;
    onDiscard: () => void;
  };
  onLogReading: () => void;
  onEditSession: (session: ReadingSession) => void;
  onDeleteSession: (session: ReadingSession) => void;
}

/**
 * Everything about the selected date. Tasks, appointments, and the daily review
 * appear only once there is something in them; until then a "+ Task",
 * "+ Appointment", or "+ Review" button adds the first one. Give the panel a
 * key of the date, so what has been opened is forgotten when the day changes.
 */
export function SelectedDayPanel({
  date,
  isToday,
  day,
  categories,
  books,
  backendReady,
  actionBusy,
  actionError,
  draftTitle,
  saving,
  saveError,
  titleInput,
  onDraftChange,
  onSubmit,
  onToggleDone,
  onOpenTask,
  onMoveToDay,
  readingBlocked,
  onLogReading,
  onEditSession,
  onDeleteSession,
  onAddEvent,
  onEditEvent,
  review,
}: SelectedDayPanelProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  const controlsDisabled = !backendReady || actionBusy;
  const carryOver = day.status === 'loaded' ? day.data.carryOver : [];

  // What the user has opened on this day; the panel is remounted when the day changes.
  const [addingTask, setAddingTask] = useState(false);
  const [writingReview, setWritingReview] = useState(false);
  const loaded = day.status === 'loaded';
  const hasTasks = loaded && day.data.tasks.length > 0;
  const hasEvents = loaded && day.data.events.length > 0;
  const hasReview = loaded && day.data.review !== null;
  const showTasks = hasTasks || addingTask || draftTitle.trim() !== '' || saveError !== null;
  const showAgenda = hasEvents;
  const showReview = review.blocked === null && (hasReview || writingReview || review.dirty || review.error !== null);
  // A review cannot be written for a future day, so no button is offered there.
  const canAddReview = loaded && review.blocked === null && !showReview;

  useEffect(() => {
    if (addingTask) {
      titleInput.current?.focus();
    }
  }, [addingTask, titleInput]);

  useEffect(() => {
    if (writingReview) {
      document.getElementById('review-wins')?.focus();
    }
  }, [writingReview]);

  return (
    <aside className={styles.panel} aria-label="Selected day">
      <header className={styles.header}>
        <h2 aria-live="polite">{formatLongDate(date)}</h2>
        {isToday && <span className={styles.todayBadge}>Today</span>}
      </header>

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

      {loaded && (!showTasks || !showAgenda || canAddReview) && (
        <div className={styles.addBar} role="group" aria-label="Add to this day">
          {!showTasks && (
            <Button disabled={!backendReady} onClick={() => setAddingTask(true)}>
              + Task
            </Button>
          )}
          {!showAgenda && (
            <Button disabled={!backendReady} onClick={onAddEvent}>
              + Appointment
            </Button>
          )}
          {canAddReview && (
            <Button disabled={!backendReady} onClick={() => setWritingReview(true)}>
              + Review
            </Button>
          )}
        </div>
      )}

      {showTasks && (
        <section className={styles.section} aria-labelledby="day-tasks-heading">
          <h3 id="day-tasks-heading">Tasks</h3>
          {hasTasks && (
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
          )}

          <form className={styles.form} onSubmit={submit}>
            <label className={styles.label} htmlFor="day-task-title">
              Add a task for this day
              {draftTitle.trim() !== '' && <span className={styles.unsaved}> · Unsaved</span>}
            </label>
            <div className={styles.row}>
              <input
                ref={titleInput}
                id="day-task-title"
                className={styles.input}
                value={draftTitle}
                maxLength={200}
                placeholder="Task title"
                aria-invalid={saveError !== null}
                aria-describedby={saveError ? 'day-task-error' : undefined}
                onChange={(event) => onDraftChange(event.target.value)}
              />
              <Button type="submit" variant="primary" disabled={saving || !backendReady || draftTitle.trim() === ''}>
                {saving ? 'Saving…' : 'Add'}
              </Button>
            </div>
            {saveError && (
              <p id="day-task-error" className={styles.error} role="alert">
                Not saved: {saveError}
              </p>
            )}
          </form>
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

      {showReview && (
        <section className={styles.section} aria-labelledby="day-review-heading">
          <h3 id="day-review-heading">Daily review</h3>
          <ReviewForm
            values={review.values}
            saved={day.status === 'loaded' ? day.data.review : null}
            dirty={review.dirty}
            saving={review.saving}
            error={review.error}
            blocked={review.blocked}
            onChange={review.onChange}
            onSave={review.onSave}
            onDiscard={review.onDiscard}
          />
        </section>
      )}
    </aside>
  );
}
