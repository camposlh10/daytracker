import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, isCancelled, spotifyApi } from '../../api/client';
import type { SpotifyPlayback, SpotifyStatus } from '../../api/bridge';

const POLL_MS = 5_000;

/** What the app suggests registering; the user may register another accepted form. */
export const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:43821/callback';
// Spotify takes a moment to report a change it has just accepted.
const SETTLE_MS = 700;

export interface SpotifyState {
  /** Null while the first status is loading. */
  status: SpotifyStatus | null;
  playback: SpotifyPlayback | null;
  /** The last failure, in words for the user; null when there is none. */
  problem: string | null;
  busy: boolean;
  clearProblem(): void;
  setStatus(status: SpotifyStatus): void;
  /**
   * Runs a Spotify action, shows its failure (a cancelled sign-in is not one), and
   * reads what is playing again. Resolves to the action's result, or undefined.
   */
  run<T>(action: () => Promise<T>): Promise<T | undefined>;
  refreshPlayback(): void;
}

/**
 * Spotify status and what is playing. Asks Spotify only while connected, and only
 * while the window is visible, every few seconds.
 */
export function useSpotify(): SpotifyState {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [playback, setPlayback] = useState<SpotifyPlayback | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const connected = status?.connected === true;

  const refreshPlayback = useCallback(() => {
    const id = ++request.current;
    spotifyApi.playback().then(
      (current) => {
        if (id === request.current) setPlayback(current);
      },
      () => {
        // A failed poll is not worth a message; the next one may work.
      },
    );
  }, []);

  // A refresh scheduled after an action must not outlive the screen.
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  useEffect(() => {
    spotifyApi.status().then(setStatus, (error: unknown) => {
      setStatus({ clientId: null, redirectUri: DEFAULT_REDIRECT_URI, connected: false, displayName: null });
      setProblem(errorMessage(error));
    });
  }, []);

  useEffect(() => {
    if (!connected) {
      setPlayback(null);
      return;
    }
    refreshPlayback();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshPlayback();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [connected, refreshPlayback]);

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setProblem(null);
      try {
        return await action();
      } catch (error) {
        if (!isCancelled(error)) setProblem(errorMessage(error));
        return undefined;
      } finally {
        setBusy(false);
        if (connected) {
          clearTimeout(settleTimer.current);
          settleTimer.current = setTimeout(refreshPlayback, SETTLE_MS);
        }
      }
    },
    [connected, refreshPlayback],
  );

  return {
    status,
    playback,
    problem,
    busy,
    clearProblem: () => setProblem(null),
    setStatus,
    run,
    refreshPlayback,
  };
}
