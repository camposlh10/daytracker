import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BackendManager } from './backend';
import type { ApiResult, RestoreResult } from './shared/bridge-types';

/**
 * The file work of a restore, kept free of dialogs so it can be run against a
 * real backend in tests. The previous database stays in place, renamed, until
 * the restored one has started, and everything is undone otherwise. A journal
 * marks the window in which the files are being swapped, so a crash inside it
 * is undone at the next launch.
 */

const START_TIMEOUT_MS = 90_000;
const SUFFIXES = ['', '-wal', '-shm'];
const JOURNAL = 'restore-journal.json';

export function stagingDir(dataDir: string): string {
  return path.join(dataDir, 'restore-staging');
}

export async function prepareStaging(dataDir: string): Promise<string> {
  const staging = stagingDir(dataDir);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  return staging;
}

export function clearStaging(dataDir: string): Promise<void> {
  return rm(stagingDir(dataDir), { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Replaces the database with the staged file and restarts the data service on it.
 * The caller has already validated the file and saved a safety backup. On any
 * failure the previous database is put back and the service restarted on it.
 */
export async function swapInRestoredDatabase(
  backend: BackendManager,
  dataDir: string,
  staged: string,
  counts: Record<string, number>,
  startTimeoutMs: number = START_TIMEOUT_MS,
): Promise<ApiResult<RestoreResult>> {
  const dbDir = path.join(dataDir, 'db');
  const journal = path.join(dataDir, JOURNAL);

  await backend.stopForMaintenance();
  try {
    await writeFile(journal, JSON.stringify({ version: 1, phase: 'swapping', startedAt: new Date().toISOString() }));
    await moveCurrentAside(dbDir);
    await renameWithRetry(staged, databaseFile(dbDir));
  } catch (error) {
    return rollback(backend, dataDir, describeFileError(error, 'The data could not be replaced.'), startTimeoutMs);
  }

  backend.start();
  const settled = await backend.waitUntilSettled(startTimeoutMs);
  if (settled.status !== 'ready') {
    await backend.stop();
    return rollback(backend, dataDir, 'The restored data could not be opened.', startTimeoutMs);
  }

  // The restored data is running: from here the previous files are no longer needed.
  await writeFile(journal, JSON.stringify({ version: 1, phase: 'committed' })).catch(() => undefined);
  await removePrevious(dbDir);
  await rm(journal, { force: true }).catch(() => undefined);
  await clearStaging(dataDir);
  return { ok: true, data: { counts } };
}

/** Puts the previous files back, restarts the service on them, and reports why the restore did not happen. */
async function rollback(
  backend: BackendManager,
  dataDir: string,
  reason: string,
  startTimeoutMs: number,
): Promise<ApiResult<RestoreResult>> {
  try {
    await restorePrevious(path.join(dataDir, 'db'));
  } catch {
    return fail(
      500,
      'RESTORE_ROLLBACK_FAILED',
      `${reason} Your earlier data could not be put back automatically; it is in the safety backup in the backup folder.`,
    );
  }
  await rm(path.join(dataDir, JOURNAL), { force: true }).catch(() => undefined);
  await clearStaging(dataDir);
  backend.start();
  const settled = await backend.waitUntilSettled(startTimeoutMs);
  if (settled.status !== 'ready') {
    return fail(500, 'RESTORE_ROLLBACK_FAILED', `${reason} Your earlier data was put back, but the data service did not start.`);
  }
  return fail(500, 'RESTORE_FAILED', `${reason} Your earlier data was put back and nothing was changed.`);
}

/**
 * Run at launch, before the data service starts. Undoes a restore that was cut
 * short and clears leftovers. Returns a message when something was undone.
 */
export async function recoverInterruptedRestore(dataDir: string): Promise<string | null> {
  const dbDir = path.join(dataDir, 'db');
  const journal = path.join(dataDir, JOURNAL);
  let message: string | null = null;
  if (await exists(journal)) {
    if ((await readPhase(journal)) === 'committed') {
      await removePrevious(dbDir);
    } else {
      await restorePrevious(dbDir);
      message = 'A restore that was still running when the app closed was undone. Your earlier data was kept.';
    }
    await rm(journal, { force: true });
  }
  await clearStaging(dataDir);
  return message;
}

async function readPhase(journal: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(journal, 'utf8')) as { phase?: unknown };
    return typeof parsed.phase === 'string' ? parsed.phase : null;
  } catch {
    // An unreadable journal is treated as an unfinished swap, which is the safe reading.
    return null;
  }
}

function databaseFile(dbDir: string): string {
  return path.join(dbDir, 'daytracker.db');
}

function previousFile(dbDir: string, suffix: string): string {
  return `${databaseFile(dbDir)}.previous${suffix}`;
}

async function moveCurrentAside(dbDir: string): Promise<void> {
  await removePrevious(dbDir);
  for (const suffix of SUFFIXES) {
    const current = `${databaseFile(dbDir)}${suffix}`;
    if (await exists(current)) {
      await renameWithRetry(current, previousFile(dbDir, suffix));
    }
  }
}

async function restorePrevious(dbDir: string): Promise<void> {
  if (!(await exists(previousFile(dbDir, '')))) {
    return;
  }
  for (const suffix of SUFFIXES) {
    await rm(`${databaseFile(dbDir)}${suffix}`, { force: true });
  }
  for (const suffix of SUFFIXES) {
    const previous = previousFile(dbDir, suffix);
    if (await exists(previous)) {
      await renameWithRetry(previous, `${databaseFile(dbDir)}${suffix}`);
    }
  }
}

async function removePrevious(dbDir: string): Promise<void> {
  for (const suffix of SUFFIXES) {
    await rm(previousFile(dbDir, suffix), { force: true });
  }
}

/** Windows can hold a just-closed file for a moment; try a few times before giving up. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 9 || (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES')) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export function describeFileError(error: unknown, fallback: string): string {
  switch ((error as NodeJS.ErrnoException).code) {
    case 'ENOSPC':
      return 'There is not enough free disk space.';
    case 'EACCES':
    case 'EPERM':
    case 'EBUSY':
      return 'The file is locked or this account is not allowed to use it.';
    case 'ENOENT':
      return 'The file or folder could not be found.';
    default:
      return fallback;
  }
}

export function fail(status: number, code: string, message: string): ApiResult<never> {
  return { ok: false, error: { status, code, message } };
}
