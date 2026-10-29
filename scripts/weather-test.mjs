// The weather service against a fake Open-Meteo on 127.0.0.1 and a fake location.
//
//   node scripts/weather-test.mjs
//
// Needs the compiled desktop sources (npm run build in desktop/).

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { WeatherService } = createRequire(import.meta.url)(path.join(root, 'desktop', 'dist', 'weather.js'));

const fake = { requests: [], fail: false };
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  fake.requests.push(url);
  if (fake.fail || url.pathname !== '/v1/forecast') {
    response.writeHead(500).end();
    return;
  }
  response
    .writeHead(200, { 'Content-Type': 'application/json' })
    .end(JSON.stringify({ current: { temperature_2m: 21.64, weather_code: 61, is_day: 0 } }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const forecastBase = `http://127.0.0.1:${server.address().port}/v1`;

let failures = 0;
function check(condition, message) {
  console.log(`${condition ? '  ok ' : ' FAIL'} ${message}`);
  if (!condition) failures += 1;
}

try {
  let clock = 1_000_000;
  let locates = 0;
  const here = { ok: true, latitude: -23.550520123, longitude: -46.633308456 };
  const service = new WeatherService({ forecastBase, now: () => clock, locate: async () => (locates++, here) });

  console.log('Fetching');
  const first = await service.current();
  check(first.ok && first.data.temperatureC === 21.6 && first.data.preferredUnit === 'C' && first.data.code === 61 && first.data.isDay === false, 'the weather is read in Celsius, to one decimal');
  const sent = fake.requests.at(-1).searchParams;
  check(sent.get('latitude') === '-23.55' && sent.get('longitude') === '-46.63', 'only coordinates rounded to two decimals are sent');
  check([...sent.keys()].sort().join(',') === 'current,latitude,longitude,timezone', 'nothing else is sent');

  console.log('Caching');
  const before = fake.requests.length;
  clock += 10 * 60_000;
  await service.current();
  check(fake.requests.length === before, 'within 15 minutes the last answer is reused');
  clock += 6 * 60_000;
  await Promise.all([service.current(), service.current()]);
  check(fake.requests.length === before + 1 && locates === 1, 'after 15 minutes it asks again once, without locating again within the hour');

  console.log('Units and failures');
  const american = new WeatherService({ forecastBase, usMeasurements: true, locate: async () => here });
  const f = await american.current();
  check(f.ok && f.data.preferredUnit === 'F' && f.data.temperatureC === 21.6, 'US measurements in Windows suggest Fahrenheit, still sent in Celsius');
  const off = await new WeatherService({ forecastBase, locate: async () => ({ ok: false, reason: 'off' }) }).current();
  check(!off.ok && off.error.code === 'LOCATION_OFF' && off.error.message.includes('Privacy & security'), 'location turned off in Windows says where to turn it on');
  const unknown = await new WeatherService({ forecastBase, locate: async () => ({ ok: false, reason: 'unknown' }) }).current();
  check(!unknown.ok && unknown.error.code === 'LOCATION_UNKNOWN', 'an unknown location is explained');
  fake.fail = true;
  const down = await new WeatherService({ forecastBase, locate: async () => here }).current();
  check(!down.ok && down.error.code === 'WEATHER_UNAVAILABLE', 'a failing weather service is explained');
} catch (error) {
  failures += 1;
  console.error(error);
} finally {
  // Open keep-alive connections would hold the server open; closing them lets Node exit by itself.
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
console.log(failures === 0 ? 'WEATHER TEST PASSED' : `WEATHER TEST FAILED (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
