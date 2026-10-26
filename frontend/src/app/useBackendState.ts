import { useEffect, useState } from 'react';
import { bridge, type BackendState } from '../api/bridge';

/** Backend lifecycle, kept apart from user data so a failure never looks like empty data. */
export function useBackendState(): BackendState {
  const [state, setState] = useState<BackendState>({ status: 'starting' });

  useEffect(() => {
    let changed = false;
    const unsubscribe = bridge().backend.onStateChange((next) => {
      changed = true;
      setState(next);
    });
    void bridge()
      .backend.getState()
      .then((current) => {
        // A pushed change is newer than this initial snapshot.
        if (!changed) {
          setState(current);
        }
      });
    return unsubscribe;
  }, []);

  return state;
}
