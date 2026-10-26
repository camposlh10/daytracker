import { app, dialog, shell, type BrowserWindow } from 'electron';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BackendManager } from './backend';
import { describeFileError } from './restoreSwap';
import type { ApiResult, BackupStatus, ExportDataset, ExportResult } from './shared/bridge-types';

/**
 * The parts of the data tools that need the operating system: native save
 * dialogs, writing the chosen file, and opening the backup folder. The page
 * never names a path; it asks, and the user picks the place.
 */

const BACKUP_NAME = /^(manual|auto|pre-migration|safety)-[A-Za-z0-9-]+\.db$/;

export interface DataToolsContext {
  window: BrowserWindow | null;
  backend: BackendManager;
  dataDir: string;
}

export async function exportCsv(
  { window, backend, dataDir }: DataToolsContext,
  dataset: ExportDataset,
  range: { from: string; to: string } | undefined,
): Promise<ApiResult<ExportResult>> {
  const query = dataset === 'summaries' && range ? `?${new URLSearchParams(range)}` : '';
  const download = await backend.fetchFile(`/api/v1/exports/${dataset}${query}`);
  if (!download.ok) {
    return download;
  }
  const suggested = download.data.fileName ?? `${dataset}.csv`;
  const target = await chooseTarget(window, dataDir, {
    title: 'Save export',
    defaultPath: path.join(app.getPath('documents'), suggested),
    filters: [{ name: 'CSV (spreadsheet)', extensions: ['csv'] }],
  });
  if (!target.ok) {
    return target;
  }
  try {
    await writeFile(target.data, download.data.bytes);
  } catch (error) {
    return failure('FILE_WRITE_FAILED', describeFileError(error, 'The file could not be saved.'));
  }
  return { ok: true, data: { fileName: path.basename(target.data), truncated: download.data.truncated } };
}

export async function saveBackupCopy(
  { window, backend, dataDir }: DataToolsContext,
  name: string,
): Promise<ApiResult<{ fileName: string }>> {
  if (!BACKUP_NAME.test(name)) {
    return failure('INVALID_REQUEST', 'That is not a backup name.');
  }
  // Only a file the data service itself lists can be copied.
  const status = await backend.request('GET', '/api/v1/backups');
  if (!status.ok) {
    return status;
  }
  if (!(status.data as BackupStatus).backups.some((backup) => backup.name === name)) {
    return failure('NOT_FOUND', 'That backup no longer exists.');
  }
  const target = await chooseTarget(window, dataDir, {
    title: 'Save a copy of this backup',
    defaultPath: path.join(app.getPath('documents'), name),
    filters: [{ name: 'Day Tracker backup', extensions: ['db'] }],
  });
  if (!target.ok) {
    return target;
  }
  try {
    await copyFile(path.join(dataDir, 'backups', name), target.data);
  } catch (error) {
    return failure('FILE_WRITE_FAILED', describeFileError(error, 'The copy could not be saved.'));
  }
  return { ok: true, data: { fileName: path.basename(target.data) } };
}

export async function openBackupFolder(dataDir: string): Promise<void> {
  const folder = path.join(dataDir, 'backups');
  await mkdir(folder, { recursive: true });
  await shell.openPath(folder);
}

/** Asks where to save. Refuses places inside the application's own data, which hold the live database. */
async function chooseTarget(
  window: BrowserWindow | null,
  dataDir: string,
  options: Electron.SaveDialogOptions,
): Promise<ApiResult<string>> {
  const choice = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
  if (choice.canceled || !choice.filePath) {
    return failure('CANCELLED', 'No place was chosen.', 0);
  }
  const relative = path.relative(path.resolve(dataDir), path.resolve(choice.filePath));
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return failure('INVALID_REQUEST', 'Choose a place outside the application data folder.');
  }
  return { ok: true, data: choice.filePath };
}

function failure(code: string, message: string, status = 400): ApiResult<never> {
  return { ok: false, error: { status, code, message } };
}
