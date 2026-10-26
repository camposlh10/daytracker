import { useEffect, useState } from 'react';
import { todayIso, type IsoDate } from '../lib/dates';

const CHECK_INTERVAL_MS = 30_000;

/**
 * Today's date in the display timezone, kept current when the app stays open
 * past midnight and recomputed at once when the timezone setting changes.
 */
export function useToday(timeZone?: string): IsoDate {
  const [today, setToday] = useState(() => todayIso());
  const [zone, setZone] = useState(timeZone);

  // A new timezone changes the date in the same render, so no screen mounts with the old one.
  if (zone !== timeZone) {
    setZone(timeZone);
    setToday(todayIso());
  }

  useEffect(() => {
    const timer = setInterval(() => setToday(todayIso()), CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return today;
}
