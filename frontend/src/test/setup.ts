import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { forgetHolidays } from '../features/calendar/holidays';
import { setDisplayPrefs } from '../lib/dates';

configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
  // Display preferences are module state; one test's timezone must not reach the next.
  setDisplayPrefs({});
  forgetHolidays();
  // So is what the page remembers, such as the calendar's zoom.
  window.localStorage.clear();
});
