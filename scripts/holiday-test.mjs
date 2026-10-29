// The holiday service against a fake Nager.Date on 127.0.0.1.
//
//   node scripts/holiday-test.mjs
//
// Needs the compiled desktop sources (npm run build in desktop/).

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { HolidayService } = createRequire(import.meta.url)(path.join(root, 'desktop', 'dist', 'holidays.js'));

const fake = { requests: [], down: false };
const server = createServer((request, response) => {
  fake.requests.push(request.url);
  if (fake.down) {
    response.writeHead(503).end();
    return;
  }
  const match = /^\/api\/v3\/PublicHolidays\/(\d{4})\/([A-Z]{2})$/.exec(request.url);
  if (!match) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(
    JSON.stringify([
      { date: `${match[1]}-11-15`, localName: 'Proclamação da República', name: 'Republic Day', global: true },
      { date: `${match[1]}-01-01`, localName: 'Confraternização Universal', name: "New Year's Day", global: true },
      { date: `${match[1]}-07-09`, localName: 'Revolução Constitucionalista', name: 'Constitutionalist Revolution', global: false, counties: ['BR-SP'] },
      { date: 'not a date', name: 'Broken', global: true },
    ]),
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const apiBase = `http://127.0.0.1:${server.address().port}/api/v3`;
const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dt-holidays-'));

let failures = 0;
function check(condition, message) {
  console.log(`${condition ? '  ok ' : ' FAIL'} ${message}`);
  if (!condition) failures += 1;
}

try {
  let clock = 1_000_000;
  const make = (country = async () => 'BR') => new HolidayService({ cacheDir, apiBase, country, now: () => clock });

  console.log('Fetching');
  const first = await make().list(2026);
  check(first.ok && first.data.map((h) => h.date).join(',') === '2026-01-01,2026-11-15', 'national holidays are listed in date order; regional and broken ones are left out');
  check(first.data[1].name === 'Republic Day' && first.data[1].localName === 'Proclamação da República', 'each has its English and local name');
  check(fake.requests.at(-1) === '/api/v3/PublicHolidays/2026/BR', 'only the year and the country are sent');

  console.log('Keeping');
  const sent = fake.requests.length;
  await make().list(2026);
  check(fake.requests.length === sent, 'a later start reads the list from disk instead of asking again');
  check((await readdir(cacheDir)).includes('holidays-BR-2026.json'), 'the list is kept per country and year');
  clock += 31 * 24 * 60 * 60_000;
  fake.down = true;
  const offline = await make().list(2026);
  check(offline.ok && offline.data.length === 2, 'after 30 days it asks again, and keeps the old list while the service is down');
  const missing = await make().list(2031);
  check(!missing.ok && missing.error.code === 'HOLIDAYS_UNAVAILABLE', 'with no list kept and the service down, it says so');
  fake.down = false;

  console.log('Country');
  const unknown = await make(async () => null).list(2026);
  check(!unknown.ok && unknown.error.code === 'COUNTRY_UNKNOWN' && unknown.error.message.includes('Language & region'), 'an unknown country says where to set it');
  const odd = await make(async () => '../x').list(2026);
  check(!odd.ok && odd.error.code === 'COUNTRY_UNKNOWN', 'anything but a two-letter code is refused before asking');
} catch (error) {
  failures += 1;
  console.error(error);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(cacheDir, { recursive: true, force: true });
}
console.log(failures === 0 ? 'HOLIDAY TEST PASSED' : `HOLIDAY TEST FAILED (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
