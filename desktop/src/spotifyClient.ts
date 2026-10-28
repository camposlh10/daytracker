import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  ApiResult,
  SpotifyDevice,
  SpotifyPlayback,
  SpotifyPlayInput,
  SpotifyPlaylist,
  SpotifySearchResult,
  SpotifyStatus,
  SpotifyTrack,
} from './shared/bridge-types';

/**
 * Spotify, controlled from the main process. The page never sees a token: it asks
 * for an operation, and this class talks to Spotify with the user's access token.
 *
 * Sign-in uses the authorization code flow with PKCE, which needs no client secret:
 * the user's browser opens Spotify's own sign-in page, and Spotify sends the browser
 * back to the redirect URI registered for the user's app, with a code that is
 * exchanged for tokens. The redirect URI is the user's choice, because Spotify's
 * dashboard has changed which forms it accepts: a loopback address answered by a
 * one-time listener (http://127.0.0.1:PORT/path or http://[::1]:PORT/path, the port
 * optional), an app link (daytracker://path) that Windows hands to this app, or an
 * https address of the user's own Day Tracker server, whose /spotify/callback page
 * passes the answer on to the loopback listener (the port rides in the state).
 * Only the refresh token is kept, encrypted by the store.
 *
 * Playback is Spotify Connect: it starts, pauses, and skips on one of the user's
 * Spotify devices (the desktop app, a phone, a speaker). Spotify allows playback
 * control for Premium accounts only.
 */

export interface StoredSpotify {
  clientId: string | null;
  /** Exactly as registered in the Spotify dashboard; null means the default. */
  redirectUri: string | null;
  refreshToken: string | null;
}

export const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:43821/callback';

export type Redirect =
  | { kind: 'loopback'; host: '127.0.0.1' | '::1'; port: number; path: string; uri: string }
  | { kind: 'scheme'; scheme: string; uri: string }
  | { kind: 'relay'; uri: string };

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?(\/[A-Za-z0-9._~\/-]*)?$/;
// The user's own server, which relays the answer to this computer (see SpotifyRelayController).
const RELAY = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/[A-Za-z0-9._~\/-]*$/;
const APP_LINK = /^([a-z][a-z0-9+.-]{2,40}):\/\/[A-Za-z0-9._~\/-]*$/;
// Schemes that belong to browsers, the system, or Spotify itself.
const RESERVED_SCHEMES = new Set(['http', 'https', 'file', 'ftp', 'javascript', 'data', 'about', 'blob', 'mailto', 'spotify', 'ms-settings']);

/** What kind of redirect URI this is, or null when Day Tracker cannot receive it. */
export function parseRedirect(uri: string): Redirect | null {
  const loopback = LOOPBACK.exec(uri);
  if (loopback) {
    const port = loopback[2] === undefined ? 0 : Number(loopback[2]);
    if (port > 65535) {
      return null;
    }
    return { kind: 'loopback', host: loopback[1] === '[::1]' ? '::1' : '127.0.0.1', port, path: loopback[3] ?? '/', uri };
  }
  if (RELAY.test(uri)) {
    return { kind: 'relay', uri };
  }
  const link = APP_LINK.exec(uri);
  if (link && !RESERVED_SCHEMES.has(link[1])) {
    return { kind: 'scheme', scheme: link[1], uri };
  }
  return null;
}

export interface SpotifyStore {
  load(): Promise<StoredSpotify>;
  save(data: StoredSpotify): Promise<void>;
}

export interface SpotifyOptions {
  store: SpotifyStore;
  /** Opens Spotify's sign-in page in the user's browser. */
  openBrowser(url: string): Promise<void>;
  /** Makes Windows hand links with this scheme to the app; undefined where that is not possible. */
  registerScheme?(scheme: string): void;
  accountsBase?: string;
  apiBase?: string;
  loginTimeoutMs?: number;
}

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
].join(' ');
const CLIENT_ID = /^[0-9a-fA-F]{32}$/;
const IMAGE_URL = /^https:\/\/i\.scdn\.co\/image\/([0-9a-f]{40})$/;
const REQUEST_TIMEOUT_MS = 10_000;
// Development-mode apps may ask for at most 10 search results.
const SEARCH_LIMIT = 10;

