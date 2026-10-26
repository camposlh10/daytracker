import { app, safeStorage, shell } from 'electron';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SpotifyClient, type SpotifyStore, type StoredSpotify } from './spotifyClient';

/**
 * Spotify album art reaches the page through a private scheme, like book covers:
 *   dt-spotify://image/<40 hex digits>   fetched from i.scdn.co by the main process
 * so the page's content security policy can keep all network access closed.
 */
export const SPOTIFY_IMAGE_SCHEME = 'dt-spotify';

const IMAGE_ID = /^[0-9a-f]{40}$/;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const CACHE_SIZE = 200;
const SIGN_IN_PREFIX = 'https://accounts.spotify.com/authorize?';

/**
 * Keeps the Client ID and the refresh token in the profile folder, outside the data
 * folder so they never end up in backups. The token is encrypted with Windows' own
 * per-user protection (DPAPI). Without it, the token is kept for this session only.
 */
function fileStore(file: string): SpotifyStore {
  let sessionToken: string | null = null;
  return {
    async load(): Promise<StoredSpotify> {
      try {
        const saved = JSON.parse(await readFile(file, 'utf8')) as { clientId?: unknown; redirectUri?: unknown; refreshToken?: unknown };
        let refreshToken: string | null = sessionToken;
        if (typeof saved.refreshToken === 'string' && safeStorage.isEncryptionAvailable()) {
          try {
            refreshToken = safeStorage.decryptString(Buffer.from(saved.refreshToken, 'base64'));
          } catch {
            refreshToken = null;
          }
        }
        return {
          clientId: typeof saved.clientId === 'string' ? saved.clientId : null,
          redirectUri: typeof saved.redirectUri === 'string' ? saved.redirectUri : null,
          refreshToken,
        };
      } catch {
        return { clientId: null, redirectUri: null, refreshToken: sessionToken };
      }
    },
    async save(data: StoredSpotify): Promise<void> {
      const canEncrypt = safeStorage.isEncryptionAvailable();
      sessionToken = canEncrypt ? null : data.refreshToken;
      if (data.clientId === null && data.refreshToken === null) {
        await rm(file, { force: true });
        return;
      }
      const refreshToken =
        data.refreshToken && canEncrypt ? safeStorage.encryptString(data.refreshToken).toString('base64') : null;
      await writeFile(file, JSON.stringify({ clientId: data.clientId, redirectUri: data.redirectUri, refreshToken }), { mode: 0o600 });
    },
  };
}

export function createSpotify(userDataDir: string): SpotifyClient {
  return new SpotifyClient({
    store: fileStore(path.join(userDataDir, 'spotify.json')),
    openBrowser: async (url) => {
      // Only Spotify's own sign-in page is ever opened.
      if (!url.startsWith(SIGN_IN_PREFIX)) {
        throw new Error('Refused to open an unexpected address.');
      }
      await shell.openExternal(url);
    },
    // An app link (for example daytracker://callback) is handed to this app by Windows.
    // In development the executable is Electron itself, so it is told which app to start.
    registerScheme: (scheme) => {
      if (app.isPackaged) {
        app.setAsDefaultProtocolClient(scheme);
      } else {
        app.setAsDefaultProtocolClient(scheme, process.execPath, [path.resolve(process.argv[1] ?? '.')]);
      }
    },
  });
}

export function handleSpotifyImageScheme(electronProtocol: Electron.Protocol): void {
  const cache = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>();
  electronProtocol.handle(SPOTIFY_IMAGE_SCHEME, async (request) => {
    const url = new URL(request.url);
    const id = url.pathname.replace(/^\//, '');
    if (url.hostname !== 'image' || !IMAGE_ID.test(id)) {
      return new Response(null, { status: 404 });
    }
    let image = cache.get(id);
    if (!image) {
      try {
        const response = await fetch(`https://i.scdn.co/image/${id}`, {
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        });
        const contentType = response.headers.get('Content-Type') ?? '';
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!response.ok || !/^image\/(jpeg|png|webp)$/.test(contentType) || bytes.byteLength > MAX_IMAGE_BYTES) {
          return new Response(null, { status: 404 });
        }
        image = { bytes, contentType };
        if (cache.size >= CACHE_SIZE) {
          cache.delete(cache.keys().next().value!);
        }
        cache.set(id, image);
      } catch {
        return new Response(null, { status: 404 });
      }
    }
    return new Response(image.bytes, {
      status: 200,
      headers: { 'Content-Type': image.contentType, 'X-Content-Type-Options': 'nosniff' },
    });
  });
}
