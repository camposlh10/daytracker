// Restore test against the real backend jar, without Electron or any dialog.
//
//   node scripts/restore-test.mjs
//
// Needs the backend jar (backend/target/day-tracker-backend.jar) and the compiled
// desktop sources (npm run build in desktop/). It builds a known fixture, backs it
// up, changes the data, and then checks the file work of a restore:
//   1. the restored data equals the fixture, and the previous files are gone
//   2. a restored file that cannot start is rolled back to the data before it
//   3. a restore cut short by a crash is undone at the next launch
// Everything happens in a throwaway directory; the real profile is never touched.

import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { BackendManager } = require(path.join(root, 'desktop', 'dist', 'backend.js'));
const swap = require(path.join(root, 'desktop', 'dist', 'restoreSwap.js'));

const jarPath = path.join(root, 'backend', 'target', 'day-tracker-backend.jar');
if (!existsSync(jarPath)) {
  console.error(`Missing ${jarPath}; build the backend first.`);
  process.exit(2);
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'daytracker-restore-'));
const dbDir = path.join(dataDir, 'db');
const backend = new BackendManager({
  javaPath: process.env.DAYTRACKER_JAVA ?? 'java',
  jarPath,
  dataDir,
  startupTimeoutMs: 60_000,
});

function check(condition, message) {
  if (!condition) {
    throw new Error(`CHECK FAILED: ${message}`);
  }
  console.log(`  ok  ${message}`);
}

async function data(method, url, body) {
  const result = await backend.request(method, url, body);
  if (!result.ok) {
    throw new Error(`${method} ${url} failed: ${JSON.stringify(result.error)}`);
  }
  return result.data;
}

async function startAndWait() {
  backend.start();
  const state = await backend.waitUntilSettled(60_000);
  if (state.status !== 'ready') {
    throw new Error(`Backend did not start: ${JSON.stringify(state)}`);
  }
}

/** Everything the fixture contains, in a form that can be compared. */
async function snapshot() {
  const tasks = await data('GET', '/api/v1/tasks?size=200');
  const books = await data('GET', '/api/v1/books');
  const sessions = await data('GET', '/api/v1/reading-sessions?size=200');
  return JSON.stringify({
    tasks: tasks.items.map((task) => [task.id, task.title, task.status, task.version]).sort(),
    books: books.map((book) => [book.id, book.title, book.currentPage, book.pagesReadTotal]),
    sessions: sessions.items.map((session) => [session.id, session.activityDate, session.pagesRead]),
  });
}

const leftovers = () => readdirSync(dbDir).filter((name) => name.includes('.previous'));

let failed = false;
try {
  console.log(`Data directory: ${dataDir}`);
  await startAndWait();

  console.log('Building the fixture');
  const bookId = randomUUID();
  for (const title of ['Fixture one', 'Fixture two, with a comma', '=Fixture three']) {
    await data('POST', '/api/v1/tasks', { id: randomUUID(), title });
  }
  await data('POST', '/api/v1/books', { id: bookId, title: 'Fixture book', totalPages: 200 });
  await data('POST', '/api/v1/reading-sessions', {
    id: randomUUID(),
    bookId,
    activityDate: '2020-01-01',
    pagesRead: 25,
    endingPage: 25,
  });
  const fixture = await snapshot();
  const backup = await data('POST', '/api/v1/backups');
  check(backup.verified && backup.kind === 'MANUAL', 'a verified manual backup of the fixture was made');

  console.log('Changing the data after the backup');
  await data('POST', '/api/v1/tasks', { id: randomUUID(), title: 'Made after the backup' });
  const changed = await snapshot();
  check(changed !== fixture, 'the data now differs from the fixture');

  console.log('1. Restoring the fixture');
  const staging = await swap.prepareStaging(dataDir);
  copyFileSync(path.join(dataDir, 'backups', backup.name), path.join(staging, 'staged-1.db'));
  const validated = await data('POST', '/api/v1/lifecycle/restore/validate', { fileName: 'staged-1.db' });
  check(validated.counts.tasks === 3 && validated.counts.books === 1, 'the staged copy was checked and described');
  await data('POST', '/api/v1/lifecycle/restore/safety-backup');
  const restored = await swap.swapInRestoredDatabase(backend, dataDir, path.join(staging, 'staged-1.db'), validated.counts, 60_000);
  check(restored.ok, 'the restore reported success');
  check((await snapshot()) === fixture, 'the restored data matches the fixture exactly');
  check(leftovers().length === 0 && !existsSync(path.join(dataDir, 'restore-journal.json')), 'no previous files or journal remain');
  check(!existsSync(path.join(dataDir, 'restore-staging')), 'the staging folder was cleared');
  const listing = await data('GET', '/api/v1/backups');
  check(listing.backups.some((entry) => entry.kind === 'SAFETY'), 'the data from before the restore is kept in a safety backup');

  console.log('2. A restored file that cannot start is rolled back');
  const stagingTwo = await swap.prepareStaging(dataDir);
  writeFileSync(path.join(stagingTwo, 'staged-2.db'), 'this is not a database '.repeat(200));
  const failedRestore = await swap.swapInRestoredDatabase(backend, dataDir, path.join(stagingTwo, 'staged-2.db'), {}, 40_000);
  check(!failedRestore.ok && failedRestore.error.code === 'RESTORE_FAILED', `the restore reported failure (${failedRestore.error?.message})`);
  check(backend.getState().status === 'ready', 'the data service is running again');
  check((await snapshot()) === fixture, 'the data is exactly what it was before the attempt');
  check(leftovers().length === 0 && !existsSync(path.join(dataDir, 'restore-journal.json')), 'no previous files or journal remain');

  console.log('3. A restore cut short by a crash is undone at the next launch');
  await backend.stop();
  const dbFile = path.join(dbDir, 'daytracker.db');
  renameSync(dbFile, `${dbFile}.previous`);
  writeFileSync(dbFile, 'half-written replacement');
  writeFileSync(path.join(dataDir, 'restore-journal.json'), JSON.stringify({ version: 1, phase: 'swapping' }));
  const message = await swap.recoverInterruptedRestore(dataDir);
  check(typeof message === 'string' && message.includes('undone'), 'the interrupted restore was reported as undone');
  await startAndWait();
  check((await snapshot()) === fixture, 'the earlier data is back after recovery');
  check(leftovers().length === 0 && !existsSync(path.join(dataDir, 'restore-journal.json')), 'no previous files or journal remain');

  console.log('4. A crash after the restored data had started keeps it');
  await backend.stop();
  writeFileSync(`${dbFile}.previous`, 'old data that is no longer needed');
  writeFileSync(path.join(dataDir, 'restore-journal.json'), JSON.stringify({ version: 1, phase: 'committed' }));
  check((await swap.recoverInterruptedRestore(dataDir)) === null, 'a committed restore is not reported as undone');
  check(leftovers().length === 0, 'only the leftovers were removed');
  await startAndWait();
  check((await snapshot()) === fixture, 'the restored data was kept');

  await backend.stop();
  console.log('RESTORE TEST PASSED');
} catch (error) {
  failed = true;
  console.error(error.message);
  console.error('RESTORE TEST FAILED');
  await backend.stop().catch(() => undefined);
} finally {
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    console.error(`Could not remove ${dataDir}`);
  }
}
process.exit(failed ? 1 : 0);
