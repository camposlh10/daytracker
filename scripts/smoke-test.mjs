// End-to-end smoke test for a running Day Tracker build (development or packaged).
//
//   node scripts/smoke-test.mjs <path-to-exe> [app-args...]
//
// It launches the app twice against a throwaway data directory and, through the
// same preload bridge the UI uses, saves a task, exits, relaunches, and reads the
// task back. It also checks that no backend process is left behind after exit.
// The real user profile is never touched.

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEBUG_PORT = 9333;
const READY_TIMEOUT_MS = 60_000;

const [exe, ...appArgs] = process.argv.slice(2);
if (!exe) {
  console.error('Usage: node scripts/smoke-test.mjs <path-to-exe> [app-args...]');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function childProcesses(pid) {
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`,
    ],
    { encoding: 'utf8' },
  );
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [id, name] = line.trim().split(' ');
      return { pid: Number(id), name };
    });
}

/** Established connections of these processes that leave this computer. */
function outboundConnections(pids) {
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-NetTCPConnection -OwningProcess ${pids.join(',')} -ErrorAction SilentlyContinue | Where-Object { $_.State -ne 'Listen' -and $_.RemoteAddress -notin @('127.0.0.1', '::1', '0.0.0.0', '::') } | ForEach-Object { "$($_.OwningProcess) $($_.State) $($_.RemoteAddress):$($_.RemotePort)" }; exit 0`,
    ],
    { encoding: 'utf8' },
  );
  return output.split(/\r?\n/).filter(Boolean);
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function connect() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.onopen = resolve;
          socket.onerror = reject;
        });
        return socket;
      }
    } catch {
      // The app is still starting.
    }
    await sleep(250);
  }
  throw new Error('Could not attach to the application window.');
}

function evaluator(socket) {
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };
  return async (expression) => {
    const id = ++nextId;
    const reply = new Promise((resolve) => pending.set(id, resolve));
    socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
    const message = await reply;
    if (message.error || message.result.exceptionDetails) {
      throw new Error(`Evaluation failed: ${JSON.stringify(message.error ?? message.result.exceptionDetails)}`);
    }
    return message.result.result.value;
  };
}

async function launch(userData) {
  const started = Date.now();
  const app = spawn(exe, [...appArgs, `--remote-debugging-port=${DEBUG_PORT}`], {
    env: { ...process.env, DAYTRACKER_USER_DATA: userData, DAYTRACKER_ALLOW_DEBUG_PORT: '1' },
    stdio: 'ignore',
  });
  const exited = new Promise((resolve) => app.once('exit', resolve));
  const socket = await connect();
  const evaluate = evaluator(socket);

  let state;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  do {
    state = await evaluate('window.dayTracker.backend.getState()');
    if (state.status === 'failed') {
      throw new Error(`Backend failed to start: ${state.message}`);
    }
    if (state.status !== 'ready') {
      await sleep(100);
    }
  } while (state.status !== 'ready' && Date.now() < deadline);
  if (state.status !== 'ready') {
    throw new Error('Backend did not become ready in time.');
  }
  const readyMs = Date.now() - started;
  const java = childProcesses(app.pid).filter((child) => child.name.toLowerCase().startsWith('java'));

  return {
    evaluate,
    readyMs,
    java,
    pid: app.pid,
    children: () => childProcesses(app.pid),
    async exit() {
      const quitStarted = Date.now();
      // The window closes as it quits, so the reply to this call may never arrive.
      void evaluate('void window.dayTracker.app.exit()').catch(() => undefined);
      await Promise.race([
        exited,
        sleep(20_000).then(() => {
          app.kill();
          throw new Error('The application did not exit within 20 seconds.');
        }),
      ]);
      await sleep(500);
      const orphans = java.filter((child) => isRunning(child.pid));
      if (orphans.length > 0) {
        orphans.forEach((child) => process.kill(child.pid));
        throw new Error(`Backend process left running after exit: ${JSON.stringify(orphans)}`);
      }
      return Date.now() - quitStarted;
    },
  };
}

function check(condition, message) {
  if (!condition) {
    throw new Error(`CHECK FAILED: ${message}`);
  }
  console.log(`  ok  ${message}`);
}

