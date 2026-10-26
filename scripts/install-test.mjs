// Install, use, upgrade in place, and uninstall the real installer.
//
//   node scripts/install-test.mjs <path-to-DayTracker-Setup.exe>
//
// The installer is run silently into a scratch folder (it is a per-user install,
// so it also adds an entry to the current user's list of installed programs,
// which the uninstall step removes). The application is started with a throwaway
// data directory, so the real profile is never touched.
//
//   1. install: files are in place and nothing mutable is beside the executable
//   2. the installed app starts without Java, Node, Maven or Docker on its path
//   3. upgrade: installing again over it keeps the user's data
//   4. uninstall: the program goes and the user's data stays

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const installer = path.resolve(process.argv[2] ?? '');
if (!existsSync(installer)) {
  console.error('Usage: node scripts/install-test.mjs <path-to-DayTracker-Setup.exe>');
  process.exit(2);
}
const PORT = 9666;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scratch = mkdtempSync(path.join(tmpdir(), 'daytracker-install-'));
const installDir = path.join(scratch, 'app');
const userData = path.join(scratch, 'profile');
const exe = path.join(installDir, 'Day Tracker.exe');

function check(condition, message) {
  if (!condition) {
    throw new Error(`CHECK FAILED: ${message}`);
  }
  console.log(`  ok  ${message}`);
}

function run(file, args) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
      resolve(-1);
    }, 240_000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve(-2);
    });
  });
}

const uninstallKey = () => {
  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', "Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | Get-ItemProperty | Where-Object { $_.InstallLocation -eq '" + installDir + "' -or $_.DisplayIcon -like '" + installDir + "*' } | Select-Object -ExpandProperty DisplayName; exit 0"],
      { encoding: 'utf8' },
    );
    return output.trim();
  } catch {
    return '';
  }
};

function filesUnder(dir, pattern) {
  const found = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (pattern.test(entry.name)) found.push(full);
    }
  };
  visit(dir);
  return found;
}

async function withApp(work) {
  const app = spawn(exe, [`--remote-debugging-port=${PORT}`], {
    env: { ...process.env, DAYTRACKER_USER_DATA: userData, DAYTRACKER_ALLOW_DEBUG_PORT: '1', PATH: process.env.SystemRoot + '\\System32' },
    stdio: 'ignore',
  });
  const exited = new Promise((resolve) => app.once('exit', resolve));
  let socket;
  for (let i = 0; i < 240 && !socket; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page) {
        socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.onopen = resolve;
          socket.onerror = reject;
        });
      }
    } catch {
      await sleep(250);
    }
  }
  if (!socket) throw new Error('Could not attach to the installed application.');
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };
  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (message) => (message.result.exceptionDetails ? reject(new Error(JSON.stringify(message.result.exceptionDetails))) : resolve(message.result.result.value)));
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  for (let i = 0; i < 240; i++) {
    // The page may still be loading, and the bridge appears with it.
    const state = await evaluate('window.dayTracker?.backend.getState()').catch(() => undefined);
    if (state?.status === 'ready') break;
    if (state?.status === 'failed') throw new Error(`The installed app failed to start: ${state.message}`);
    await sleep(250);
  }
  try {
    return await work(evaluate);
  } finally {
    void evaluate('void window.dayTracker.app.exit()').catch(() => undefined);
    await Promise.race([exited, sleep(30_000).then(() => app.kill())]);
    await sleep(1000);
  }
}

let failed = false;
const taskId = randomUUID();
try {
  console.log('1. Install');
  check((await run(installer, ['/S', `/D=${installDir}`])) === 0, 'the installer finished without error');
  check(existsSync(exe), 'the program is in the chosen folder');
  check(existsSync(path.join(installDir, 'resources', 'jre', 'bin', 'java.exe')), 'the Java runtime came with it');
  check(existsSync(path.join(installDir, 'resources', 'backend', 'backend.jar')), 'the backend came with it');
  check(uninstallKey() !== '', `it is listed among installed programs (${uninstallKey() || 'not found'})`);
  check(filesUnder(installDir, /\.(db|db-wal|db-shm)$/).length === 0, 'no database files are in the install folder');

  console.log('2. First start');
  await withApp(async (evaluate) => {
    const created = await evaluate(`window.dayTracker.tasks.create(${JSON.stringify({ id: taskId, title: 'Written before the upgrade' })})`);
    check(created.ok, 'the installed app starts with only Windows on its path and saves a task');
  });
  const databases = filesUnder(userData, /\.db$/);
  check(databases.length >= 1 && databases.every((file) => !file.startsWith(installDir)), 'the data is in the profile folder, not the install folder');

  console.log('3. Upgrade in place');
  const before = statSync(exe).mtimeMs;
  check((await run(installer, ['/S', `/D=${installDir}`])) === 0, 'installing over the existing copy finished without error');
  check(existsSync(exe) && statSync(exe).mtimeMs >= before, 'the program files were replaced');
  await withApp(async (evaluate) => {
    const listed = await evaluate('window.dayTracker.tasks.list()');
    check(listed.ok && listed.data.items.some((task) => task.id === taskId), 'the task written before the upgrade is still there');
  });

  console.log('4. Uninstall');
  const uninstaller = path.join(installDir, 'Uninstall Day Tracker.exe');
  check(existsSync(uninstaller), 'an uninstaller was installed');
  await run(uninstaller, ['/S', `_?=${installDir}`]);
  rmSync(uninstaller, { force: true });
  check(!existsSync(exe), 'the program is gone');
  check(uninstallKey() === '', 'it is no longer listed among installed programs');
  check(filesUnder(userData, /\.db$/).length >= 1, 'the data in the profile folder was kept');

  console.log('INSTALL TEST PASSED');
} catch (error) {
  failed = true;
  console.error(error.message);
  console.error('INSTALL TEST FAILED');
  // Never leave the test copy registered on this account.
  const uninstaller = path.join(installDir, 'Uninstall Day Tracker.exe');
  if (existsSync(uninstaller)) await run(uninstaller, ['/S', `_?=${installDir}`]);
} finally {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    console.error(`Could not remove ${scratch}`);
  }
}
process.exit(failed ? 1 : 0);
