import { useRef, useState, type FormEvent } from 'react';
import { ApiError, errorMessage, eventsApi } from '../../api/client';
import type { CalendarEvent, Category, EventFields, EventRepeat, Weekday } from '../../api/bridge';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { addDays, DEFAULT_WEEK_START, displayTimeZone, timeOfDay, type IsoDate, type WeekStart } from '../../lib/dates';
import { categoryName } from '../tasks/taskLabels';
import { DatesPicker } from './DatesPicker';
import { eventWhen, repeatLabel, weekdayName, weekdayOf, weekdaysFrom } from './eventLabels';
import form from '../../components/form.module.css';
import styles from './EventDialog.module.css';

export type EventEditorTarget =
  /** startMinutes: where the time grid was clicked; the appointment then lasts an hour. */
  | { kind: 'create'; date: IsoDate; startMinutes?: number }
  | { kind: 'edit'; event: CalendarEvent };

interface EventDialogProps {
  target: EventEditorTarget;
  categories: Category[];
  backendReady: boolean;
  /** For the date picker of an appointment on chosen dates. */
  weekStart?: WeekStart;
  onClose: () => void;
  /** Called after any successful change. */
  onSaved: () => void;
}

const WEB_ADDRESS = /^https?:\/\/[^\s/?#]+\S*$/i;

interface FormValues {
  title: string;
  notes: string;
  categoryId: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  /** False: a timed appointment lasts an hour, an all-day one a single day. */
  hasEnd: boolean;
  /** Inclusive in the form; sent as an exclusive end date for all-day events. */
  endDate: string;
  endTime: string;
  /** Not shown: new appointments use the display timezone, edited ones keep their own. */
  timezone: string;
  /** '' for a one-off. */
  repeat: EventRepeat | '';
  /** Every day or week: the last day, or '' for no end. */
  repeatUntil: string;
  /** On days of the week: which ones. */
  repeatWeekdays: Weekday[];
  /** On chosen dates: all of them, in order; the first is the start date. */
  repeatDates: string[];
  /** Web addresses; empty rows are left out when saving. */
  links: string[];
}

const DEFAULT_MINUTES = 60;

/** An hour after the given start, on the next day when that passes midnight. */
function defaultEnd(date: string, time: string): { endDate: string; endTime: string } {
  // A field cleared while typing: nothing to work from yet.
  if (!date || !time) {
    return { endDate: date, endTime: time };
  }
  const [hours, minutes] = time.split(':').map(Number);
  const end = hours * 60 + minutes + DEFAULT_MINUTES;
  return { endDate: end >= 24 * 60 ? addDays(date, 1) : date, endTime: timeOfDay(end % (24 * 60)) };
}

function valuesOf(target: EventEditorTarget): FormValues {
  if (target.kind === 'create') {
    const start = target.startMinutes ?? 9 * 60;
    return {
      title: '',
      notes: '',
      categoryId: '',
      allDay: false,
      startDate: target.date,
      startTime: timeOfDay(start),
      hasEnd: false,
      ...defaultEnd(target.date, timeOfDay(start)),
      timezone: displayTimeZone(),
      repeat: '',
      repeatUntil: '',
      repeatWeekdays: [],
      repeatDates: [],
      links: [],
    };
  }
  const { event } = target;
  const common = {
    title: event.title,
    notes: event.notes ?? '',
    categoryId: event.categoryId ?? '',
    repeat: event.repeat ?? ('' as const),
    repeatUntil: event.repeat === 'DAILY' || event.repeat === 'WEEKLY' ? (event.repeatUntil ?? '') : '',
    repeatWeekdays: event.repeatWeekdays,
    repeatDates: event.repeatDates,
    links: event.links,
  };
  if (event.allDay) {
    return {
      ...common,
      allDay: true,
      startDate: event.startDate!,
      startTime: '09:00',
      hasEnd: event.endDateExclusive !== addDays(event.startDate!, 1),
      endDate: addDays(event.endDateExclusive!, -1),
      endTime: '10:00',
      timezone: displayTimeZone(),
    };
  }
  const startDate = event.localStart!.slice(0, 10);
  const startTime = event.localStart!.slice(11, 16);
  const endDate = event.localEnd!.slice(0, 10);
  const endTime = event.localEnd!.slice(11, 16);
  const usual = defaultEnd(startDate, startTime);
  return {
    ...common,
    allDay: false,
    startDate,
    startTime,
    hasEnd: endDate !== usual.endDate || endTime !== usual.endTime,
    endDate,
    endTime,
    timezone: event.timezone!,
  };
}

/** The end actually used: the one chosen, or the default when no end is set. */
function effectiveEnd(values: FormValues): { endDate: string; endTime: string } {
  if (values.hasEnd) {
    return { endDate: values.endDate, endTime: values.endTime };
  }
  return values.allDay
    ? { endDate: values.startDate, endTime: values.endTime }
    : defaultEnd(values.startDate, values.startTime);
}

function toFields(values: FormValues): EventFields {
  const { endDate, endTime } = effectiveEnd(values);
  const common = {
    title: values.title,
    notes: values.notes.trim() === '' ? null : values.notes,
    categoryId: values.categoryId || null,
    repeat: values.repeat || null,
    repeatUntil: (values.repeat === 'DAILY' || values.repeat === 'WEEKLY') && values.repeatUntil ? values.repeatUntil : null,
    repeatDates: values.repeat === 'DATES' ? values.repeatDates : [],
    repeatWeekdays: values.repeat === 'WEEKLY' ? values.repeatWeekdays : [],
    links: values.links.map((link) => link.trim()).filter((link) => link !== ''),
  };
  return values.allDay
    ? { ...common, allDay: true, startDate: values.startDate, endDateExclusive: endDate ? addDays(endDate, 1) : '' }
    : {
        ...common,
        allDay: false,
        start: `${values.startDate}T${values.startTime}`,
        end: `${endDate}T${endTime}`,
        timezone: values.timezone,
      };
}

/** Creates, edits, or deletes an appointment. Overlapping another one is allowed. */
export function EventDialog({
  target,
  categories,
  backendReady,
  weekStart = DEFAULT_WEEK_START,
  onClose,
  onSaved,
}: EventDialogProps) {
  const event = target.kind === 'edit' ? target.event : null;
  const [initial] = useState(() => valuesOf(target));
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The id belongs to this draft, so retrying a create cannot make a duplicate.
  const draftId = useRef(crypto.randomUUID());
  // The description stays out of the way until asked for, unless there is one.
  const [describing, setDescribing] = useState(initial.notes !== '');
  // Links stay out of the way too; asking for one adds an empty row, focused to fill in.
  const focusLink = useRef<number | null>(null);

  // Changed when what would be saved differs; a hidden end that was edited does not count.
  const dirty = JSON.stringify(toFields(values)) !== JSON.stringify(toFields(initial));
  const busy = saving || !backendReady;

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((current) => {
      const next = { ...current, [key]: value };
      // Moving the start date carries the end date along when it would end up before it.
      if (key === 'startDate' && typeof value === 'string' && next.endDate < value) {
        next.endDate = value;
      }
      return next;
    });
    draftId.current = crypto.randomUUID();
  };

  const validate = (): Record<string, string> => {
    const problems: Record<string, string> = {};
    if (values.title.trim() === '') {
      problems.title = 'A title is required.';
    }
    if (!values.startDate) {
      problems.start = 'Choose a start date.';
    } else if (!values.allDay && !values.startTime) {
      problems.start = 'Choose a start time.';
    } else if (!values.hasEnd) {
      // The default end always comes after the start.
    } else if (!values.endDate) {
      problems.end = 'Choose an end date.';
    } else if (values.allDay) {
      if (values.endDate < values.startDate) {
        problems.end = 'The last day cannot be before the first day.';
      }
    } else if (!values.endTime) {
      problems.end = 'Choose an end time.';
    } else if (`${values.endDate}T${values.endTime}` <= `${values.startDate}T${values.startTime}`) {
      problems.end = 'The appointment must end after it starts.';
    }
    if (values.repeat === 'DATES' && values.repeatDates.length < 2) {
      problems.repeat = 'Choose at least two dates, or choose Does not repeat.';
    } else if (values.repeat === 'WEEKLY' && values.repeatWeekdays.length === 0) {
      problems.repeat = 'Choose at least one day of the week.';
    } else if ((values.repeat === 'DAILY' || values.repeat === 'WEEKLY') && values.repeatUntil && values.repeatUntil < values.startDate) {
      problems.repeat = 'The last day cannot be before the first.';
    }
    if (values.links.some((link) => link.trim() !== '' && !WEB_ADDRESS.test(link.trim()))) {
      problems.links = 'Links must be web addresses that start with https:// or http://.';
    }
    return problems;
  };

  const run = async (operation: () => Promise<unknown>) => {
    if (busy) {
      return;
    }
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      await operation();
      onSaved();
      onClose();
    } catch (failure) {
      // The form stays open with everything typed still in it.
      setError(errorMessage(failure));
      if (failure instanceof ApiError) {
        setFieldErrors(Object.fromEntries(failure.fieldErrors.map(({ field, message }) => [field, message])));
      }
    } finally {
      setSaving(false);
    }
  };

  const save = (submit: FormEvent) => {
    submit.preventDefault();
    const problems = validate();
    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems);
      return;
    }
    if (!event) {
      void run(() => eventsApi.create({ id: draftId.current, ...toFields(values) }));
    } else if (!dirty) {
      onClose();
    } else {
      void run(() => eventsApi.update(event.id, { version: event.version, ...toFields(values) }));
    }
  };

  const remove = () =>
    run(async () => {
      try {
        await eventsApi.delete(event!.id, event!.version);
      } catch (failure) {
        // Already gone, for example after a retry: the outcome is the same.
        if (!(failure instanceof ApiError && failure.status === 404)) {
          throw failure;
        }
      }
    });

  if (event && confirmingDelete) {
    return (
      <Dialog
        title="Delete this appointment?"
        onCancel={() => setConfirmingDelete(false)}
        actions={
          <>
            <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void remove()}>
              {saving ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p>
          “{event.title}” ({repeatLabel(event) ?? eventWhen(event)}) will be removed from the calendar
          {event.repeat ? ', on every date it repeats' : ''}.
        </p>
        {error && (
          <p className={form.error} role="alert">
            {error}
          </p>
        )}
      </Dialog>
    );
  }

  const options = categories.filter((category) => !category.archivedAt || category.id === values.categoryId);
  const endError = fieldErrors.end ?? fieldErrors.endDateExclusive;
  const repeatError = fieldErrors.repeat ?? fieldErrors.repeatDates ?? fieldErrors.repeatUntil;
  const setLinks = (links: string[]) => set('links', links);
  const addLink = () => {
    focusLink.current = values.links.length;
    setLinks([...values.links, '']);
  };
  const startError = fieldErrors.start ?? fieldErrors.startDate;

  return (
    <Dialog
      title={event ? 'Edit appointment' : 'New appointment'}
      size="large"
      // Escape never throws away typed changes; closing a changed form is explicit.
      onCancel={() => {
        if (!dirty) {
          onClose();
        }
      }}
      actions={
        <>
          {event && (
            <Button className={styles.pushLeft} disabled={busy} onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
          <Button onClick={onClose}>{dirty ? 'Discard changes' : 'Close'}</Button>
          <Button type="submit" form="event-form" variant="primary" disabled={busy}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="event-form" className={styles.form} onSubmit={save} noValidate>
        <div className={form.field}>
          <label className={form.label} htmlFor="event-title">
            Title
          </label>
          <input
            id="event-title"
            className={form.control}
            value={values.title}
            maxLength={200}
            aria-invalid={fieldErrors.title !== undefined}
            onChange={(change) => set('title', change.target.value)}
          />
          {fieldErrors.title && <span className={form.error}>{fieldErrors.title}</span>}
        </div>

        <label className={styles.checkbox}>
          <input type="checkbox" checked={values.allDay} onChange={(change) => set('allDay', change.target.checked)} />
          All day
        </label>

        {event?.repeat && (
          <p className={styles.hint}>
            <span aria-hidden="true">↻ </span>
            {repeatLabel(event)}. Changes apply to every date it repeats on.
          </p>
        )}

        <div className={styles.columns}>
          {values.repeat !== 'DATES' && (
            <div className={form.field}>
              <label className={form.label} htmlFor="event-start-date">
                {values.allDay ? 'First day' : 'Start date'}
              </label>
              <input
                id="event-start-date"
                type="date"
                className={form.control}
                value={values.startDate}
                aria-invalid={startError !== undefined}
                onChange={(change) => set('startDate', change.target.value)}
              />
              {startError && <span className={form.error}>{startError}</span>}
            </div>
          )}
          {!values.allDay && (
            <div className={form.field}>
              <label className={form.label} htmlFor="event-start-time">
                Start time
              </label>
              <input
                id="event-start-time"
                type="time"
                className={form.control}
                value={values.startTime}
                onChange={(change) => set('startTime', change.target.value)}
              />
            </div>
          )}
        </div>

        <div className={styles.option}>
          <label className={styles.switch}>
            <input
              type="checkbox"
              role="switch"
              checked={values.hasEnd}
              aria-describedby={values.hasEnd ? undefined : 'event-end-hint'}
              onChange={(change) => {
                const on = change.target.checked;
                setValues((current) => ({
                  ...current,
                  // Turning the end on starts from the default one.
                  ...(on && !current.hasEnd ? effectiveEnd(current) : {}),
                  hasEnd: on,
                }));
                draftId.current = crypto.randomUUID();
              }}
            />
            {values.allDay ? 'Lasts more than one day' : 'Set an end'}
          </label>
          {!values.hasEnd && (
            <span id="event-end-hint" className={styles.hint}>
              {values.allDay ? 'Otherwise it is just this day.' : 'Otherwise it lasts an hour.'}
            </span>
          )}
        </div>

        {values.hasEnd && (
          <div className={styles.columns}>
            <div className={form.field}>
              <label className={form.label} htmlFor="event-end-date">
                {values.allDay ? 'Last day' : 'End date'}
              </label>
              <input
                id="event-end-date"
                type="date"
                className={form.control}
                value={values.endDate}
                aria-invalid={endError !== undefined}
                onChange={(change) => set('endDate', change.target.value)}
              />
              {endError && <span className={form.error}>{endError}</span>}
            </div>
            {!values.allDay && (
              <div className={form.field}>
                <label className={form.label} htmlFor="event-end-time">
                  End time
                </label>
                <input
                  id="event-end-time"
                  type="time"
                  className={form.control}
                  value={values.endTime}
                  onChange={(change) => set('endTime', change.target.value)}
                />
              </div>
            )}
          </div>
        )}

        <div className={styles.columns}>
          <div className={form.field}>
            <label className={form.label} htmlFor="event-repeat">
              Repeat
            </label>
            <select
              id="event-repeat"
              className={form.control}
              value={values.repeat}
              onChange={(change) => {
                const repeat = change.target.value as FormValues['repeat'];
                setValues((current) => ({
                  ...current,
                  repeat,
                  // Chosen dates, or days, start with the date already in the form.
                  repeatDates:
                    repeat === 'DATES' && current.repeatDates.length === 0 ? [current.startDate] : current.repeatDates,
                  repeatWeekdays:
                    repeat === 'WEEKLY' && current.repeatWeekdays.length === 0 && current.startDate
                      ? [weekdayOf(current.startDate)]
                      : current.repeatWeekdays,
                }));
              }}
            >
              <option value="">Does not repeat</option>
              <option value="DAILY">Every day</option>
              <option value="WEEKLY">On days of the week</option>
              <option value="DATES">On dates I choose</option>
            </select>
          </div>
          {(values.repeat === 'DAILY' || values.repeat === 'WEEKLY') && (
            <div className={form.field}>
              <label className={form.label} htmlFor="event-repeat-until">
                Until (optional)
              </label>
              <input
                id="event-repeat-until"
                type="date"
                className={form.control}
                value={values.repeatUntil}
                min={values.startDate}
                aria-invalid={repeatError !== undefined}
                aria-describedby="event-repeat-hint"
                onChange={(change) => set('repeatUntil', change.target.value)}
              />
              <span id="event-repeat-hint" className={styles.hint}>
                Leave empty to repeat {values.repeat === 'DAILY' ? 'every day' : 'every week'}.
              </span>
            </div>
          )}
        </div>
        {values.repeat === 'WEEKLY' && (
          <div className={styles.weekdays} role="group" aria-label="Days of the week" aria-describedby="event-weekdays-hint">
            {weekdaysFrom(weekStart).map((day) => {
              const on = values.repeatWeekdays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  className={on ? `${styles.weekday} ${styles.weekdayOn}` : styles.weekday}
                  aria-pressed={on}
                  aria-label={day.charAt(0) + day.slice(1).toLowerCase()}
                  onClick={() =>
                    set('repeatWeekdays', on ? values.repeatWeekdays.filter((other) => other !== day) : [...values.repeatWeekdays, day])
                  }
                >
                  {weekdayName(day)}
                </button>
              );
            })}
            <span id="event-weekdays-hint" className={styles.hint}>
              It starts on the first of these days from the start date.
            </span>
          </div>
        )}
        {values.repeat === 'DATES' && (
          <DatesPicker
            dates={values.repeatDates}
            weekStart={weekStart}
            invalid={repeatError !== undefined}
            onChange={(dates) =>
              setValues((current) => ({
                ...current,
                repeatDates: dates,
                // The first chosen date is when it starts.
                ...(dates[0] && dates[0] !== current.startDate
                  ? { startDate: dates[0], ...(current.endDate < dates[0] ? { endDate: dates[0] } : {}) }
                  : {}),
              }))
            }
          />
        )}
        {repeatError && (
          <span className={form.error} role="alert">
            {repeatError}
          </span>
        )}

        <div className={form.field}>
          <label className={form.label} htmlFor="event-category">
            Category
          </label>
          <select
            id="event-category"
            className={form.control}
            value={values.categoryId}
            onChange={(change) => set('categoryId', change.target.value)}
          >
            <option value="">No category</option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryName(category)}
              </option>
            ))}
          </select>
          {fieldErrors.categoryId && <span className={form.error}>{fieldErrors.categoryId}</span>}
        </div>

        {describing ? (
          <div className={form.field}>
            <label className={form.label} htmlFor="event-notes">
              Description (optional)
            </label>
            <textarea
              id="event-notes"
              className={form.control}
              value={values.notes}
              maxLength={5000}
              autoFocus={initial.notes === ''}
              onChange={(change) => set('notes', change.target.value)}
            />
            {fieldErrors.notes && <span className={form.error}>{fieldErrors.notes}</span>}
          </div>
        ) : null}

        {values.links.length > 0 && (
          <fieldset className={styles.linksField}>
            <legend className={form.label}>Links (optional)</legend>
            {values.links.map((link, index) => (
              <div key={index} className={styles.linkRow}>
                <input
                  ref={(input) => {
                    if (input && focusLink.current === index) {
                      focusLink.current = null;
                      input.focus();
                    }
                  }}
                  type="url"
                  className={form.control}
                  value={link}
                  placeholder="https://"
                  maxLength={2000}
                  aria-label={`Link ${index + 1}`}
                  aria-invalid={fieldErrors.links !== undefined && link.trim() !== '' && !WEB_ADDRESS.test(link.trim())}
                  onChange={(change) => setLinks(values.links.map((other, at) => (at === index ? change.target.value : other)))}
                />
                <Button
                  aria-label={`Remove link ${index + 1}`}
                  onClick={() => setLinks(values.links.filter((_, at) => at !== index))}
                >
                  Remove
                </Button>
              </div>
            ))}
            {fieldErrors.links && <span className={form.error}>{fieldErrors.links}</span>}
          </fieldset>
        )}

        <div className={styles.addRow}>
          {!describing && (
            <button type="button" className={styles.addLink} onClick={() => setDescribing(true)}>
              + Add description
            </button>
          )}
          {values.links.length < 10 && (
            <button type="button" className={styles.addLink} onClick={addLink}>
              {values.links.length === 0 ? '+ Add link' : '+ Add another link'}
            </button>
          )}
        </div>

        {error && (
          <p className={form.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
