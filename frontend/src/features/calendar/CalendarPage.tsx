import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { booksApi, calendarApi, errorMessage, eventsApi, isConflict, progressApi, reviewsApi, tasksApi } from '../../api/client';
import type { Book, CalendarItem, Category, DailyReview, ReadingSession } from '../../api/bridge';
import { useLoadable } from '../../app/useLoadable';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { MenuButton, type MenuOption } from '../../components/MenuButton';
import {
  DEFAULT_WEEK_START,
  addDays,
  addMonths,
  formatDateRange,
  formatLongDate,
  formatMonthTitle,
  monthGrid,
  startOfMonth,
  weekDates,
  type IsoDate,
  type WeekStart,
} from '../../lib/dates';
import { EventDialog, type EventEditorTarget } from '../events/EventDialog';
import { DeleteSessionDialog, SessionDialog, type SessionEditorTarget } from '../reading/SessionDialog';
import { EMPTY_REVIEW, type ReviewFields } from '../reviews/ReviewForm';
import { TaskDialog, type TaskEditorTarget } from '../tasks/TaskDialog';
import { useTaskActions } from '../tasks/useTaskActions';
import { MiniMonth } from './MiniMonth';
import { MonthGrid } from './MonthGrid';
import { SelectedDayPanel } from './SelectedDayPanel';
import { WeekSummary } from './WeekSummary';
import { TimeGrid } from './TimeGrid';
import styles from './CalendarPage.module.css';

type CalendarView = 'day' | 'week' | 'month';

// The same letters as other calendar apps.
const VIEW_OPTIONS: MenuOption<CalendarView>[] = [
  { id: 'day', label: 'Day', shortcut: 'D' },
  { id: 'week', label: 'Week', shortcut: 'W' },
  { id: 'month', label: 'Month', shortcut: 'M' },
];

const VIEW_NAMES: Record<CalendarView, string> = { day: 'Day', week: 'Week', month: 'Month' };

type CreateKind = 'task' | 'event';

const CREATE_OPTIONS: MenuOption<CreateKind>[] = [
  { id: 'event', label: 'Appointment', shortcut: 'C' },
  { id: 'task', label: 'Task' },
];

/** Keys that work anywhere on the calendar except while typing or in a dialog. */
const SHORTCUT_KEYS = new Set(['d', 'w', 'm', 't', 'n', 'j', 'p', 'k', 'c']);

const NO_CATEGORIES: Category[] = [];
const NO_BOOKS: Book[] = [];

export interface CalendarPageHandle {
  /** Selects today's date and shows the period containing it. */
  goToToday(): void;
}

interface CalendarPageProps {
  today: IsoDate;
  /** False while the backend is down: reads and writes pause, input is kept. */
  backendReady: boolean;
  categories?: Category[];
  /** Changes when data was modified elsewhere, so the calendar reloads. */
  dataVersion?: number;
  weekStart?: WeekStart;
  /** False while another page is shown, so the calendar's keyboard shortcuts are off. */
  active?: boolean;
  /** Where the small month goes (the app's sidebar); without one it is not shown. */
  sidebarSlot?: HTMLElement | null;
  ref?: Ref<CalendarPageHandle>;
}

/**
 * The main workspace: the calendar in the center (a day, a week, or a month), the
 * selected day beside it, and a summary of the selected day's week below.
 */
