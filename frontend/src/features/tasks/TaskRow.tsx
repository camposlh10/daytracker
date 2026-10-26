import type { ReactNode } from 'react';
import type { Category, Task } from '../../api/bridge';
import { Swatch } from '../../components/Swatch';
import { formatShortDate } from '../../lib/dates';
import { PRIORITY_LABELS, STATUS_LABELS, categoryName } from './taskLabels';
import styles from './TaskRow.module.css';

interface TaskRowProps {
  task: Task;
  categories: Category[];
  /** Disables the controls, for example while the backend is down or a change is in flight. */
  disabled: boolean;
  /** Show the planned date; lists already grouped by date leave it out. */
  showPlannedDate?: boolean;
  onToggleDone: (task: Task) => void;
  onOpen: (task: Task) => void;
  /** An extra control at the end of the row, such as "Move to this day". */
  action?: ReactNode;
}

// The mark's shape carries the status as well as its color.
const MARKS = { PENDING: '', IN_PROGRESS: '◐', DONE: '✓' } as const;

/** One task in a list: a complete/reopen toggle, the title (opens the editor), and its details. */
export function TaskRow({ task, categories, disabled, showPlannedDate, onToggleDone, onOpen, action }: TaskRowProps) {
  const done = task.status === 'DONE';
  const category = categories.find((candidate) => candidate.id === task.categoryId);
  const details = [STATUS_LABELS[task.status], PRIORITY_LABELS[task.priority]];
  if (showPlannedDate) {
    details.push(task.plannedDate ? `Planned ${formatShortDate(task.plannedDate)}` : 'Unscheduled');
  }
  if (task.deadlineDate) {
    details.push(`Due ${formatShortDate(task.deadlineDate)}`);
  }

  return (
    <li className={styles.row}>
      <button
        type="button"
        className={`${styles.toggle} ${styles[task.status]}`}
        disabled={disabled || task.archivedAt !== null}
        aria-label={done ? `Reopen “${task.title}”` : `Mark “${task.title}” as done`}
        onClick={() => onToggleDone(task)}
      >
        {MARKS[task.status]}
      </button>
      <div className={styles.text}>
        <button
          type="button"
          className={done ? `${styles.title} ${styles.doneTitle}` : styles.title}
          aria-label={`Edit “${task.title}”`}
          onClick={() => onOpen(task)}
        >
          {task.title}
        </button>
        <span className={styles.details}>
          {category && (
            <span className={styles.category}>
              <Swatch color={category.color} />
              {categoryName(category)}
            </span>
          )}
          {details.join(' · ')}
        </span>
      </div>
      {action}
    </li>
  );
}
