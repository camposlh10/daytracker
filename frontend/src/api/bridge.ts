import type { DayTrackerBridge } from '../../../desktop/src/shared/bridge-types';

export type * from '../../../desktop/src/shared/bridge-types';

declare global {
  interface Window {
    /** Installed by the Electron preload script. */
    dayTracker: DayTrackerBridge;
  }
}

export function bridge(): DayTrackerBridge {
  return window.dayTracker;
}