const userData = mkdtempSync(path.join(tmpdir(), 'daytracker-smoke-'));
const taskId = randomUUID();
const title = `Smoke test task ${taskId.slice(0, 8)}`;
let completedAt = null;
let today = null;
const bookId = randomUUID();
const sessionId = randomUUID();
const eventId = randomUUID();
const call = (expression, ...args) => `window.dayTracker.${expression}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`;
let failed = false;

try {
  console.log(`Data directory: ${userData}`);

  console.log('A debugging port');
  {
    // Without the opt-in the released app must not open a port that other programs could use.
    const refused = spawn(exe, [...appArgs, '--remote-debugging-port=9334'], {
      env: { ...process.env, DAYTRACKER_USER_DATA: path.join(userData, 'refused'), DAYTRACKER_ALLOW_DEBUG_PORT: '' },
      stdio: 'ignore',
    });
    const code = await Promise.race([new Promise((resolve) => refused.once('exit', resolve)), sleep(15_000).then(() => 'still running')]);
    if (code === 'still running') {
      refused.kill();
    }
    check(code === 2, 'the app refuses to start with a debugging port');
  }

  console.log('First launch');
  let app = await launch(userData);
  console.log(`  ready in ${app.readyMs} ms`);
  check(app.java.length === 1, 'exactly one backend process is running under the app');
  const everyProcess = [app.pid, ...app.children().map((child) => child.pid)];
  const outbound = outboundConnections(everyProcess);
  check(outbound.length === 0, `the app and its helpers hold no connection to another computer${outbound.length ? `: ${outbound.join(', ')}` : ''}`);
  check(
    (await app.evaluate('typeof window.require')) === 'undefined' &&
      (await app.evaluate('typeof window.process')) === 'undefined',
    'the renderer has no Node.js access',
  );
  const input = JSON.stringify({ id: taskId, title, plannedDate: '2026-10-15' });
  const created = await app.evaluate(`window.dayTracker.tasks.create(${input})`);
  check(created.ok && created.data.id === taskId && created.data.status === 'PENDING', 'task was saved');
  const replayed = await app.evaluate(`window.dayTracker.tasks.create(${input})`);
  check(replayed.ok && replayed.data.version === 1, 'repeating the same save does not duplicate it');
  const rejected = await app.evaluate(`window.dayTracker.tasks.create({ id: 'not-a-uuid', title: 'x' })`);
  check(!rejected.ok && rejected.error.status === 400, 'an invalid payload is rejected by the bridge');
  const month = await app.evaluate(`window.dayTracker.calendar.getRange({ from: '2026-09-28', to: '2026-11-09' })`);
  check(
    month.ok && month.data.items.length === 1 && month.data.items[0].id === taskId && month.data.items[0].date === '2026-10-15',
    'the task appears on its planned date in the calendar range',
  );
  const before = await app.evaluate(`window.dayTracker.calendar.getRange({ from: '2026-10-01', to: '2026-10-15' })`);
  check(before.ok && before.data.items.length === 0, 'the end of a calendar range is exclusive');
  const tooLong = await app.evaluate(`window.dayTracker.calendar.getRange({ from: '2026-01-01', to: '2026-12-31' })`);
  check(!tooLong.ok && tooLong.error.status === 400, 'a calendar range over 93 days is rejected');
  const categoryId = randomUUID();
  const category = await app.evaluate(
    `window.dayTracker.categories.create(${JSON.stringify({ id: categoryId, name: 'Smoke', color: '#668be8' })})`,
  );
  check(category.ok && category.data.name === 'Smoke', 'category was saved');
  const completed = await app.evaluate(
    `window.dayTracker.tasks.update(${JSON.stringify(taskId)}, ${JSON.stringify({ version: 1, status: 'DONE', categoryId })})`,
  );
  check(
    completed.ok && completed.data.status === 'DONE' && completed.data.completedAt && completed.data.version === 2,
    'task was completed and categorised',
  );
  completedAt = completed.data.completedAt;
  const stale = await app.evaluate(
    `window.dayTracker.tasks.update(${JSON.stringify(taskId)}, { version: 1, title: 'Stale overwrite' })`,
  );
  check(!stale.ok && stale.error.status === 409, 'an edit with a stale version is refused');
  today = await app.evaluate(
    `(() => { const n = new Date(); const p = (v) => String(v).padStart(2, '0'); const t = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1); return { from: n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate()), to: t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) }; })()`,
  );
  const progress = await app.evaluate(`window.dayTracker.progress.get(${JSON.stringify(today)})`);
  check(progress.ok && progress.data.tasksCompleted === 1, 'the completion is counted in the total for today');
  check(
    progress.data.today === today.from && progress.data.elapsedDays === 1 && progress.data.completedTasks.length === 1,
    'the report knows today and lists the records behind its totals',
  );
  const settings = await app.evaluate(call('settings.get'));
  const systemZone = await app.evaluate('Intl.DateTimeFormat().resolvedOptions().timeZone');
  check(
    settings.ok && settings.data.weekStart === 1 && settings.data.timeFormat === 'H12' && settings.data.timezone === systemZone,
    'the first run stored the computer timezone explicitly',
  );
  const badZone = await app.evaluate(call('settings.update', { timezone: 'Mars/Olympus' }));
  const badWeek = await app.evaluate(call('settings.update', { weekStart: 9 }));
  check(!badZone.ok && badZone.error.status === 400 && !badWeek.ok, 'invalid settings are refused');
  const changedSettings = await app.evaluate(call('settings.update', { displayName: 'Smoke Tester', weekStart: 0, timeFormat: 'H24' }));
  check(
    changedSettings.ok && changedSettings.data.weekStart === 0 && changedSettings.data.timezone === systemZone,
    'settings were changed without touching the timezone',
  );
  const madeBackup = await app.evaluate(call('backups.backupNow'));
  const backupList = await app.evaluate(call('backups.status'));
  check(
    madeBackup.ok && madeBackup.data.verified && backupList.ok && backupList.data.backups.some((entry) => entry.name === madeBackup.data.name),
    'a backup was made, checked, and listed',
  );
  check(
    backupList.data.lastAttempt.ok && existsSync(path.join(backupList.data.directory, madeBackup.data.name)),
    'the backup file is in the reported folder',
  );
  const badCopy = await app.evaluate(call('backups.saveCopy', '..\\..\\daytracker.db'));
  const badExport = await app.evaluate(call('exports.save', 'passwords'));
  check(!badCopy.ok && badCopy.error.status === 400 && !badExport.ok && badExport.error.status === 400, 'the page cannot name a file to copy or an unknown export');
  const book = await app.evaluate(call('books.create', { id: bookId, title: 'Smoke book', totalPages: 200 }));
  check(book.ok && book.data.currentPage === 0 && book.data.status === 'TO_READ', 'book was saved');
  check(book.data.coverUpdatedAt === null, 'a new book has no cover');
  // The cover search needs the internet; either outcome is fine, but offline must be a clear error.
  const covers = await app.evaluate(call('books.findCovers', bookId));
  check(
    covers.ok || covers.error.code === 'COVER_SOURCE_UNAVAILABLE',
    `the cover search answers cleanly (${covers.ok ? `${covers.data.length} found` : 'offline'})`,
  );
  const suggestions = await app.evaluate(call('books.suggest', 'smoke book'));
  check(
    suggestions.ok || suggestions.error.code === 'COVER_SOURCE_UNAVAILABLE',
    `title suggestions answer cleanly (${suggestions.ok ? `${suggestions.data.length} found` : 'offline'})`,
  );
  const tooShort = await app.evaluate(call('books.suggest', 'ab'));
  check(!tooShort.ok && tooShort.error.status === 400, 'suggestions need at least three characters');
  const missingCover = await app.evaluate(
    `new Promise((resolve) => { const image = new Image(); image.onload = () => resolve('loaded'); image.onerror = () => resolve('missing'); image.src = 'dt-cover://book/${bookId}?v=1'; })`,
  );
  check(missingCover === 'missing', 'a book without a cover serves no image');
  const todaySession = await app.evaluate(
    call('readingSessions.create', { id: sessionId, bookId, activityDate: today.from, pagesRead: 30, endingPage: 90 }),
  );
  const backdated = await app.evaluate(
    call('readingSessions.create', {
      id: randomUUID(),
      bookId,
      activityDate: '2020-01-01',
      pagesRead: 10,
      endingPage: 40,
    }),
  );
  check(todaySession.ok && backdated.ok, 'reading sessions were saved, one of them backdated');
  const future = await app.evaluate(
    call('readingSessions.create', { id: randomUUID(), bookId, activityDate: today.to, pagesRead: 5 }),
  );
  check(!future.ok && future.error.status === 400, 'reading for a future date is rejected');
  const afterReading = (await app.evaluate(call('books.list'))).data.find((entry) => entry.id === bookId);
  check(
    afterReading.currentPage === 90 && afterReading.pagesReadTotal === 40,
    'the backdated session adds effort without overriding the newer position',
  );
  const goal = await app.evaluate(call('readingGoals.set', today.from, 45));
  const readingDay = await app.evaluate(call('calendar.getDay', today.from));
  check(
    goal.ok && readingDay.data.pagesRead === 30 && readingDay.data.readingGoal.targetPages === 45,
    'the day shows its pages against the new target',
  );
  const oldDay = await app.evaluate(call('calendar.getDay', '2020-01-01'));
  check(oldDay.data.pagesRead === 10 && oldDay.data.readingGoal.targetPages === 30, 'an earlier day keeps the earlier target');
  const zone = await app.evaluate('Intl.DateTimeFormat().resolvedOptions().timeZone');
  const party = await app.evaluate(
    call('events.create', {
      id: eventId,
      title: 'Smoke party',
      allDay: false,
      start: `${today.from}T22:00`,
      end: `${today.to}T02:00`,
      timezone: zone,
    }),
  );
  const partyRange = await app.evaluate(call('calendar.getRange', { from: today.from, to: today.to }));
  const nextDay = await app.evaluate(call('calendar.getDay', today.to));
  check(
    party.ok && partyRange.ok && nextDay.data.events.some((event) => event.id === eventId),
    'an appointment across midnight appears on the next day too',
  );
  const backwards = await app.evaluate(
    call('events.create', { id: randomUUID(), title: 'Backwards', allDay: false, start: `${today.from}T10:00`, end: `${today.from}T09:00`, timezone: zone }),
  );
  check(!backwards.ok && backwards.error.status === 400, 'an appointment ending before it starts is rejected');
  const review = await app.evaluate(
    call('reviews.save', today.from, { version: null, wins: 'Smoke wins', obstacles: '', tomorrowPriority: 'Rest' }),
  );
  const staleReview = await app.evaluate(
    call('reviews.save', today.from, { version: null, wins: 'Overwrite', obstacles: '', tomorrowPriority: '' }),
  );
  check(review.ok && !staleReview.ok && staleReview.error.status === 409, 'a review is saved once and not silently overwritten');
  console.log(`  exited in ${await app.exit()} ms`);
  check(true, 'no backend process left behind after exit');
  check(existsSync(path.join(userData, 'data', 'db', 'daytracker.db')), 'database file is in the data directory');
  check(existsSync(path.join(userData, 'data', 'logs', 'backend.log')), 'log file is in the data directory');

  console.log('Second launch');
  app = await launch(userData);
  console.log(`  ready in ${app.readyMs} ms`);
  const listed = await app.evaluate('window.dayTracker.tasks.list()');
  check(
    listed.ok && listed.data.total === 1 && listed.data.items[0].id === taskId && listed.data.items[0].title === title,
    'the task was reloaded after restart',
  );
  const day = await app.evaluate(`window.dayTracker.calendar.getDay('2026-10-15')`);
  check(day.ok && day.data.tasks.length === 1 && day.data.tasks[0].id === taskId, 'the selected-day query returns the task');
  const reloaded = listed.data.items[0];
  check(
    reloaded.status === 'DONE' && reloaded.completedAt === completedAt && reloaded.version === 2,
    'the completion and its time survived the restart',
  );
  const history = await app.evaluate(`window.dayTracker.tasks.getActivity(${JSON.stringify(taskId)})`);
  check(
    history.ok && history.data.map((entry) => entry.action).join() === 'CREATED,COMPLETED,EDITED',
    'the task history was recorded',
  );
  const archived = await app.evaluate(
    `window.dayTracker.tasks.update(${JSON.stringify(taskId)}, { version: 2, archived: true })`,
  );
  const afterArchive = await app.evaluate('window.dayTracker.tasks.list()');
  const archiveList = await app.evaluate('window.dayTracker.tasks.list({ archived: true })');
  check(
    archived.ok && afterArchive.data.total === 0 && archiveList.data.total === 1,
    'archiving hides the task from the normal list and keeps it in the archive',
  );
  const settingsAfterRestart = await app.evaluate(call('settings.get'));
  check(
    settingsAfterRestart.ok &&
      settingsAfterRestart.data.displayName === 'Smoke Tester' &&
      settingsAfterRestart.data.weekStart === 0 &&
      settingsAfterRestart.data.timeFormat === 'H24',
    'the settings survived the restart',
  );
  const reviewAfterRestart = await app.evaluate(call('reviews.get', today.from));
  check(reviewAfterRestart.ok && reviewAfterRestart.data.wins === 'Smoke wins', 'the review survived the restart');
  const removedEvent = await app.evaluate(call('events.delete', eventId, 1));
  const dayAfterEventDelete = await app.evaluate(call('calendar.getDay', today.from));
  check(
    removedEvent.ok && !dayAfterEventDelete.data.events.some((event) => event.id === eventId),
    'a deleted appointment is gone from the day',
  );
  const persisted = (await app.evaluate(call('books.list'))).data.find((entry) => entry.id === bookId);
  check(persisted.currentPage === 90 && persisted.pagesReadTotal === 40, 'reading survived the restart');
  const removed = await app.evaluate(call('readingSessions.delete', sessionId, 1));
  const afterDelete = (await app.evaluate(call('books.list'))).data.find((entry) => entry.id === bookId);
  const dayAfterDelete = await app.evaluate(call('calendar.getDay', today.from));
  check(
    removed.ok && afterDelete.currentPage === 40 && afterDelete.pagesReadTotal === 10 && dayAfterDelete.data.pagesRead === 0,
    'deleting a session recalculates the book and the day',
  );
  console.log('Backend crash');
  const crashedPid = app.java[0].pid;
  process.kill(crashedPid);
  let crashState;
  for (let i = 0; i < 100 && crashState?.status !== 'failed'; i++) {
    await sleep(100);
    crashState = await app.evaluate('window.dayTracker.backend.getState()');
  }
  check(crashState?.status === 'failed' && crashState.reason === 'crashed', 'the window is told the data service crashed');
  const refusedWrite = await app.evaluate(call('tasks.create', { id: randomUUID(), title: 'Written while down' }));
  check(!refusedWrite.ok && refusedWrite.error.code === 'BACKEND_UNAVAILABLE', 'changes are refused while it is down');
  await app.evaluate('window.dayTracker.backend.restart()');
  let restarted;
  for (let i = 0; i < 300 && restarted?.status !== 'ready'; i++) {
    await sleep(100);
    restarted = await app.evaluate('window.dayTracker.backend.getState()');
  }
  check(restarted?.status === 'ready', 'an explicit restart brings it back');
  const afterCrash = await app.evaluate('window.dayTracker.tasks.list({ archived: true })');
  check(afterCrash.ok && afterCrash.data.total === 1 && afterCrash.data.items[0].id === taskId, 'earlier data is intact and nothing was written while it was down');
  const restartedJava = childProcesses(app.pid).filter((child) => child.name.toLowerCase().startsWith('java'));
  check(restartedJava.length === 1 && restartedJava[0].pid !== crashedPid, 'exactly one new backend process is running');
  app.java.push(...restartedJava);
  console.log(`  exited in ${await app.exit()} ms`);
  check(true, 'no backend process left behind after exit');

  console.log('Third launch: the window process is killed outright');
  app = await launch(userData);
  const orphanCandidates = app.java.map((child) => child.pid);
  execFileSync('taskkill', ['/F', '/PID', String(app.pid)]);
  let orphansGone = false;
  for (let i = 0; i < 200 && !orphansGone; i++) {
    await sleep(100);
    orphansGone = orphanCandidates.every((pid) => !isRunning(pid));
  }
  check(orphansGone, 'the backend exits by itself when the app is killed');
  // Chromium helpers die with their parent too; make sure none hold the data directory.
  await sleep(1000);

  console.log('SMOKE TEST PASSED');
} catch (error) {
  failed = true;
  console.error(error.message);
  console.error('SMOKE TEST FAILED');
} finally {
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {
    console.error(`Could not remove ${userData}`);
  }
}
process.exit(failed ? 1 : 0);