type Json = Record<string, unknown>;

function fail(status: number, code: string, message: string): ApiResult<never> {
  return { ok: false, error: { status, code, message } };
}

const base64url = (bytes: Buffer) => bytes.toString('base64url');

export class SpotifyClient {
  private readonly accountsBase: string;
  private readonly apiBase: string;
  private readonly loginTimeoutMs: number;
  private accessToken: string | null = null;
  private expiresAt = 0;
  private displayName: string | null = null;
  private loginRunning = false;
  /** The sign-in waiting for an app link, if any. */
  private pendingLink: { state: string; uri: string; finish: (url: URL) => void } | null = null;

  constructor(private readonly options: SpotifyOptions) {
    this.accountsBase = options.accountsBase ?? 'https://accounts.spotify.com';
    this.apiBase = options.apiBase ?? 'https://api.spotify.com/v1';
    this.loginTimeoutMs = options.loginTimeoutMs ?? 5 * 60_000;
  }

  async status(): Promise<ApiResult<SpotifyStatus>> {
    const stored = await this.options.store.load();
    if (stored.refreshToken && this.displayName === null) {
      // Best effort: the name is only for display.
      const me = await this.api('GET', '/me');
      if (me.ok) {
        this.displayName = typeof (me.data as Json).display_name === 'string' ? ((me.data as Json).display_name as string) : '';
      }
    }
    const current = await this.options.store.load();
    return {
      ok: true,
      data: {
        clientId: current.clientId,
        redirectUri: current.redirectUri ?? DEFAULT_REDIRECT_URI,
        connected: current.refreshToken !== null,
        displayName: current.refreshToken ? this.displayName : null,
      },
    };
  }

  async configure(clientId: string, redirectUri: string): Promise<ApiResult<SpotifyStatus>> {
    const id = clientId.trim();
    const uri = redirectUri.trim();
    if (!CLIENT_ID.test(id)) {
      return fail(400, 'VALIDATION_FAILED', 'A Spotify Client ID is 32 letters and digits, from the app you created in the Spotify developer dashboard.');
    }
    const redirect = parseRedirect(uri);
    if (!redirect) {
      return fail(
        400,
        'VALIDATION_FAILED',
        'Use a redirect URI Day Tracker can receive: http://127.0.0.1:PORT/path, http://[::1]:PORT/path, an app link such as daytracker://callback, or your server’s https://…/spotify/callback.',
      );
    }
    if (redirect.kind === 'scheme') {
      if (!this.options.registerScheme) {
        return fail(400, 'VALIDATION_FAILED', 'App links cannot be used here; use a loopback address.');
      }
      this.options.registerScheme(redirect.scheme);
    }
    const stored = await this.options.store.load();
    const changed = stored.clientId !== id;
    if (changed) {
      // Tokens belong to the app that issued them.
      this.forget();
    }
    await this.options.store.save({ clientId: id, redirectUri: uri, refreshToken: changed ? null : stored.refreshToken });
    return this.status();
  }

  /** The redirect in use, registering its scheme again when it is an app link (for example after an update). */
  async currentRedirect(): Promise<Redirect | null> {
    const stored = await this.options.store.load();
    const redirect = parseRedirect(stored.redirectUri ?? DEFAULT_REDIRECT_URI);
    if (redirect?.kind === 'scheme') {
      this.options.registerScheme?.(redirect.scheme);
    }
    return redirect;
  }

