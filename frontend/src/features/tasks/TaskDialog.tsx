import { useRef, useState, type FormEvent } from 'react';
import { ApiError, errorMessage, isConflict, tasksApi } from '../../api/client';
import type { Category, Task, TaskActivity, TaskPriority, TaskStatus, UpdateTaskInput } from '../../api/bridge';
import { useLoadable } from '../../app/useLoadable';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { formatShortDate, formatTimestamp, type IsoDate } from '../../lib/dates';
import { PRIORITIES, PRIORITY_NAMES, STATUSES, STATUS_LABELS, categoryName } from './taskLabels';
import form from '../../components/form.module.css';
import styles from './TaskDialog.module.css';

export type TaskEditorTarget =
  | { kind: 'create'; plannedDate: IsoDate | null }
  | { kind: 'edit'; task: Task };

interface TaskDialogProps {
  target: TaskEditorTarget;
  categories: Category[];
  backendReady: boolean;
  onClose: () => void;
  /** Called after any successful change, before the dialog closes. */
  onSaved: () => void;
}

interface FormValues {
  title: string;
  description: string;
  categoryId: string;
  priority: TaskPriority;
  status: TaskStatus;
  plannedDate: string;
  deadlineDate: string;
}

function valuesOf(target: TaskEditorTarget): FormValues {
  if (target.kind === 'create') {
    return {
      title: '',
      description: '',
      categoryId: '',
      priority: 'MEDIUM',
      status: 'PENDING',
      plannedDate: target.plannedDate ?? '',
      deadlineDate: '',
    };
  }
  const { task } = target;
  return {
    title: task.title,
    description: task.description ?? '',
    categoryId: task.categoryId ?? '',
    priority: task.priority,
    status: task.status,
    plannedDate: task.plannedDate ?? '',
    deadlineDate: task.deadlineDate ?? '',
  };
}

function describe(entry: TaskActivity): string {
  const date = (value: string | null) => (value ? formatShortDate(value) : 'unscheduled');
  switch (entry.action) {
    case 'CREATED':
      return 'Created';
    case 'COMPLETED':
      return 'Completed';
    case 'REOPENED':
      return 'Reopened';
    case 'STATUS_CHANGED':
      return entry.previousStatus && entry.newStatus
        ? `Status changed from ${STATUS_LABELS[entry.previousStatus]} to ${STATUS_LABELS[entry.newStatus]}`
        : 'Status changed';
    case 'RESCHEDULED':
      return `Planned date changed from ${date(entry.previousPlannedDate)} to ${date(entry.newPlannedDate)}`;
    case 'ARCHIVED':
      return 'Archived';
    case 'RESTORED':
      return 'Restored from the archive';
    case 'EDITED':
      return 'Details edited';
  }
}

