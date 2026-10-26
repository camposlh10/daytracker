import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setDisplayPrefs } from '../lib/dates';

configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
  // Display preferences are module state; one test's timezone must not reach the next.
  setDisplayPrefs({});
});
