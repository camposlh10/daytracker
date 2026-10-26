import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../api/client';

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: T };

const LOADING = { status: 'loading' } as const;

/**
 * Loads data identified by `key`. A response is applied only if it belongs to the
 * most recent request, so a slow earlier read can never overwrite a newer one.
 * Changing `refresh` reloads the same key while keeping the current data on
 * screen; changing `key` never shows data that belongs to another key.
 */
export function useLoadable<T>(key: string, refresh: number, enabled: boolean, load: () => Promise<T>): Loadable<T> {
  const [state, setState] = useState<{ key: string; value: Loadable<T> }>({ key, value: LOADING });
  const latestLoad = useRef(load);
  latestLoad.current = load;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let current = true;
    latestLoad.current().then(
      (data) => {
        if (current) {
          setState({ key, value: { status: 'loaded', data } });
        }
      },
      (error: unknown) => {
        if (current) {
          setState({ key, value: { status: 'error', message: errorMessage(error) } });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [key, refresh, enabled]);

  return state.key === key ? state.value : LOADING;
}
