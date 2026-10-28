// Layout check of a packaged build at the minimum window size and at Windows
// display scales of 100%, 125% and 150%.
//
//   node scripts/layout-check.mjs <path-to-exe> [screenshot-directory]
//
// For every screen and every dialog it looks for horizontal overflow and for
// controls that are cut off or covered after being scrolled into view. The window
// is 1100 x 720 device-independent pixels, which is what Windows gives the page
// at any scale, so the scale changes the pixel density and the text rendering.
// The real profile is never touched.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const exe = process.argv[2];
const shots = process.argv[3];
if (!exe) {
  console.error('Usage: node scripts/layout-check.mjs <path-to-exe> [screenshot-directory]');
  process.exit(2);
}
if (shots) {
  mkdirSync(shots, { recursive: true });
}
const PORT = 9555;
// The minimum window size from the specification; other values only to prove the check can fail.
const WIDTH = Number(process.env.LAYOUT_WIDTH ?? 1100);
const HEIGHT = Number(process.env.LAYOUT_HEIGHT ?? 720);
const SCALES = (process.env.LAYOUT_SCALES ?? '1,1.25,1.5').split(',').map(Number);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const userData = mkdtempSync(path.join(tmpdir(), 'daytracker-layout-'));
const app = spawn(exe, [`--remote-debugging-port=${PORT}`], {
  env: { ...process.env, DAYTRACKER_USER_DATA: userData, DAYTRACKER_ALLOW_DEBUG_PORT: '1' },
  stdio: 'ignore',
});

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
let nextId = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  pending.get(message.id)?.(message);
  pending.delete(message.id);
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
async function evaluate(expression) {
  const message = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (message.result.exceptionDetails) {
    throw new Error(JSON.stringify(message.result.exceptionDetails));
  }
  return message.result.result.value;
}
async function screenshot(name) {
  if (!shots) {
    return;
  }
  await send('Page.bringToFront');
  await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await sleep(300);
  const message = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(path.join(shots, name), Buffer.from(message.result.data, 'base64'));
}

// Runs in the page: clicks the visible button with this label (a menu button's caret is ignored).
const clickButton = (label) =>
  evaluate(`(() => {
    const visible = (el) => el.offsetParent !== null && el.getClientRects().length > 0;
    const text = (b) => b.textContent.replace('\u25BE', '').trim();
    const button = [...document.querySelectorAll('button')].find((b) => visible(b) && text(b) === ${JSON.stringify(label)});
    if (!button) return false;
    button.click();
    return true;
  })()`);

// Runs in the page: picks a calendar view from the view menu.
const chooseView = (name) =>
  evaluate(`(() => {
    const toggle = document.querySelector('button[aria-haspopup=menu][aria-label*="calendar view"]');
    if (!toggle) return false;
    toggle.click();
    return new Promise((resolve) => setTimeout(() => {
      const item = [...document.querySelectorAll('[role=menuitemradio]')].find((el) => el.textContent.includes(${JSON.stringify(name)}));
      if (item) item.click();
      resolve(Boolean(item));
    }, 100));
  })()`);

const runStep = (step) => (typeof step === 'string' ? clickButton(step) : chooseView(step.view));
const stepName = (step) => (typeof step === 'string' ? step : `${step.view} view`);

// Runs in the page: what is cut off, covered or overflowing right now.
const INSPECT = `(() => {
  const problems = [];
  const w = window.innerWidth, h = window.innerHeight;
  const doc = document.documentElement;
  if (doc.scrollWidth > w + 1) problems.push('page scrolls sideways (' + doc.scrollWidth + ' > ' + w + ')');
  if (doc.scrollHeight > h + 1) problems.push('the page itself scrolls vertically (' + doc.scrollHeight + ' > ' + h + ')');
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && el.offsetParent !== null; };
  const scope = document.querySelector('[role=dialog]') ?? document.body;
  const controls = [...scope.querySelectorAll('button, input, select, textarea, a[href], [role=gridcell][tabindex], summary')].filter(visible);
  for (const el of controls) {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const name = (el.getAttribute('aria-label') || el.textContent || el.id || el.name || el.tagName).trim().slice(0, 40);
    if (r.left < -1 || r.right > w + 1) { problems.push('"' + name + '" is outside the window sideways'); continue; }
    if (r.top < -1 || r.bottom > h + 1) { problems.push('"' + name + '" cannot be scrolled fully into view'); continue; }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 12));
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) problems.push('"' + name + '" is covered by <' + hit.tagName.toLowerCase() + '>');
  }
  const dialog = document.querySelector('[role=dialog]');
  if (dialog) {
    const r = dialog.getBoundingClientRect();
    if (r.top < -1 || r.bottom > h + 1 || r.left < -1 || r.right > w + 1) problems.push('the dialog does not fit the window (' + Math.round(r.width) + 'x' + Math.round(r.height) + ')');
    const actions = [...dialog.querySelectorAll('button')].filter(visible).slice(-1)[0];
    if (actions) { const a = actions.getBoundingClientRect(); if (a.bottom > h + 1) problems.push('the dialog buttons are below the window'); }
  }
  return problems;
})()`;