export function CalendarPage({
  today,
  backendReady,
  categories = NO_CATEGORIES,
  dataVersion = 0,
  weekStart = DEFAULT_WEEK_START,
  active = true,
  sidebarSlot = null,
  ref,
}: CalendarPageProps) {
  const [view, setView] = useState<CalendarView>('month');
  // The visible period is whichever month or week contains the anchor date.
  // Navigating moves the anchor; the selected date changes only when a day is chosen.
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  const [changes, setChanges] = useState(0);
  const refresh = changes + dataVersion;

  const [draftTitle, setDraftTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The date the user asked for while a draft was unsaved.
  const [pendingDate, setPendingDate] = useState<IsoDate | null>(null);
  // The id belongs to the current draft, so retrying it cannot create a duplicate.
  const draftId = useRef(crypto.randomUUID());
  const titleInput = useRef<HTMLInputElement>(null);
  const [editor, setEditor] = useState<TaskEditorTarget | null>(null);
  const [sessionEditor, setSessionEditor] = useState<SessionEditorTarget | null>(null);
  const [deletingSession, setDeletingSession] = useState<ReadingSession | null>(null);
  const [eventEditor, setEventEditor] = useState<EventEditorTarget | null>(null);
  // The review being edited for the selected day; null while it matches what is saved.
  const [reviewDraft, setReviewDraft] = useState<ReviewFields | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  // The review returned by the last save, used until the reloaded day catches up.
  const [justSaved, setJustSaved] = useState<DailyReview | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const reload = () => setChanges((count) => count + 1);
  const actions = useTaskActions(reload);

  const visibleDates =
    view === 'month' ? monthGrid(anchor, weekStart) : view === 'week' ? weekDates(anchor, weekStart) : [anchor];
  const from = visibleDates[0];
  const to = addDays(visibleDates[visibleDates.length - 1], 1);
  const selectedWeek = weekDates(selected, weekStart);

  const range = useLoadable(`${from}:${to}`, refresh, backendReady, () => calendarApi.getRange({ from, to }));
  const day = useLoadable(selected, refresh, backendReady, () => calendarApi.getDay(selected));
  const week = useLoadable(`week:${selectedWeek[0]}`, refresh, backendReady, () =>
    calendarApi.getRange({ from: selectedWeek[0], to: addDays(selectedWeek[6], 1) }),
  );
  const bookList = useLoadable('books', refresh, backendReady, () => booksApi.list());
  const books = bookList.status === 'loaded' ? bookList.data : NO_BOOKS;
  const weekProgress = useLoadable(`progress:${selectedWeek[0]}`, refresh, backendReady, () =>
    progressApi.get({ from: selectedWeek[0], to: addDays(selectedWeek[6], 1) }),
  );

  const loadedReview = day.status === 'loaded' ? day.data.review : null;
  const savedReview =
    justSaved && justSaved.reviewDate === selected && (!loadedReview || loadedReview.version <= justSaved.version)
      ? justSaved
      : loadedReview;
  const reviewBaseline: ReviewFields = savedReview
    ? { wins: savedReview.wins, obstacles: savedReview.obstacles, tomorrowPriority: savedReview.tomorrowPriority }
    : EMPTY_REVIEW;
  const reviewValues = reviewDraft ?? reviewBaseline;
  const reviewDirty =
    reviewDraft !== null &&
    (reviewDraft.wins !== reviewBaseline.wins ||
      reviewDraft.obstacles !== reviewBaseline.obstacles ||
      reviewDraft.tomorrowPriority !== reviewBaseline.tomorrowPriority);
  const taskDraftDirty = draftTitle.trim() !== '';
  const hasUnsavedChanges = taskDraftDirty || reviewDirty;

  // Closing the window with unsaved edits asks first (the main process shows the question).
  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedChanges]);

  const itemsByDate = useMemo(() => {
    const byDate = new Map<IsoDate, CalendarItem[]>();
    if (range.status === 'loaded') {
      for (const item of range.data.items) {
        const items = byDate.get(item.date);
        if (items) {
          items.push(item);
        } else {
          byDate.set(item.date, [item]);
        }
      }
    }
    return byDate;
  }, [range]);

  const applySelection = (date: IsoDate) => {
    setSelected(date);
    setAnchor(date);
    setSaveError(null);
    setReviewDraft(null);
    setReviewError(null);
  };

  /** Returns false when the change is waiting on the unsaved-draft dialog. */
  const requestSelection = (date: IsoDate): boolean => {
    if (date !== selected && hasUnsavedChanges) {
      setPendingDate(date);
      return false;
    }
    applySelection(date);
    return true;
  };

  useImperativeHandle(ref, () => ({ goToToday: () => void requestSelection(today) }));

  const changeDraft = (title: string) => {
    setDraftTitle(title);
    draftId.current = crypto.randomUUID();
  };

  const saveDraft = async (): Promise<boolean> => {
    if (saving || !backendReady || draftTitle.trim() === '') {
      return false;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await tasksApi.create({ id: draftId.current, title: draftTitle, plannedDate: selected });
      setDraftTitle('');
      draftId.current = crypto.randomUUID();
      reload();
      return true;
    } catch (error) {
      // The typed title stays in the field so nothing is lost.
      setSaveError(errorMessage(error));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const changeReview = (field: keyof ReviewFields, value: string) =>
    setReviewDraft((current) => ({ ...(current ?? reviewBaseline), [field]: value }));

  const saveReview = async (): Promise<boolean> => {
    if (!reviewDirty) {
      return true;
    }
    if (reviewSaving || !backendReady || day.status !== 'loaded') {
      return false;
    }
    setReviewSaving(true);
    setReviewError(null);
    try {
      const saved = await reviewsApi.save(selected, { version: savedReview?.version ?? null, ...reviewValues });
      setJustSaved(saved);
      setReviewDraft(null);
      reload();
      return true;
    } catch (error) {
      // The typed answers stay in the form so nothing is lost.
      setReviewError(
        isConflict(error)
          ? 'this review was changed elsewhere. Copy what you want to keep, then discard to see the saved version.'
          : errorMessage(error),
      );
      return false;
    } finally {
      setReviewSaving(false);
    }
  };

  const discardReview = () => {
    setReviewDraft(null);
    setReviewError(null);
    reload();
  };

  const saveAndLeave = async () => {
    const target = pendingDate;
    const taskSaved = taskDraftDirty ? await saveDraft() : true;
    const reviewSaved = taskSaved ? await saveReview() : false;
    setPendingDate(null);
    if (taskSaved && reviewSaved && target) {
      applySelection(target);
    }
  };

  const discardAndLeave = () => {
    const target = pendingDate;
    setPendingDate(null);
    setDraftTitle('');
    setReviewDraft(null);
    if (target) {
      applySelection(target);
    }
  };

  const step = (direction: 1 | -1) => {
    if (view === 'day') {
      // The day view shows the selected day, so moving a day selects it.
      void requestSelection(addDays(anchor, direction));
    } else {
      setAnchor(view === 'month' ? addMonths(startOfMonth(anchor), direction) : addDays(anchor, 7 * direction));
    }
  };

  const changeView = (next: CalendarView) => {
    // Keep showing the selected date when it is on screen; otherwise keep the period.
    if (visibleDates.includes(selected)) {
      setAnchor(selected);
    } else if (next === 'day') {
      void requestSelection(view === 'month' ? startOfMonth(anchor) : visibleDates[0]);
    }
    setView(next);
  };

  const createEventAt = (date: IsoDate, startMinutes?: number) => {
    if (requestSelection(date)) {
      setEventEditor({ kind: 'create', date, startMinutes });
    }
  };

  const create = (kind: CreateKind) =>
    kind === 'task' ? setEditor({ kind: 'create', plannedDate: selected }) : createEventAt(selected);

  /** An appointment in the time grid was clicked: select its day and open it. */
  const openEvent = async (id: string, date: IsoDate) => {
    if (!requestSelection(date)) {
      return;
    }
    setOpenError(null);
    try {
      const event = (await eventsApi.list({ from: date, to: addDays(date, 1) })).find((found) => found.id === id);
      if (event) {
        setEventEditor({ kind: 'edit', event });
      } else {
        setOpenError('That appointment was removed elsewhere.');
        reload();
      }
    } catch (error) {
      setOpenError(`The appointment could not be opened: ${errorMessage(error)}`);
    }
  };

  // Single-key shortcuts while the calendar is the page on screen.
  const shortcut = useRef<(key: string) => void>(() => undefined);
  shortcut.current = (key) => {
    if (key === 'd' || key === 'w' || key === 'm') {
      changeView(key === 'd' ? 'day' : key === 'w' ? 'week' : 'month');
    } else if (key === 't') {
      void requestSelection(today);
    } else if (key === 'n' || key === 'j') {
      step(1);
    } else if (key === 'p' || key === 'k') {
      step(-1);
    } else if (key === 'c') {
      createEventAt(selected);
    }
  };
  useEffect(() => {
    if (!active) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || !SHORTCUT_KEYS.has(key)) {
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"], [role="menu"]');
      if (typing || document.querySelector('[role="dialog"], dialog[open]')) {
        return;
      }
      event.preventDefault();
      shortcut.current(key);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);

  const readingBlocked =
    selected > today
      ? 'Reading cannot be logged for a future date.'
      : books.length === 0
        ? 'Add a book on the Reading page first.'
        : null;

  const title =
    view === 'month'
      ? formatMonthTitle(anchor)
      : view === 'week'
        ? formatDateRange(visibleDates[0], visibleDates[6])
        : formatLongDate(anchor);
  const period = view;

  return (
    <div className={styles.page}>
      <div className={styles.center}>
        <div className={styles.toolbar}>
          <div className={styles.group}>
            <Button className={styles.todayButton} aria-keyshortcuts="T" onClick={() => void requestSelection(today)}>
              Today
            </Button>
            <button
              type="button"
              className={styles.arrow}
              aria-label={`Previous ${period}`}
              aria-keyshortcuts="P"
              onClick={() => step(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              className={styles.arrow}
              aria-label={`Next ${period}`}
              aria-keyshortcuts="N"
              onClick={() => step(1)}
            >
              ›
            </button>
            <h1 className={styles.title} aria-live="polite">
              {title}
            </h1>
          </div>
          <div className={styles.group}>
            <MenuButton
              label={`${VIEW_NAMES[view]} view: change the calendar view`}
              options={VIEW_OPTIONS}
              checked={view}
              onSelect={changeView}
            >
              {VIEW_NAMES[view]}
            </MenuButton>
            <MenuButton variant="primary" options={CREATE_OPTIONS} onSelect={create}>
              + Create
            </MenuButton>
          </div>
        </div>

        {range.status === 'error' && (
          <p className={styles.error} role="alert">
            The calendar could not be loaded: {range.message}
          </p>
        )}
        {openError && (
          <p className={styles.error} role="alert">
            {openError}
          </p>
        )}

        {view === 'month' ? (
          <MonthGrid
            anchor={anchor}
            selected={selected}
            today={today}
            weekStart={weekStart}
            itemsByDate={itemsByDate}
            onSelect={requestSelection}
          />
        ) : (
          <TimeGrid
            dates={visibleDates}
            selected={selected}
            today={today}
            weekStart={weekStart}
            itemsByDate={itemsByDate}
            onSelect={requestSelection}
            onCreateAt={createEventAt}
            onOpenEvent={(item) => void openEvent(item.id, item.date)}
          />
        )}

        <WeekSummary first={selectedWeek[0]} last={selectedWeek[6]} week={week} progress={weekProgress} />
      </div>

      <SelectedDayPanel
        key={selected}
        date={selected}
        isToday={selected === today}
        day={day}
        categories={categories}
        books={books}
        backendReady={backendReady}
        actionBusy={actions.busyId !== null}
        actionError={actions.error}
        draftTitle={draftTitle}
        saving={saving}
        saveError={saveError}
        titleInput={titleInput}
        onDraftChange={changeDraft}
        onSubmit={() => void saveDraft()}
        onToggleDone={(task) => void actions.toggleDone(task)}
        onOpenTask={(task) => setEditor({ kind: 'edit', task })}
        onMoveToDay={(task) => void actions.moveTo(task, selected)}
        readingBlocked={readingBlocked}
        onLogReading={() => setSessionEditor({ kind: 'create', date: selected })}
        onEditSession={(session) => setSessionEditor({ kind: 'edit', session })}
        onDeleteSession={setDeletingSession}
        onAddEvent={() => setEventEditor({ kind: 'create', date: selected })}
        onEditEvent={(event) => setEventEditor({ kind: 'edit', event })}
        review={{
          values: reviewValues,
          dirty: reviewDirty,
          saving: reviewSaving,
          error: reviewError,
          blocked:
            day.status !== 'loaded'
              ? 'Loading…'
              : selected > today
                ? 'A review can be written for today or an earlier day.'
                : null,
          onChange: changeReview,
          onSave: () => void saveReview(),
          onDiscard: discardReview,
        }}
      />

      {sidebarSlot &&
        createPortal(
          <MiniMonth
            selected={selected}
            today={today}
            weekStart={weekStart}
            visible={view === 'month' ? [] : visibleDates}
            onSelect={requestSelection}
          />,
          sidebarSlot,
        )}

      {eventEditor && (
        <EventDialog
          target={eventEditor}
          categories={categories}
          backendReady={backendReady}
          onClose={() => setEventEditor(null)}
          onSaved={reload}
        />
      )}

      {sessionEditor && (
        <SessionDialog
          target={sessionEditor}
          books={books}
          today={today}
          backendReady={backendReady}
          onClose={() => setSessionEditor(null)}
          onSaved={reload}
        />
      )}
      {deletingSession && (
        <DeleteSessionDialog
          session={deletingSession}
          backendReady={backendReady}
          onClose={() => setDeletingSession(null)}
          onDeleted={reload}
        />
      )}

      {editor && (
        <TaskDialog
          target={editor}
          categories={categories}
          backendReady={backendReady}
          onClose={() => setEditor(null)}
          onSaved={reload}
        />
      )}

      {pendingDate && (
        <Dialog
          title="Unsaved changes"
          onCancel={() => setPendingDate(null)}
          actions={
            <>
              <Button
                variant="primary"
                disabled={saving || reviewSaving || !backendReady}
                onClick={() => void saveAndLeave()}
              >
                {saving || reviewSaving ? 'Saving…' : 'Save'}
              </Button>
              <Button onClick={discardAndLeave}>Discard</Button>
              <Button onClick={() => setPendingDate(null)}>Cancel</Button>
            </>
          }
        >
          <p>{formatLongDate(selected)} has changes that are not saved:</p>
          <ul>
            {taskDraftDirty && <li>a new task, “{draftTitle.trim()}”</li>}
            {reviewDirty && <li>the daily review</li>}
          </ul>
          <p>Save them before moving to {formatLongDate(pendingDate)}?</p>
        </Dialog>
      )}
    </div>
  );
}
