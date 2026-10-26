// Start-up, crash, and shutdown behaviour against the real backend jar, without Electron.
//
//   node scripts/lifecycle-test.mjs
//
// Needs backend/target/day-tracker-backend.jar and the compiled desktop sources
// (npm run build in desktop/). Everything happens in throwaway directories.
//
//   1. a backend that cannot start is reported as failed, never as an empty app
//   2. a start that takes too long is reported as a timeout and the process is stopped
//   3. a database from a newer version is refused and left untouched
//   4. after a crash, changes are refused, an explicit restart works, and data is intact
//   5. a normal stop leaves no process behind
//   6. when the parent process dies without cleaning up, the backend exits by itself
//   7. two backends at once get different ports and separate data

import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const distBackend = path.join(root, 'desktop', 'dist', 'backend.js');
const { BackendManager } = require(distBackend);
const jarPath = path.join(root, 'backend', 'target', 'day-tracker-backend.jar');
const javaPath = process.env.DAYTRACKER_JAVA ?? 'java';
if (!existsSync(jarPath)) {
  console.error(`Missing ${jarPath}; build the backend first.`);
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const made = [];
const managers = [];

function check(condition, message) {
  if (!condition) {
    throw new Error(`CHECK FAILED: ${message}`);
  }
  console.log(`  ok  ${message}`);
}

function newDataDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'daytracker-lifecycle-'));
  made.push(dir);
  return dir;
}

function manager(options) {
  const created = new BackendManager({ javaPath, jarPath, startupTimeoutMs: 60_000, ...options });
  managers.push(created);
  return created;
}

const isRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitUntil(predicate, timeoutMs, step = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await sleep(step);
  }
  return false;
}

async function startedReady(dataDir) {
  const backend = manager({ dataDir });
  backend.start();
  const state = await backend.waitUntilSettled(60_000);
  if (state.status !== 'ready') {
    throw new Error(`Backend did not start: ${JSON.stringify(state)}`);
  }
  return backend;
}

let failed = false;
try {
  console.log('1. A backend that cannot start');
  {
    const backend = manager({ dataDir: newDataDir(), jarPath: path.join(tmpdir(), 'no-such-backend.jar') });
    backend.start();
    const state = await backend.waitUntilSettled(30_000);
    check(state.status === 'failed' && state.reason === 'startup', `reported as a failed start (${state.message})`);
    const refused = await backend.request('GET', '/api/v1/tasks');
    check(!refused.ok && refused.error.code === 'BACKEND_UNAVAILABLE', 'requests are refused instead of answered with empty data');
  }

  console.log('2. A start that takes too long');
  {
    const backend = manager({ dataDir: newDataDir(), startupTimeoutMs: 300 });
    backend.start();
    const pid = backend.child.pid;
    const state = await backend.waitUntilSettled(15_000);
    check(state.status === 'failed' && state.reason === 'timeout', 'reported as a timeout');
    check(await waitUntil(() => !isRunning(pid), 15_000), 'the slow process was stopped, not left running');
  }

  console.log('3. A database from a newer version');
  {
    const dataDir = newDataDir();
    const first = await startedReady(dataDir);
    await first.stop();
    const dbFile = path.join(dataDir, 'db', 'daytracker.db');
    const database = new DatabaseSync(dbFile);
    database.exec("INSERT INTO schema_migrations (version, description, checksum, applied_at) VALUES (99, 'future', 'abc', 'now')");
    database.close();
    const before = createHash('sha256').update(readFileSync(dbFile)).digest('hex');

    const backend = manager({ dataDir });
    backend.start();
    const state = await backend.waitUntilSettled(60_000);
    check(state.status === 'failed' && state.reason === 'startup', 'refused to open it');
    check(createHash('sha256').update(readFileSync(dbFile)).digest('hex') === before, 'the database file was not changed');
  }

  console.log('4. A crash of the backend');
  {
    const dataDir = newDataDir();
    const backend = await startedReady(dataDir);
    const id = randomUUID();
    const saved = await backend.request('POST', '/api/v1/tasks', { id, title: 'Saved before the crash' });
    check(saved.ok, 'a task was saved before the crash');
    const states = [];
    backend.on('state', (state) => states.push(state));

    process.kill(backend.child.pid);
    const crashed = await waitUntil(() => backend.getState().status === 'failed', 15_000);
    check(crashed && backend.getState().reason === 'crashed', 'the crash was detected and reported as a crash');
    const refused = await backend.request('POST', '/api/v1/tasks', { id: randomUUID(), title: 'Written after the crash' });
    check(!refused.ok && refused.error.code === 'BACKEND_UNAVAILABLE', 'changes are refused while the service is down');

    await backend.restart();
    const state = await backend.waitUntilSettled(60_000);
    check(state.status === 'ready', 'an explicit restart brings it back');
    const listed = await backend.request('GET', '/api/v1/tasks');
    check(
      listed.ok && listed.data.total === 1 && listed.data.items[0].id === id,
      'the saved task is there and nothing was written while it was down',
    );
    const pid = backend.child.pid;
    await backend.stop();
    check(!isRunning(pid), '(5) a normal stop leaves no process behind');
  }

  console.log('6. The parent dies without cleaning up');
  {
    const dataDir = newDataDir();
    const helper = path.join(newDataDir(), 'helper.cjs');
    writeFileSync(
      helper,
      `const { BackendManager } = require(${JSON.stringify(distBackend)});
const backend = new BackendManager({ javaPath: ${JSON.stringify(javaPath)}, jarPath: ${JSON.stringify(jarPath)}, dataDir: ${JSON.stringify(dataDir)}, startupTimeoutMs: 60000 });
backend.start();
backend.waitUntilSettled(60000).then((state) => { console.log('STATE ' + state.status + ' ' + backend.child.pid); setInterval(() => {}, 1000); });
`,
    );
    const parent = spawn(process.execPath, [helper], { stdio: ['ignore', 'pipe', 'ignore'] });
    const javaPid = await new Promise((resolve, reject) => {
      parent.stdout.on('data', (chunk) => {
        const match = /STATE ready (\d+)/.exec(String(chunk));
        if (match) {
          resolve(Number(match[1]));
        }
      });
      setTimeout(() => reject(new Error('The helper did not start the backend.')), 70_000);
    });
    check(isRunning(javaPid), 'the backend is running under the helper');
    // A hard kill of only the parent, as a crash would.
    execFileSync('taskkill', ['/F', '/PID', String(parent.pid)]);
    check(await waitUntil(() => !isRunning(javaPid), 20_000), 'the backend exited on its own after its parent died');
  }

  console.log('7. Two backends at once');
  {
    const [one, two] = await Promise.all([startedReady(newDataDir()), startedReady(newDataDir())]);
    check(one.port !== two.port && one.port > 0 && two.port > 0, 'each took its own free port');
    const a = await one.request('POST', '/api/v1/tasks', { id: randomUUID(), title: 'Only in one' });
    const listTwo = await two.request('GET', '/api/v1/tasks');
    check(a.ok && listTwo.ok && listTwo.data.total === 0, 'their data is separate');
  }

  console.log('LIFECYCLE TEST PASSED');
} catch (error) {
  failed = true;
  console.error(error.message);
  console.error('LIFECYCLE TEST FAILED');
} finally {
  for (const backend of managers) {
    await backend.stop().catch(() => undefined);
  }
  await sleep(500);
  for (const dir of made) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      console.error(`Could not remove ${dir}`);
    }
  }
}
process.exit(failed ? 1 : 0);
