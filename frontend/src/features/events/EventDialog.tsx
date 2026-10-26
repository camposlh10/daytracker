import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiError, errorMessage, eventsApi } from '../../api/client';
import type { CalendarEvent, Category, EventFields } from '../../api/bridge';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { addDays, displayTimeZone, timeZones, type IsoDate } from '../../lib/dates';
import { categoryName } from '../tasks/taskLabels';
import { eventWhen } from './eventLabels';
import form from '../../components/form.module.css';
import styles from './EventDialog.module.css';

export type EventEditorTarget = { kind: 'create'; date: IsoDate } | { kind: 'edit'; event: CalendarEvent };

interface EventDialogProps {
  target: EventEditorTarget;
  categories: Category[];
  backendReady: boolean;
  onClose: () => void;
  /** Called after any successful change. */
  onSaved: () => void;
}

interface FormValues {
  title: string;
  notes: string;
  categoryId: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  /** Inclusive in the form; sent as an exclusive end date for all-day events. */
  endDate: string;
  endTime: string;
  timezone: string;
}

function valuesOf(target: EventEditorTarget): FormValues {
  if (target.kind === 'create') {
    return {
      title: '',
      notes: '',
      categoryId: '',
      allDay: false,
      startDate: target.date,
      startTime: '09:00',
      endDate: target.date,
      endTime: '10:00',
      timezone: displayTimeZone(),
    };
  }
  const { event } = target;
  const common = { title: event.title, notes: event.notes ?? '', categoryId: event.categoryId ?? '' };
  if (event.allDay) {
    return {
      ...common,
      allDay: true,
      startDate: event.startDate!,
      startTime: '09:00',
      endDate: addDays(event.endDateExclusive!, -1),
      endTime: '10:00',
      timezone: displayTimeZone(),
    };
  }
  return {
    ...common,
    allDay: false,
    startDate: event.localStart!.slice(0, 10),
    startTime: event.localStart!.slice(11, 16),
    endDate: event.localEnd!.slice(0, 10),
    endTime: event.localEnd!.slice(11, 16),
    timezone: event.timezone!,
  };
}

function toFields(values: FormValues): EventFields {
  const common = {
    title: values.title,
    notes: values.notes.trim() === '' ? null : values.notes,
    categoryId: values.categoryId || null,
  };
  return values.allDay
    ? { ...common, allDay: true, startDate: values.startDate, endDateExclusive: addDays(values.endDate, 1) }
    : {
        ...common,
        allDay: false,
        start: `${values.startDate}T${values.startTime}`,
        end: `${values.endDate}T${values.endTime}`,
        timezone: values.timezone,
      };
}

/** Creates, edits, or deletes an appointment. Overlapping another one is allowed. */
export function EventDialog({ target, categories, backendReady, onClose, onSaved }: EventDialogProps) {
  const event = target.kind === 'edit' ? target.event : null;
  const [initial] = useState(() => valuesOf(target));
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The id belongs to this draft, so retrying a create cannot make a duplicate.
  const draftId = useRef(crypto.randomUUID());
  const zones = useMemo(() => {
    const all = timeZones();
    return all.includes(values.timezone) ? all : [values.timezone, ...all];
  }, [values.timezone]);

  const dirty = (Object.keys(values) as (keyof FormValues)[]).some((key) => values[key] !== initial[key]);
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
    } else if (!values.endDate) {
      problems.end = 'Choose an end date.';
    } else if (values.allDay) {
      if (values.endDate < values.startDate) {
        problems.end = 'The last day cannot be before the first day.';
      }
    } else if (!values.startTime || !values.endTime) {
      problems.end = 'Choose start and end times.';
    } else if (`${values.endDate}T${values.endTime}` <= `${values.startDate}T${values.startTime}`) {
      problems.end = 'The appointment must end after it starts.';
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
          “{event.title}” ({eventWhen(event)}) will be removed from the calendar.
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

        <div className={styles.columns}>
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

        <div className={styles.columns}>
          {!values.allDay && (
            <div className={form.field}>
              <label className={form.label} htmlFor="event-timezone">
                Timezone of these times
              </label>
              <select
                id="event-timezone"
                className={form.control}
                value={values.timezone}
                onChange={(change) => set('timezone', change.target.value)}
              >
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              {fieldErrors.timezone && <span className={form.error}>{fieldErrors.timezone}</span>}
            </div>
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
        </div>

        <div className={form.field}>
          <label className={form.label} htmlFor="event-notes">
            Notes
          </label>
          <textarea
            id="event-notes"
            className={form.control}
            value={values.notes}
            maxLength={5000}
            onChange={(change) => set('notes', change.target.value)}
          />
          {fieldErrors.notes && <span className={form.error}>{fieldErrors.notes}</span>}
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
