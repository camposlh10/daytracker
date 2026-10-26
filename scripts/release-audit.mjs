// Audit of a packaged build against the release criteria that can be checked from files.
//
//   node scripts/release-audit.mjs [path-to-win-unpacked]
//
// "No embedded sample records, credentials, debug tokens, or placeholder actions
// remain in production", and the licence notices the specification asks for.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.resolve(process.argv[2] ?? path.join(root, 'desktop', 'release', 'win-unpacked'));
let failures = 0;
// Windows' own tar reads zip files such as the jar; another tar on the path may not.
const TAR = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe');

function check(condition, message) {
  console.log(`${condition ? '  ok ' : ' FAIL'} ${message}`);
  if (!condition) {
    failures += 1;
  }
}

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, visit);
    } else {
      visit(full);
    }
  }
}

if (!existsSync(app)) {
  console.error(`Not found: ${app}`);
  process.exit(2);
}
const resources = path.join(app, 'resources');

console.log('Files shipped');
const stray = [];
walk(app, (file) => {
  if (/\.(db|db-wal|db-shm|log|env|pem|key|pfx)$/i.test(file)) {
    stray.push(path.relative(app, file));
  }
});
check(stray.length === 0, `no database, log, key, or environment files in the package${stray.length ? `: ${stray.join(', ')}` : ''}`);

console.log('Backend jar');
const jar = path.join(resources, 'backend', 'backend.jar');
check(existsSync(jar), 'the backend jar is outside any archive, in resources/backend');
const entries = execFileSync(TAR, ['-tf', path.basename(jar)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: path.dirname(jar) }).split(/\r?\n/);
check(!entries.some((entry) => /(^|\/)[^/]*Test[^/]*\.class$/.test(entry) && entry.startsWith('BOOT-INF/classes/com/daytracker/')), 'no test classes in the jar');
check(!entries.some((entry) => /\.(db|sqlite)$/.test(entry)), 'no database file inside the jar');
check(entries.filter((entry) => /^BOOT-INF\/classes\/db\/migration\/V\d+__.*\.sql$/.test(entry)).length >= 3, 'the migration scripts are in the jar');
const properties = execFileSync(TAR, ['-xOf', path.basename(jar), 'BOOT-INF/classes/application.properties'], { encoding: 'utf8', cwd: path.dirname(jar) });
const settings = properties.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'));
check(settings.every((line) => !/password|secret/i.test(line)), 'application.properties holds no password or secret');
check(settings.filter((line) => /token/i.test(line)).every((line) => /=\$\{DAYTRACKER_TOKEN:\}$/.test(line)), 'the launch token is only ever read from the environment');
check(!/server\.address\s*=\s*0\.0\.0\.0/.test(properties), 'the backend is not configured to listen on all interfaces');

console.log('Interface and shell');
const renderer = path.join(app, 'resources', 'app', 'renderer');
const rendererDir = existsSync(renderer) ? renderer : path.join(app, 'resources', 'app', 'renderer');
const index = readFileSync(path.join(rendererDir, 'index.html'), 'utf8').replaceAll('&#39;', "'");
check(/Content-Security-Policy/i.test(index) && /connect-src 'none'/.test(index) && /default-src 'none'|default-src 'self'/.test(index), 'the page carries a restrictive content security policy');
let scripts = '';
walk(rendererDir, (file) => {
  if (/\.(js|css|html)$/.test(file)) {
    scripts += readFileSync(file, 'utf8');
  }
});
check(!/localhost:5173|127\.0\.0\.1:5173/.test(scripts), 'no development server address in the built interface');
check(!/test-launch-token|sample data|lorem ipsum|TODO|FIXME/i.test(scripts), 'no placeholder text or test tokens in the built interface');
const main = readFileSync(path.join(app, 'resources', 'app', 'dist', 'main.js'), 'utf8');
check(/nodeIntegration:\s*false/.test(main) && /contextIsolation:\s*true/.test(main) && /sandbox:\s*true/.test(main), 'node integration off, context isolation and sandbox on');
check(/devTools:\s*isDev/.test(main), 'developer tools are off in the released app');
check(/--\(remote-debugging\|inspect\)/.test(main), 'the released app refuses a debugging port');

console.log('Licence notices');
check(existsSync(path.join(resources, 'jre', 'legal')) && existsSync(path.join(resources, 'jre', 'release')), 'the Java runtime ships with its legal notices');
check(existsSync(path.join(app, 'LICENSE.electron.txt')) && existsSync(path.join(app, 'LICENSES.chromium.html')), 'the Electron and Chromium licences ship with the app');
const size = (dir) => {
  let total = 0;
  walk(dir, (file) => (total += statSync(file).size));
  return total;
};
console.log(`      installed size: ${(size(app) / 1024 / 1024).toFixed(0)} MB (runtime ${(size(path.join(resources, 'jre')) / 1024 / 1024).toFixed(0)} MB)`);

console.log(failures === 0 ? 'RELEASE AUDIT PASSED' : `RELEASE AUDIT FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