  /**
   * Called by the main process with a link Windows handed to the app. It completes
   * a waiting sign-in when the state matches, and is ignored otherwise.
   */
  handleLink(link: string): boolean {
    const pending = this.pendingLink;
    if (!pending || !link.startsWith(pending.uri)) {
      return false;
    }
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      return false;
    }
    if (url.searchParams.get('state') !== pending.state) {
      return false;
    }
    pending.finish(url);
    return true;
  }

  async disconnect(): Promise<ApiResult<SpotifyStatus>> {
    const stored = await this.options.store.load();
    this.forget();
    await this.options.store.save({ ...stored, refreshToken: null });
    return this.status();
  }

  /** Opens Spotify's sign-in page and waits for the user to finish there. */
  async connect(): Promise<ApiResult<SpotifyStatus>> {
    const stored = await this.options.store.load();
    if (!stored.clientId) {
      return fail(400, 'SPOTIFY_NOT_CONFIGURED', 'Enter your Spotify Client ID first.');
    }
    if (this.loginRunning) {
      return fail(409, 'SPOTIFY_LOGIN_IN_PROGRESS', 'Finish signing in to Spotify in your browser.');
    }
    this.loginRunning = true;
    try {
      const verifier = base64url(randomBytes(64));
      const challenge = base64url(createHash('sha256').update(verifier).digest());
      const state = base64url(randomBytes(16));
      const redirect = await this.currentRedirect();
      if (!redirect) {
        return fail(400, 'SPOTIFY_NOT_CONFIGURED', 'The saved redirect URI cannot be used. Enter it again.');
      }
      const callback = await this.waitForCallback(state, redirect, async (redirectUri, sentState) => {
        const url = new URL(`${this.accountsBase}/authorize`);
        url.search = new URLSearchParams({
          client_id: stored.clientId!,
          response_type: 'code',
          redirect_uri: redirectUri,
          code_challenge_method: 'S256',
          code_challenge: challenge,
          scope: SCOPES,
          state: sentState,
        }).toString();
        await this.options.openBrowser(url.toString());
      });
      if (!callback.ok) {
        return callback;
      }
      const tokens = await this.tokenRequest({
        grant_type: 'authorization_code',
        code: callback.data.code,
        redirect_uri: callback.data.redirectUri,
        client_id: stored.clientId,
        code_verifier: verifier,
      });
      if (!tokens.ok) {
        return tokens;
      }
      this.displayName = null;
      return this.status();
    } finally {
      this.loginRunning = false;
    }
  }

  async search(query: string): Promise<ApiResult<SpotifySearchResult>> {
    const result = await this.api('GET', '/search', {
      query: { q: query, type: 'track,playlist', limit: String(SEARCH_LIMIT) },
    });
    if (!result.ok) {
      return result;
    }
    const data = result.data as Json;
    const tracks = ((data.tracks as Json | undefined)?.items as unknown[] | undefined) ?? [];
    const playlists = ((data.playlists as Json | undefined)?.items as unknown[] | undefined) ?? [];
    return {
      ok: true,
      data: {
        tracks: tracks.map(toTrack).filter((track): track is SpotifyTrack => track !== null),
        // Spotify sometimes returns null in place of a playlist.
        playlists: playlists.map(toPlaylist).filter((playlist): playlist is SpotifyPlaylist => playlist !== null),
      },
    };
  }

  async playlists(): Promise<ApiResult<SpotifyPlaylist[]>> {
    const result = await this.api('GET', '/me/playlists', { query: { limit: '30' } });
    if (!result.ok) {
      return result;
    }
    const items = ((result.data as Json).items as unknown[] | undefined) ?? [];
    return { ok: true, data: items.map(toPlaylist).filter((playlist): playlist is SpotifyPlaylist => playlist !== null) };
  }

  async devices(): Promise<ApiResult<SpotifyDevice[]>> {
    const result = await this.api('GET', '/me/player/devices');
    if (!result.ok) {
      return result;
    }
    const devices = ((result.data as Json).devices as Json[] | undefined) ?? [];
    return {
      ok: true,
      data: devices
        .filter((device) => typeof device.id === 'string')
        .map((device) => ({
          id: device.id as string,
          name: String(device.name ?? 'Device'),
          type: String(device.type ?? ''),
          isActive: device.is_active === true,
        })),
    };
  }

  async playback(): Promise<ApiResult<SpotifyPlayback | null>> {
    const result = await this.api('GET', '/me/player');
    if (!result.ok) {
      return result;
    }
    if (result.data === null) {
      return { ok: true, data: null };
    }
    const data = result.data as Json;
    const device = data.device as Json | undefined;
    return {
      ok: true,
      data: {
        isPlaying: data.is_playing === true,
        progressMs: typeof data.progress_ms === 'number' ? data.progress_ms : 0,
        track: toTrack(data.item),
        deviceName: device && typeof device.name === 'string' ? device.name : null,
      },
    };
  }

  async play(input: SpotifyPlayInput = {}): Promise<ApiResult<null>> {
    const body = input.uri?.startsWith('spotify:track:')
      ? { uris: [input.uri] }
      : input.uri
        ? { context_uri: input.uri }
        : undefined;
    return this.control('PUT', '/me/player/play', body, input.deviceId);
  }

  pause(): Promise<ApiResult<null>> {
    return this.control('PUT', '/me/player/pause');
  }

  next(): Promise<ApiResult<null>> {
    return this.control('POST', '/me/player/next');
  }

  previous(): Promise<ApiResult<null>> {
    return this.control('POST', '/me/player/previous');
  }

  transfer(deviceId: string): Promise<ApiResult<null>> {
    return this.control('PUT', '/me/player', { device_ids: [deviceId], play: true });
  }

  private async control(method: string, path: string, body?: unknown, deviceId?: string): Promise<ApiResult<null>> {
    const result = await this.api(method, path, { body, query: deviceId ? { device_id: deviceId } : undefined });
    return result.ok ? { ok: true, data: null } : result;
  }

  private forget(): void {
    this.accessToken = null;
    this.expiresAt = 0;
    this.displayName = null;
  }

  /**
   * Waits for Spotify to send the browser back: on a one-time loopback listener, or
   * through an app link that Windows hands to the app.
   */
  private waitForCallback(
    state: string,
    redirect: Redirect,
    openSignIn: (redirectUri: string, sentState: string) => Promise<void>,
  ): Promise<ApiResult<{ code: string; redirectUri: string }>> {
    return new Promise((resolve) => {
      let redirectUri = '';
      // Through a relay, the state also tells the relay which local port to return to.
      let expectedState = state;
      let settled = false;
      let close = () => undefined as void;

      const answer = (url: URL): string => {
        const code = url.searchParams.get('code');
        const denied = url.searchParams.get('error');
        finish(
          code
            ? { ok: true, data: { code, redirectUri } }
            : denied === 'access_denied'
              ? fail(0, 'CANCELLED', 'Signing in to Spotify was cancelled.')
              : fail(400, 'SPOTIFY_LOGIN_FAILED', `Spotify did not allow the sign-in (${denied ?? 'no reason given'}).`),
        );
        return code ? 'Spotify is connected to Day Tracker. You can close this tab.' : 'Spotify was not connected. You can close this tab.';
      };
      const timer = setTimeout(
        () => finish(fail(0, 'CANCELLED', 'Signing in to Spotify took too long. Try again.')),
        this.loginTimeoutMs,
      );
      const finish = (result: ApiResult<{ code: string; redirectUri: string }>) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        close();
        resolve(result);
      };
      const start = () =>
        openSignIn(redirectUri, expectedState).catch(() => finish(fail(500, 'SPOTIFY_LOGIN_FAILED', 'Could not open the Spotify sign-in page.')));

      if (redirect.kind === 'scheme') {
        redirectUri = redirect.uri;
        this.pendingLink = { state, uri: redirect.uri, finish: (url) => void answer(url) };
        close = () => {
          this.pendingLink = null;
        };
        void start();
        return;
      }

      const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        const path = redirect.kind === 'loopback' ? redirect.path : '/callback';
        if (url.pathname !== path || url.searchParams.get('state') !== expectedState) {
          // Not Spotify's answer to this sign-in: ignore it and keep waiting.
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
          return;
        }
        const message = answer(url);
        response
          .writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
          })
          .end(page(message));
      });
      close = () => {
        server.close();
      };
      server.on('error', (error: NodeJS.ErrnoException) =>
        finish(
          fail(
            500,
            'SPOTIFY_LOGIN_FAILED',
            error.code === 'EADDRINUSE'
              ? `Port ${redirect.kind === 'loopback' ? redirect.port : ''} is in use by another program. Choose another port in the redirect URI, here and in the Spotify dashboard.`
              : 'Could not wait for Spotify to answer.',
          ),
        ),
      );
      if (redirect.kind === 'relay') {
        server.listen(0, '127.0.0.1', () => {
          redirectUri = redirect.uri;
          expectedState = `${state}.${(server.address() as AddressInfo).port}`;
          void start();
        });
        return;
      }
      server.listen(redirect.port, redirect.host, () => {
        // Spotify compares the redirect URI character by character: send the registered
        // one, adding the port only when it was registered without one.
        const host = redirect.host === '::1' ? '[::1]' : '127.0.0.1';
        redirectUri =
          redirect.port === 0
            ? redirect.uri.replace(`http://${host}`, `http://${host}:${(server.address() as AddressInfo).port}`)
            : redirect.uri;
        void start();
      });
    });
  }

  private async tokenRequest(form: Record<string, string>): Promise<ApiResult<null>> {
    let response: Response;
    try {
      response = await fetch(`${this.accountsBase}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return fail(0, 'SPOTIFY_UNAVAILABLE', 'Spotify could not be reached. Check the internet connection.');
    }
    const data = (await response.json().catch(() => ({}))) as Json;
    if (!response.ok || typeof data.access_token !== 'string') {
      if (data.error === 'invalid_grant' || data.error === 'invalid_client') {
        // The connection was revoked, expired, or belongs to another app: sign in again.
        const stored = await this.options.store.load();
        this.forget();
        await this.options.store.save({ ...stored, refreshToken: null });
        return fail(401, 'SPOTIFY_NOT_CONNECTED', 'The Spotify connection has ended. Connect again.');
      }
      return fail(response.status || 500, 'SPOTIFY_LOGIN_FAILED', 'Spotify refused the sign-in. Check the Client ID and the redirect URI in your Spotify app.');
    }
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + (typeof data.expires_in === 'number' ? data.expires_in : 3600) * 1000 - 60_000;
    const stored = await this.options.store.load();
    // Spotify may or may not rotate the refresh token; keep the newest one.
    const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : stored.refreshToken;
    await this.options.store.save({ ...stored, refreshToken });
    return { ok: true, data: null };
  }

  private async token(forceRefresh = false): Promise<ApiResult<string>> {
    if (!forceRefresh && this.accessToken && Date.now() < this.expiresAt) {
      return { ok: true, data: this.accessToken };
    }
    const stored = await this.options.store.load();
    if (!stored.clientId || !stored.refreshToken) {
      return fail(401, 'SPOTIFY_NOT_CONNECTED', 'Connect your Spotify account first.');
    }
    const refreshed = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
      client_id: stored.clientId,
    });
    return refreshed.ok ? { ok: true, data: this.accessToken! } : refreshed;
  }

  private async api(
    method: string,
    path: string,
    { query, body }: { query?: Record<string, string>; body?: unknown } = {},
    retried = false,
  ): Promise<ApiResult<unknown>> {
    const token = await this.token(retried);
    if (!token.ok) {
      return token;
    }
    const url = `${this.apiBase}${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token.data}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return fail(0, 'SPOTIFY_UNAVAILABLE', 'Spotify could not be reached. Check the internet connection.');
    }
    if (response.status === 401 && !retried) {
      return this.api(method, path, { query, body }, true);
    }
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (response.ok) {
      return { ok: true, data: parsed };
    }
    const error = ((parsed as Json | null)?.error ?? {}) as Json;
    const reason = typeof error.reason === 'string' ? error.reason : '';
    const message = typeof error.message === 'string' ? error.message : '';
    if (response.status === 429) {
      const wait = Number(response.headers.get('Retry-After') ?? '0');
      return fail(429, 'SPOTIFY_RATE_LIMITED', `Spotify asked to slow down. Try again${wait > 0 ? ` in ${wait} seconds` : ' shortly'}.`);
    }
    if (reason === 'PREMIUM_REQUIRED') {
      return fail(403, 'SPOTIFY_PREMIUM_REQUIRED', 'Spotify only allows controlling playback with a Premium account.');
    }
    if (reason === 'NO_ACTIVE_DEVICE' || (response.status === 404 && path.startsWith('/me/player'))) {
      return fail(404, 'SPOTIFY_NO_DEVICE', 'No Spotify device is active. Open Spotify on this computer or your phone, then try again.');
    }
    if (response.status === 403) {
      return fail(
        403,
        'SPOTIFY_NOT_ALLOWED',
        message.toLowerCase().includes('user')
          ? 'This Spotify account is not on the app’s user list. Add it under User Management in the Spotify developer dashboard.'
          : `Spotify refused the request${message ? `: ${message}` : '.'}`,
      );
    }
    return fail(response.status, 'SPOTIFY_ERROR', `Spotify answered with an error${message ? `: ${message}` : '.'}`);
  }
}

