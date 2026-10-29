import { execFile } from 'node:child_process';
import path from 'node:path';
import type { ApiResult, Weather } from './shared/bridge-types';

/**
 * The weather where this computer is. The place comes from Windows' own location
 * service (Settings, Privacy & security, Location), the same one the Weather and
 * Maps apps use; the forecast comes from Open-Meteo, which needs no account. Only
 * the coordinates, rounded to about a kilometre, leave this computer.
 */

export interface WeatherOptions {
  /** Where this computer is, or why it is not known. */
  locate?(): Promise<Located>;
  forecastBase?: string;
  /** True when Windows' regional format uses US measurements, so °F is suggested. */
  usMeasurements?: boolean;
  now?(): number;
}

export type Located = { ok: true; latitude: number; longitude: number } | { ok: false; reason: 'off' | 'unknown' };

const WEATHER_TTL_MS = 15 * 60_000;
const LOCATION_TTL_MS = 60 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Asks Windows for this computer's location through .NET's GeoCoordinateWatcher,
 * which respects the location privacy switches. The script is fixed text.
 */
const LOCATE_SCRIPT = `
Add-Type -AssemblyName System.Device
$w = New-Object System.Device.Location.GeoCoordinateWatcher
[void]$w.TryStart($false, [TimeSpan]::FromSeconds(10))
$deadline = (Get-Date).AddSeconds(15)
while ($w.Position.Location.IsUnknown -and $w.Permission -ne 'Denied' -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
$l = $w.Position.Location
if ($w.Permission -eq 'Denied') { '{"reason":"off"}' }
elseif ($l.IsUnknown) { '{"reason":"unknown"}' }
else { '{"latitude":' + $l.Latitude.ToString([Globalization.CultureInfo]::InvariantCulture) + ',"longitude":' + $l.Longitude.ToString([Globalization.CultureInfo]::InvariantCulture) + '}' }
$w.Stop()
`;

/** Whether Windows' regional format uses US measurements (iMeasure 1), read once. */
export function usesUsMeasurements(): Promise<boolean> {
  const reg = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe');
  return new Promise((resolve) => {
    execFile(reg, ['query', 'HKCU\\Control Panel\\International', '/v', 'iMeasure'], { windowsHide: true, timeout: 5_000 }, (error, stdout) =>
      resolve(!error && /iMeasure\s+REG_SZ\s+1/.test(stdout)),
    );
  });
}

export function locateWithWindows(): Promise<Located> {
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve) => {
    execFile(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', LOCATE_SCRIPT],
      { windowsHide: true, timeout: 30_000 },
      (error, stdout) => {
        if (error) {
          resolve({ ok: false, reason: 'unknown' });
          return;
        }
        try {
          const answer = JSON.parse(stdout.trim()) as { latitude?: unknown; longitude?: unknown; reason?: unknown };
          if (typeof answer.latitude === 'number' && typeof answer.longitude === 'number') {
            resolve({ ok: true, latitude: answer.latitude, longitude: answer.longitude });
          } else {
            resolve({ ok: false, reason: answer.reason === 'off' ? 'off' : 'unknown' });
          }
        } catch {
          resolve({ ok: false, reason: 'unknown' });
        }
      },
    );
  });
}

function fail(code: string, message: string): ApiResult<never> {
  return { ok: false, error: { status: 0, code, message } };
}

export class WeatherService {
  private readonly forecastBase: string;
  private readonly now: () => number;
  private location: { value: Located; at: number } | null = null;
  private weather: { value: Weather; at: number } | null = null;
  private pending: Promise<ApiResult<Weather>> | null = null;

  constructor(private readonly options: WeatherOptions = {}) {
    this.forecastBase = options.forecastBase ?? 'https://api.open-meteo.com/v1';
    this.now = options.now ?? Date.now;
  }

  /** The current weather, asked again at most every 15 minutes. */
  current(): Promise<ApiResult<Weather>> {
    if (this.weather && this.now() - this.weather.at < WEATHER_TTL_MS) {
      return Promise.resolve({ ok: true, data: this.weather.value });
    }
    // Calls that arrive while one is under way share its answer.
    this.pending ??= this.fetchCurrent().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async fetchCurrent(): Promise<ApiResult<Weather>> {
    if (!this.location || this.now() - this.location.at >= LOCATION_TTL_MS || !this.location.value.ok) {
      this.location = { value: await (this.options.locate ?? locateWithWindows)(), at: this.now() };
    }
    const place = this.location.value;
    if (!place.ok) {
      return place.reason === 'off'
        ? fail(
            'LOCATION_OFF',
            'Location is off for desktop apps. Turn it on in Windows Settings, Privacy & security, Location, to see the weather here.',
          )
        : fail('LOCATION_UNKNOWN', 'Windows does not know where this computer is right now.');
    }
    // Two decimals: about a kilometre, enough for the weather and no more.
    const query = new URLSearchParams({
      latitude: place.latitude.toFixed(2),
      longitude: place.longitude.toFixed(2),
      current: 'temperature_2m,weather_code,is_day',
      timezone: 'auto',
    });
    let data: { current?: { temperature_2m?: unknown; weather_code?: unknown; is_day?: unknown } };
    try {
      const response = await fetch(`${this.forecastBase}/forecast?${query}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        return fail('WEATHER_UNAVAILABLE', 'The weather service did not answer.');
      }
      data = (await response.json()) as typeof data;
    } catch {
      return fail('WEATHER_UNAVAILABLE', 'The weather could not be fetched. Check the internet connection.');
    }
    const current = data.current;
    if (!current || typeof current.temperature_2m !== 'number' || typeof current.weather_code !== 'number') {
      return fail('WEATHER_UNAVAILABLE', 'The weather service gave an answer that could not be read.');
    }
    const weather: Weather = {
      temperatureC: Math.round(current.temperature_2m * 10) / 10,
      preferredUnit: this.options.usMeasurements ? 'F' : 'C',
      code: current.weather_code,
      isDay: current.is_day !== 0,
    };
    this.weather = { value: weather, at: this.now() };
    return { ok: true, data: weather };
  }
}