/** Creates a task or edits an existing one, with archive/restore and the task's history. */
export function TaskDialog({ target, categories, backendReady, onClose, onSaved }: TaskDialogProps) {
  // In edit mode this is the version of the task the form was last loaded from.
  const [task, setTask] = useState(target.kind === 'edit' ? target.task : null);
  const [initial, setInitial] = useState(() => valuesOf(target));
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  // The id belongs to this draft, so retrying a create cannot make a duplicate.
  const draftId = useRef(crypto.randomUUID());

  const history = useLoadable(`${task?.id}:${task?.version}`, 0, backendReady && task !== null, () =>
    tasksApi.getActivity(task!.id),
  );

  const dirty = (Object.keys(values) as (keyof FormValues)[]).some((key) => values[key] !== initial[key]);
  const archived = task?.archivedAt != null;
  const busy = saving || !backendReady;

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    if (key === 'title') {
      draftId.current = crypto.randomUUID();
    }
  };

  const fail = (failure: unknown) => {
    if (isConflict(failure) && task) {
      setConflict(true);
      setError('This task was changed after you opened it, so your changes were not saved.');
      return;
    }
    setError(errorMessage(failure));
    if (failure instanceof ApiError) {
      setFieldErrors(Object.fromEntries(failure.fieldErrors.map(({ field, message }) => [field, message])));
    }
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
      fail(failure);
    } finally {
      setSaving(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (values.title.trim() === '') {
      setFieldErrors({ title: 'A title is required.' });
      return;
    }
    if (!task) {
      void run(() =>
        tasksApi.create({
          id: draftId.current,
          title: values.title,
          description: values.description || null,
          categoryId: values.categoryId || null,
          priority: values.priority,
          plannedDate: values.plannedDate || null,
          deadlineDate: values.deadlineDate || null,
        }),
      );
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }
    // Send only what changed, so untouched fields cannot overwrite anything.
    const changes: UpdateTaskInput = { version: task.version };
    if (values.title !== initial.title) changes.title = values.title;
    if (values.description !== initial.description) changes.description = values.description || null;
    if (values.categoryId !== initial.categoryId) changes.categoryId = values.categoryId || null;
    if (values.priority !== initial.priority) changes.priority = values.priority;
    if (values.status !== initial.status) changes.status = values.status;
    if (values.plannedDate !== initial.plannedDate) changes.plannedDate = values.plannedDate || null;
    if (values.deadlineDate !== initial.deadlineDate) changes.deadlineDate = values.deadlineDate || null;
    void run(() => tasksApi.update(task.id, changes));
  };

  const reload = async () => {
    if (!task || busy) {
      return;
    }
    setSaving(true);
    try {
      const latest = await tasksApi.get(task.id);
      const fresh = valuesOf({ kind: 'edit', task: latest });
      setTask(latest);
      setInitial(fresh);
      setValues(fresh);
      setConflict(false);
      setError(null);
      setFieldErrors({});
      onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  // The task's own category stays selectable even if it has been archived since.
  const options = categories.filter((category) => !category.archivedAt || category.id === values.categoryId);

  return (
    <Dialog
      title={task ? 'Edit task' : 'New task'}
      size="large"
      // Escape never throws away typed changes; closing a changed form is explicit.
      onCancel={() => {
        if (!dirty) {
          onClose();
        }
      }}
      actions={
        <>
          {task && (
            <Button
              className={styles.archive}
              disabled={busy || conflict}
              onClick={() => void run(() => tasksApi.update(task.id, { version: task.version, archived: !archived }))}
            >
              {archived ? 'Restore' : 'Archive'}
            </Button>
          )}
          <Button onClick={onClose}>{dirty ? 'Discard changes' : 'Close'}</Button>
          {conflict ? (
            <Button variant="primary" disabled={busy} onClick={() => void reload()}>
              Reload latest
            </Button>
          ) : (
            <Button type="submit" form="task-form" variant="primary" disabled={busy}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
        </>
      }
    >
      <form id="task-form" className={styles.form} onSubmit={save} noValidate>
        <div className={form.field}>
          <label className={form.label} htmlFor="task-title">
            Title
          </label>
          <input
            id="task-title"
            className={form.control}
            value={values.title}
            maxLength={200}
            aria-invalid={fieldErrors.title !== undefined}
            aria-describedby={fieldErrors.title ? 'task-title-error' : undefined}
            onChange={(event) => set('title', event.target.value)}
          />
          {fieldErrors.title && (
            <span id="task-title-error" className={form.error}>
              {fieldErrors.title}
            </span>
          )}
        </div>

        <div className={form.field}>
          <label className={form.label} htmlFor="task-description">
            Description
          </label>
          <textarea
            id="task-description"
            className={form.control}
            value={values.description}
            maxLength={5000}
            onChange={(event) => set('description', event.target.value)}
          />
          {fieldErrors.description && <span className={form.error}>{fieldErrors.description}</span>}
        </div>

        <div className={styles.columns}>
          <div className={form.field}>
            <label className={form.label} htmlFor="task-category">
              Category
            </label>
            <select
              id="task-category"
              className={form.control}
              value={values.categoryId}
              onChange={(event) => set('categoryId', event.target.value)}
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

          <div className={form.field}>
            <label className={form.label} htmlFor="task-priority">
              Priority
            </label>
            <select
              id="task-priority"
              className={form.control}
              value={values.priority}
              onChange={(event) => set('priority', event.target.value as TaskPriority)}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_NAMES[priority]}
                </option>
              ))}
            </select>
          </div>

          <div className={form.field}>
            <label className={form.label} htmlFor="task-planned">
              Planned date (when you intend to work on it)
            </label>
            <input
              id="task-planned"
              type="date"
              className={form.control}
              value={values.plannedDate}
              onChange={(event) => set('plannedDate', event.target.value)}
            />
          </div>

          <div className={form.field}>
            <label className={form.label} htmlFor="task-deadline">
              Deadline (when it must be finished)
            </label>
            <input
              id="task-deadline"
              type="date"
              className={form.control}
              value={values.deadlineDate}
              onChange={(event) => set('deadlineDate', event.target.value)}
            />
          </div>

          {task && (
            <div className={form.field}>
              <label className={form.label} htmlFor="task-status">
                Status
              </label>
              <select
                id="task-status"
                className={form.control}
                value={values.status}
                onChange={(event) => set('status', event.target.value as TaskStatus)}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && (
          <p className={form.error} role="alert">
            {error}
          </p>
        )}
      </form>

      {task && (
        <section className={styles.history} aria-labelledby="task-history-heading">
          <h3 id="task-history-heading">History</h3>
          {task.completedAt && <p>Completed {formatTimestamp(task.completedAt)}</p>}
          {archived && <p>Archived {formatTimestamp(task.archivedAt!)}. It is hidden from normal lists.</p>}
          {history.status === 'loading' && <p>Loading history…</p>}
          {history.status === 'error' && <p className={form.error}>History could not be loaded.</p>}
          {history.status === 'loaded' && (
            <ol className={styles.entries}>
              {history.data.map((entry, index) => (
                <li key={index}>
                  <span>{describe(entry)}</span>
                  <time dateTime={entry.occurredAt}>{formatTimestamp(entry.occurredAt)}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </Dialog>
  );
}
