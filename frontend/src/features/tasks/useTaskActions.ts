import { useState } from 'react';
import { errorMessage, isConflict, tasksApi } from '../../api/client';
import type { Task, UpdateTaskInput } from '../../api/bridge';
import type { IsoDate } from '../../lib/dates';

/**
 * One-click changes to a task from a list: complete, reopen, move, archive,
 * restore. `onChanged` runs after a successful change, and also after a stale
 * version is refused, so the list shows the current state either way.
 */
export function useTaskActions(onChanged: () => void) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = async (task: Task, change: Omit<UpdateTaskInput, 'version'>) => {
    if (busyId) {
      return;
    }
    setBusyId(task.id);
    setError(null);
    try {
      await tasksApi.update(task.id, { version: task.version, ...change });
      onChanged();
    } catch (failure) {
      if (isConflict(failure)) {
        setError(`“${task.title}” had changed, so nothing was saved. The list now shows its current state.`);
        onChanged();
      } else {
        setError(`“${task.title}” was not updated: ${errorMessage(failure)}`);
      }
    } finally {
      setBusyId(null);
    }
  };

  return {
    busyId,
    error,
    /** Completes an unfinished task, or reopens a done one. */
    toggleDone: (task: Task) => apply(task, { status: task.status === 'DONE' ? 'PENDING' : 'DONE' }),
    moveTo: (task: Task, date: IsoDate) => apply(task, { plannedDate: date }),
    setArchived: (task: Task, archived: boolean) => apply(task, { archived }),
  };
}
