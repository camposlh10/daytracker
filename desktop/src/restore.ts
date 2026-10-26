import { dialog, type BrowserWindow } from 'electron';
import { copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { BackendManager } from './backend';
import { clearStaging, describeFileError, fail, prepareStaging, swapInRestoredDatabase } from './restoreSwap';
import type { ApiResult, RestoreResult } from './shared/bridge-types';

/**
 * Restoring a backup, as the user sees it:
 *
 *   choose file -> copy to staging -> backend checks the copy -> user confirms
 *   -> safety backup -> swap the files and restart (see restoreSwap.ts).
 *
 * The file chosen is never opened; only the staged copy is.
 */

const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;

let running = false;

export interface RestoreContext {
  window: BrowserWindow | null;
  backend: BackendManager;
  dataDir: string;
}

const COUNT_LABELS: [string, string, string][] = [
  ['tasks', 'task', 'tasks'],
  ['books', 'book', 'books'],
  ['readingSessions', 'reading session', 'reading sessions'],
  ['appointments', 'appointment', 'appointments'],
  ['reviews', 'daily review', 'daily reviews'],
];

export async function restoreFromBackup(context: RestoreContext): Promise<ApiResult<RestoreResult>> {
  if (running) {
    return fail(409, 'RESTORE_IN_PROGRESS', 'A restore is already running.');
  }
  running = true;
  try {
    return await run(context);
  } finally {
    running = false;
  }
}

async function run({ window, backend, dataDir }: RestoreContext): Promise<ApiResult<RestoreResult>> {
  const options = {
    title: 'Choose a backup to restore',
    properties: ['openFile' as const],
    filters: [{ name: 'Day Tracker backups', extensions: ['db'] }],
  };
  const choice = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  if (choice.canceled || choice.filePaths.length === 0) {
    return fail(0, 'CANCELLED', 'No file was chosen.');
  }
  const source = choice.filePaths[0];
  const stagedName = `staged-${Date.now()}.db`;

  try {
    const info = await stat(source);
    if (!info.isFile() || info.size === 0) {
      return fail(400, 'RESTORE_REJECTED', 'That is not a backup file.');
    }
    if (info.size > MAX_BACKUP_BYTES) {
      return fail(400, 'RESTORE_REJECTED', 'That file is too large to be a Day Tracker backup.');
    }
    const staging = await prepareStaging(dataDir);
    await copyFile(source, path.join(staging, stagedName));
  } catch (error) {
    await clearStaging(dataDir);
    return fail(400, 'FILE_UNREADABLE', describeFileError(error, 'The file could not be read.'));
  }

  const check = await backend.request('POST', '/api/v1/lifecycle/restore/validate', { fileName: stagedName });
  if (!check.ok) {
    await clearStaging(dataDir);
    return check;
  }
  const counts = (check.data as { counts?: Record<string, number> }).counts ?? {};

  const confirmation = {
    type: 'warning' as const,
    buttons: ['Cancel', 'Replace my data'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Restore a backup',
    message: 'Replace your current data with this backup?',
    detail:
      `The backup contains ${describeCounts(counts)}.\n\n` +
      'Everything you have now is saved to a safety backup first, and the data service restarts.',
  };
  const answer = window ? await dialog.showMessageBox(window, confirmation) : await dialog.showMessageBox(confirmation);
  if (answer.response !== 1) {
    await clearStaging(dataDir);
    return fail(0, 'CANCELLED', 'The restore was cancelled.');
  }

  const safety = await backend.request('POST', '/api/v1/lifecycle/restore/safety-backup');
  if (!safety.ok) {
    await clearStaging(dataDir);
    return fail(safety.error.status, 'SAFETY_BACKUP_FAILED', 'Your current data could not be saved first, so nothing was changed.');
  }

  return swapInRestoredDatabase(backend, dataDir, path.join(dataDir, 'restore-staging', stagedName), counts);
}

function describeCounts(counts: Record<string, number>): string {
  const parts = COUNT_LABELS.map(([key, one, many]) => {
    const n = counts[key] ?? 0;
    return `${n} ${n === 1 ? one : many}`;
  });
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
