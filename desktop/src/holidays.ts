import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ApiResult, Holiday } from './shared/bridge-types';

/**
 * Public holidays for the country set as the home location in Windows (Settings,
 * Time & language, Language & region, Country or region), from Nager.Date, a free
 * public-holiday service that needs no account. Only the country and the year are
 * sent. Each year's list is kept on disk for 30 days, so the calendar keeps
 * showing holidays offline.
 */

export interface HolidayOptions {
  /** Where the lists are kept between runs. */
  cacheDir: string;
  /** The two-letter country, or null when it is not known. */
  country?(): Promise<string | null>;
  apiBase?: string;
  now?(): number;
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const COUNTRY = /^[A-Z]{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The home location's two-letter code, from HKCU\Control Panel\International\Geo. */
export function windowsCountry(): Promise<string | null> {
  const reg = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe');
  return new Promise((resolve) => {
    execFile(reg, ['query', 'HKCU\\Control Panel\\International\\Geo', '/v', 'Name'], { windowsHide: true, timeout: 5_000 }, (error, stdout) => {
      const code = /Name\s+REG_SZ\s+([A-Za-z]{2})\s*$/m.exec(stdout ?? '')?.[1]?.toUpperCase() ?? null;
      resolve(error ? null : code);
    });
  });
}

function fail(code: string, message: string): ApiResult<never> {
  return { ok: false, error: { status: 0, code, message } };
}

export class HolidayService {
  private readonly apiBase: string;
  private readonly now: () => number;
  private country: Promise<string | null> | null = null;
  private readonly memory = new Map<string, Holiday[]>();

  constructor(private readonly options: HolidayOptions) {
    this.apiBase = options.apiBase ?? 'https://date.nager.at/api/v3';
    this.now = options.now ?? Date.now;
  }

  /** The national holidays of a year, in date order. */
  async list(year: number): Promise<ApiResult<Holiday[]>> {
    this.country ??= (this.options.country ?? windowsCountry)();
    const country = await this.country;
    if (!country || !COUNTRY.test(country)) {
      this.country = null;
      return fail('COUNTRY_UNKNOWN', 'Set your country in Windows Settings, Time & language, Language & region, to see holidays.');
    }
    const key = `${country}-${year}`;
    const remembered = this.memory.get(key);
    if (remembered) {
      return { ok: true, data: remembered };
    }
    const file = path.join(this.options.cacheDir, `holidays-${key}.json`);
    const cached = await this.readCache(file);
    if (cached && this.now() - cached.savedAt < CACHE_TTL_MS) {
      this.memory.set(key, cached.holidays);
      return { ok: true, data: cached.holidays };
    }
    const fetched = await this.fetchYear(country, year);
    if (!fetched.ok) {
      // An old list is better than none while offline.
      if (cached) {
        this.memory.set(key, cached.holidays);
        return { ok: true, data: cached.holidays };
      }
      return fetched;
    }
    this.memory.set(key, fetched.data);
    await mkdir(this.options.cacheDir, { recursive: true }).catch(() => undefined);
    await writeFile(file, JSON.stringify({ savedAt: this.now(), holidays: fetched.data })).catch(() => undefined);
    return fetched;
  }

  private async fetchYear(country: string, year: number): Promise<ApiResult<Holiday[]>> {
    let data: unknown;
    try {
      const response = await fetch(`${this.apiBase}/PublicHolidays/${year}/${country}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 404 || response.status === 204) {
        return { ok: true, data: [] };
      }
      if (!response.ok) {
        return fail('HOLIDAYS_UNAVAILABLE', 'The holiday service did not answer.');
      }
      data = await response.json();
    } catch {
      return fail('HOLIDAYS_UNAVAILABLE', 'Holidays could not be fetched. Check the internet connection.');
    }
    if (!Array.isArray(data)) {
      return fail('HOLIDAYS_UNAVAILABLE', 'The holiday service gave an answer that could not be read.');
    }
    const holidays: Holiday[] = [];
    for (const entry of data as Record<string, unknown>[]) {
      // Holidays of only some states or regions are left out: the region is not known.
      if (entry?.global === false || typeof entry?.date !== 'string' || !DATE.test(entry.date)) {
        continue;
      }
      const name = typeof entry.name === 'string' ? entry.name.slice(0, 120) : '';
      const localName = typeof entry.localName === 'string' ? entry.localName.slice(0, 120) : name;
      if (name && !holidays.some((holiday) => holiday.date === entry.date && holiday.name === name)) {
        holidays.push({ date: entry.date, name, localName });
      }
    }
    holidays.sort((a, b) => a.date.localeCompare(b.date));
    return { ok: true, data: holidays };
  }

  private async readCache(file: string): Promise<{ savedAt: number; holidays: Holiday[] } | null> {
    try {
      const saved = JSON.parse(await readFile(file, 'utf8')) as { savedAt?: unknown; holidays?: unknown };
      if (typeof saved.savedAt !== 'number' || !Array.isArray(saved.holidays)) {
        return null;
      }
      const holidays = (saved.holidays as Holiday[]).filter(
        (holiday) => typeof holiday?.date === 'string' && DATE.test(holiday.date) && typeof holiday.name === 'string',
      );
      return { savedAt: saved.savedAt, holidays };
    } catch {
      return null;
    }
  }
}