const scenes = [
  { name: 'calendar-month', steps: [{ view: 'Month' }] },
  { name: 'calendar-week', steps: [{ view: 'Week' }] },
  { name: 'calendar-day', steps: [{ view: 'Day' }] },
  // The open menu must fit in the window; clicking the button again closes it.
  { name: 'calendar-create-menu', steps: ['+ Create'], after: ['+ Create'] },
  { name: 'calendar-add-forms', steps: [{ view: 'Month' }, '+ Appointment', '+ Review'] },
  { name: 'tasks', nav: 'Tasks', steps: [] },
  { name: 'dialog-new-task', nav: 'Tasks', steps: ['+ New task'], dialog: true },
  { name: 'dialog-categories', nav: 'Tasks', steps: ['Categories'], dialog: true },
  { name: 'reading', nav: 'Reading', steps: [] },
  { name: 'dialog-add-book', nav: 'Reading', steps: ['+ Add book'], dialog: true },
  { name: 'dialog-log-reading', nav: 'Reading', steps: ['Log reading'], dialog: true },
  { name: 'progress', nav: 'Progress', steps: [] },
  { name: 'music', nav: 'Music', steps: [] },
  { name: 'settings', nav: 'Settings', steps: [] },
  { name: 'dialog-reading-target', nav: 'Settings', steps: ['Change target'], dialog: true },
];

let failed = false;
const report = [];
try {
  for (let i = 0; i < 240; i++) {
    if ((await evaluate('window.dayTracker.backend.getState()')).status === 'ready') break;
    await sleep(250);
  }
  const call = (expr, ...args) => evaluate(`window.dayTracker.${expr}(${args.map((a) => JSON.stringify(a)).join(',')})`);
  const now = new Date();
  const day = (offset) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // Enough content that nothing is empty.
  const bookId = randomUUID();
  await call('books.create', { id: bookId, title: 'A fairly long book title that has to wrap somewhere sensible', author: 'Someone With A Long Name', totalPages: 500, status: 'READING' });
  await call('readingSessions.create', { id: randomUUID(), bookId, activityDate: day(-1), pagesRead: 40, endingPage: 40 });
  for (let n = 0; n < 6; n++) {
    const id = randomUUID();
    await call('tasks.create', { id, title: `Task number ${n + 1} with a reasonably descriptive title`, plannedDate: day(n % 3 - 1) });
    if (n % 2) await call('tasks.update', id, { version: 1, status: 'DONE' });
  }
  await call('events.create', { id: randomUUID(), title: 'Team meeting', allDay: false, start: `${day(0)}T10:00`, end: `${day(0)}T11:00`, timezone: 'America/Sao_Paulo' });
  await evaluate('location.reload()');
  await sleep(4000);

  for (const scale of SCALES) {
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: scale, mobile: false });
    await sleep(500);
    for (const scene of scenes) {
      await evaluate('document.activeElement?.blur()');
      if (scene.nav) await clickButton(scene.nav); else await clickButton('Calendar');
      await sleep(400);
      for (const step of scene.steps) {
        if (!(await runStep(step))) console.log(`        (no "${stepName(step)}" button on this screen; skipped)`);
        await sleep(300);
      }
      await sleep(300);
      const problems = await evaluate(INSPECT);
      const label = `${Math.round(scale * 100)}% ${scene.name}`;
      report.push({ label, problems });
      console.log(`${problems.length === 0 ? '  ok ' : ' FAIL'} ${label}${problems.length ? '\n        ' + problems.join('\n        ') : ''}`);
      if (problems.length) failed = true;
      if (scale === SCALES[SCALES.length - 1]) await screenshot(`${scene.name}-150.png`);
      for (const step of scene.after ?? []) {
        await runStep(step);
        await sleep(200);
      }
      if (scene.dialog) {
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelector('[role=dialog]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        await sleep(300);
      }
    }
  }
  console.log(failed ? 'LAYOUT CHECK FAILED' : 'LAYOUT CHECK PASSED');
} catch (error) {
  failed = true;
  console.error(error.message);
  console.error('LAYOUT CHECK FAILED');
} finally {
  void evaluate('void window.dayTracker.app.exit()').catch(() => undefined);
  await sleep(4000);
  app.kill();
  rmSync(userData, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
