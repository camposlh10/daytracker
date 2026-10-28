import { safeStorage } from 'electron';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ApiResult, ServerConnection } from './shared/bridge-types';

/**
 * Where the data lives: on this computer (the default, a local data service the app
 * starts itself) or on the user's own Day Tracker server, such as one on Railway.
 * The choice is kept in the profile folder, with the access token encrypted by
 * Windows' per-user protection. It takes effect when the app restarts.
 */

export interface RemoteServer {
  baseUrl: string;
  token: string;
}

const MIN_TOKEN = 32;
const MAX_TOKEN = 512;

function configFile(userDataDir: string): string {
  return path.join(userDataDir, 'server.json');
}

/** An https address (or http on this computer, for testing), reduced to its origin. */
export function normalizeServerUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return null;
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    return null;
  }
  return url.origin;
}

export function validToken(token: string): boolean {
  return token.length >= MIN_TOKEN && token.length <= MAX_TOKEN && /^[\x21-\x7e]+$/.test(token);
}

export async function loadServer(userDataDir: string): Promise<RemoteServer | null> {
  try {
    const saved = JSON.parse(await readFile(configFile(userDataDir), 'utf8')) as { baseUrl?: unknown; token?: unknown };
    if (typeof saved.baseUrl !== 'string' || typeof saved.token !== 'string' || !safeStorage.isEncryptionAvailable()) {
      return null;
    }
    const baseUrl = normalizeServerUrl(saved.baseUrl);
    const token = safeStorage.decryptString(Buffer.from(saved.token, 'base64'));
    return baseUrl && validToken(token) ? { baseUrl, token } : null;
  } catch {
    return null;
  }
}

export async function describeServer(userDataDir: string, active: RemoteServer | null): Promise<ServerConnection> {
  const saved = await loadServer(userDataDir);
  return {
    activeUrl: active?.baseUrl ?? null,
    savedUrl: saved?.baseUrl ?? null,
    canEncrypt: safeStorage.isEncryptionAvailable(),
  };
}

export async function saveServer(userDataDir: string, server: RemoteServer | null): Promise<void> {
  if (server === null) {
    await rm(configFile(userDataDir), { force: true });
    return;
  }
  const token = safeStorage.encryptString(server.token).toString('base64');
  await writeFile(configFile(userDataDir), JSON.stringify({ baseUrl: server.baseUrl, token }), { mode: 0o600 });
}

/** Checks an address and token against the server's health route, without saving anything. */
export async function testServer(baseUrl: string, token: string): Promise<ApiResult<{ apiVersion: string }>> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401) {
      return { ok: false, error: { status: 401, code: 'SERVER_TOKEN_REFUSED', message: 'The server refused this access token.' } };
    }
    const body = (await response.json().catch(() => null)) as { status?: unknown; apiVersion?: unknown } | null;
    if (!response.ok || body?.status !== 'READY') {
      return {
        ok: false,
        error: { status: response.status, code: 'SERVER_NOT_DAY_TRACKER', message: `That address did not answer like a Day Tracker server (${response.status}).` },
      };
    }
    return { ok: true, data: { apiVersion: String(body.apiVersion ?? '') } };
  } catch {
    return {
      ok: false,
      error: { status: 0, code: 'SERVER_UNREACHABLE', message: 'The server could not be reached. Check the address and that it is running.' },
    };
  }
}
