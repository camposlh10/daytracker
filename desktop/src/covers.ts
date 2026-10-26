import { dialog, protocol, type BrowserWindow } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import type { BackendManager } from './backend';
import type { ApiResult } from './shared/bridge-types';

/**
 * Cover images reach the page through a private scheme instead of the network:
 *   dt-cover://book/<book id>?v=<cover timestamp>   a book's stored cover
 *   dt-cover://candidate/<Open Library cover id>    a search result preview
 *   dt-cover://google/<ISBN>                        a Google Books cover preview
 * The main process fetches the bytes from the backend with the launch token,
 * so the page never sees the token and the content security policy can keep
 * all network access closed.
 */
export const COVER_SCHEME = 'dt-cover';

const MAX_COVER_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COVER_ID = /^\d{1,12}$/;
const ISBN = /^(\d{9}[\dX]|\d{13})$/;

/** Must run before the app is ready. Also registers the Spotify album-art scheme (see spotify.ts). */
export function registerCoverScheme(): void {
  // Electron accepts this registration once, so every private image scheme is listed here.
  protocol.registerSchemesAsPrivileged([
    { scheme: COVER_SCHEME, privileges: { standard: true, secure: true } },
    { scheme: 'dt-spotify', privileges: { standard: true, secure: true } },
  ]);
}

export function handleCoverScheme(electronProtocol: Electron.Protocol, backend: BackendManager): void {
  electronProtocol.handle(COVER_SCHEME, async (request) => {
    const url = new URL(request.url);
    const id = decodeURIComponent(url.pathname.replace(/^\//, ''));
    let path: string | null = null;
    if (url.hostname === 'book' && UUID.test(id)) {
      path = `/api/v1/books/${id.toLowerCase()}/cover`;
    } else if (url.hostname === 'candidate' && COVER_ID.test(id)) {
      path = `/api/v1/cover-candidates/open-library/${id}/image`;
    } else if (url.hostname === 'google' && ISBN.test(id.toUpperCase())) {
      path = `/api/v1/cover-candidates/google-books/${id.toUpperCase()}/image`;
    }
    const image = path ? await backend.fetchImage(path) : null;
    if (!image) {
      return new Response(null, { status: 404 });
    }
    return new Response(image.bytes, {
      status: 200,
      headers: { 'Content-Type': image.contentType, 'X-Content-Type-Options': 'nosniff' },
    });
  });
}

/**
 * Lets the user pick an image file and sends its bytes to the backend, which
 * checks what the file really is. Only this fixed dialog reads from disk; the
 * page cannot name a path.
 */
export async function chooseCoverFile(
  window: BrowserWindow | null,
  backend: BackendManager,
  bookId: string,
): Promise<ApiResult<unknown>> {
  const options = {
    title: 'Choose a cover image',
    properties: ['openFile' as const],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  };
  const choice = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  if (choice.canceled || choice.filePaths.length === 0) {
    return { ok: false, error: { status: 0, code: 'CANCELLED', message: 'No file was chosen.' } };
  }
  const file = choice.filePaths[0];
  try {
    if ((await stat(file)).size > MAX_COVER_BYTES) {
      return { ok: false, error: { status: 400, code: 'VALIDATION_FAILED', message: 'The image is larger than 2 MB.' } };
    }
    return backend.request('PUT', `/api/v1/books/${bookId}/cover/file`, undefined, new Uint8Array(await readFile(file)));
  } catch {
    return { ok: false, error: { status: 400, code: 'FILE_UNREADABLE', message: 'The file could not be read.' } };
  }
}
