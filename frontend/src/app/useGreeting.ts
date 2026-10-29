import { useEffect, useState } from 'react';
import { minutesOfDay } from '../lib/dates';

/** Good morning (5:00 to 11:59), good afternoon (12:00 to 17:59), or good night. */
export function greetingAt(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  if (hour >= 5 && hour < 12) {
    return 'Good morning';
  }
  return hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good night';
}

/**
 * The greeting for now, by the clock in the timezone chosen in Settings (the one
 * the app displays times in). Checked again every minute.
 */
export function useGreeting(): string {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return greetingAt(minutesOfDay(now));
}
