import { useState } from 'react';
import { settingsApi } from '../api/client';
import type { AppSettings, UpdateSettingsInput } from '../api/bridge';
import { DEFAULT_WEEK_START, setDisplayPrefs, type WeekStart } from '../lib/dates';
import { useLoadable, type Loadable } from './useLoadable';

export interface SettingsState {
  /** Null until loaded (or when they could not be loaded). */
  settings: AppSettings | null;
  /** True once loading has finished, successfully or not. */
  settled: boolean;
  weekStart: WeekStart;
  save(input: UpdateSettingsInput): Promise<AppSettings>;
}

function settledState(load: Loadable<AppSettings>): boolean {
  return load.status !== 'loading';
}

/**
 * The stored settings. The timezone and clock style are applied to every date
 * and time shown, in the same render that receives them.
 */
export function useSettings(backendReady: boolean): SettingsState {
  const loaded = useLoadable('settings', 0, backendReady, () => settingsApi.get());
  // A saved change is shown at once; it is also what a later reload would return.
  const [saved, setSaved] = useState<AppSettings | null>(null);
  const settings = saved ?? (loaded.status === 'loaded' ? loaded.data : null);

  if (settings) {
    setDisplayPrefs({ timeZone: settings.timezone, hourCycle: settings.timeFormat === 'H24' ? 'h23' : 'h12' });
  }

  const save = async (input: UpdateSettingsInput): Promise<AppSettings> => {
    const updated = await settingsApi.update(input);
    setSaved(updated);
    return updated;
  };

  return {
    settings,
    settled: saved !== null || settledState(loaded),
    weekStart: (settings?.weekStart ?? DEFAULT_WEEK_START) as WeekStart,
    save,
  };
}