function imageIdOf(images: unknown): string | null {
  if (!Array.isArray(images)) {
    return null;
  }
  // The smallest image that is still at least 64 pixels wide, else the first.
  const sorted = (images as Json[])
    .filter((image) => typeof image?.url === 'string')
    .sort((a, b) => Number(a.width ?? 0) - Number(b.width ?? 0));
  const chosen = sorted.find((image) => Number(image.width ?? 0) >= 64) ?? sorted[0];
  return (chosen && IMAGE_URL.exec(chosen.url as string)?.[1]) ?? null;
}

function toTrack(value: unknown): SpotifyTrack | null {
  const track = value as Json | null;
  if (!track || track.type !== 'track' || typeof track.uri !== 'string') {
    return null;
  }
  const artists = Array.isArray(track.artists) ? (track.artists as Json[]).map((artist) => String(artist.name ?? '')) : [];
  const album = track.album as Json | undefined;
  return {
    uri: track.uri,
    name: String(track.name ?? ''),
    artists: artists.filter(Boolean).join(', '),
    album: album ? String(album.name ?? '') : '',
    durationMs: typeof track.duration_ms === 'number' ? track.duration_ms : 0,
    imageId: imageIdOf(album?.images),
  };
}

function toPlaylist(value: unknown): SpotifyPlaylist | null {
  const playlist = value as Json | null;
  if (!playlist || typeof playlist.uri !== 'string') {
    return null;
  }
  // The February 2026 API renamed "tracks" to "items"; accept either.
  const items = (playlist.items ?? playlist.tracks) as Json | undefined;
  return {
    uri: playlist.uri,
    name: String(playlist.name ?? ''),
    owner: String((playlist.owner as Json | undefined)?.display_name ?? ''),
    trackCount: typeof items?.total === 'number' ? items.total : null,
    imageId: imageIdOf(playlist.images),
  };
}

function page(message: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Day Tracker</title><body style="font-family:Segoe UI,sans-serif;background:#20242c;color:#edf0f5;display:grid;place-items:center;height:100vh;margin:0"><p>${message}</p></body></html>`;
}
