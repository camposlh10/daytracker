import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { ApiErrorBody, ApiResult, BackendState } from './shared/bridge-types';

const READY_PREFIX = 'DAYTRACKER_READY ';
const REQUEST_TIMEOUT_MS = 15_000;
// Exports read every record, so they get longer than an ordinary request.
const EXPORT_TIMEOUT_MS = 60_000;
// Longer than the backend's own graceful-shutdown allowance.
const SHUTDOWN_WAIT_MS = 8_000;

export interface BackendOptions {
  javaPath: string;
  jarPath: string;
  dataDir: string;
  startupTimeoutMs: number;
  /**
   * Where the JVM may keep its class-data archive. The first run writes it as the
   * service exits and later runs start about two seconds faster. Needs Java 19 or
   * newer, so only the bundled runtime is given one.
   */
  cacheDir?: string;
}

/**
 * Owns the Java child process: launch, readiness, authenticated requests,
 * crash detection, and shutdown. Emits 'state' whenever the lifecycle changes.
 */
export class BackendManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private token = '';
  private port: number | null = null;
  private state: BackendState = { status: 'starting' };
  private startupTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: BackendOptions) {
    super();
  }

  getState(): BackendState {
    return this.state;
  }

  start(): void {
    if (this.child) {
      return;
    }
    // A new token per launch, handed over through the environment only.
    this.token = randomBytes(32).toString('base64url');
    if (this.options.cacheDir) {
      try {
        mkdirSync(this.options.cacheDir, { recursive: true });
      } catch {
        // Without the folder the JVM only skips the archive.
      }
    }
    this.port = null;
    this.setState({ status: 'starting' });

    const child = spawn(this.options.javaPath, [...this.jvmOptions(), '-jar', this.options.jarPath], {
      env: {
        ...process.env,
        DAYTRACKER_TOKEN: this.token,
        DAYTRACKER_DATA_DIR: this.options.dataDir,
        DAYTRACKER_PARENT_WATCH: 'true',
      },
      // stdin stays open as the liveness pipe: if this process dies, the
      // backend sees end-of-stream and exits on its own.
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    this.startupTimer = setTimeout(() => {
      if (this.child === child && this.state.status === 'starting') {
        this.detach(child);
        this.setState({
          status: 'failed',
          reason: 'timeout',
          message: 'The data service did not start in time.',
        });
      }
    }, this.options.startupTimeoutMs);

    child.stdin?.on('error', () => undefined);
    child.stderr?.resume();
    if (child.stdout) {
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (this.child === child && line.startsWith(READY_PREFIX)) {
          void this.confirmReady(child, line.slice(READY_PREFIX.length));
        }
      });
    }

    child.on('error', () => {
      if (this.child === child) {
        this.detach(child);
        this.setState({
          status: 'failed',
          reason: 'startup',
          message: 'The data service could not be launched.',
        });
      }
    });

    child.on('exit', (code) => {
      if (this.child !== child) {
        return;
      }
      const wasReady = this.state.status === 'ready';
      this.child = null;
      this.clearStartupTimer();
      this.setState(
        wasReady
          ? { status: 'failed', reason: 'crashed', message: 'The data service stopped unexpectedly.' }
          : {
              status: 'failed',
              reason: 'startup',
              message: `The data service exited during startup (code ${code ?? 'unknown'}).`,
            },
      );
    });
  }

  private jvmOptions(): string[] {
    const { cacheDir } = this.options;
    if (!cacheDir) {
      return [];
    }
    // A damaged or outdated archive is ignored and rebuilt by the JVM itself.
    return [
      '-XX:+UseSerialGC',
      '-XX:+AutoCreateSharedArchive',
      `-XX:SharedArchiveFile=${path.join(cacheDir, 'backend.jsa')}`,
    ];
  }

  private async confirmReady(child: ChildProcess, payload: string): Promise<void> {
    let port: unknown;
    try {
      port = (JSON.parse(payload) as { port?: unknown }).port;
    } catch {
      return;
    }
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      return;
    }
    this.port = port;
    const health = await this.send('GET', '/api/v1/health');
    if (this.child !== child || this.state.status !== 'starting') {
      return;
    }
    this.clearStartupTimer();
    if (health.ok) {
      this.setState({ status: 'ready' });
    } else {
      this.detach(child);
      this.setState({
        status: 'failed',
        reason: 'startup',
        message: 'The data service started but did not pass its health check.',
      });
    }
  }

  /** Forwards one request to a fixed backend route. Never retries. */
  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    rawBody?: Uint8Array<ArrayBuffer>,
  ): Promise<ApiResult<unknown>> {
    if (this.state.status !== 'ready') {
      return unavailable('The data service is not running.');
    }
    return this.send(method, path, body, rawBody);
  }

  /** Fetches an image from a fixed backend route; null when there is none or the backend is down. */
  async fetchImage(path: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string } | null> {
    if (this.state.status !== 'ready' || this.port === null) {
      return null;
    }
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}${path}`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const contentType = response.headers.get('Content-Type') ?? '';
      if (!response.ok || !/^image\/(jpeg|png|webp)$/.test(contentType)) {
        return null;
      }
      return { bytes: new Uint8Array(await response.arrayBuffer()), contentType };
    } catch {
      return null;
    }
  }

  /** Fetches a file download from a fixed backend route. */
  async fetchFile(path: string): Promise<ApiResult<DownloadedFile>> {
    if (this.state.status !== 'ready' || this.port === null) {
      return unavailable('The data service is not running.');
    }
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}${path}`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
      });
      if (!response.ok) {
        return toFailure(response.status, await response.text());
      }
      const disposition = response.headers.get('Content-Disposition') ?? '';
      return {
        ok: true,
        data: {
          bytes: new Uint8Array(await response.arrayBuffer()),
          fileName: /filename="?([A-Za-z0-9._-]+)"?/.exec(disposition)?.[1] ?? null,
          truncated: response.headers.get('X-Export-Truncated') === 'true',
        },
      };
    } catch {
      return unreachable();
    }
  }

  private async send(method: string, path: string, body?: unknown, rawBody?: Uint8Array<ArrayBuffer>): Promise<ApiResult<unknown>> {
    if (this.port === null) {
      return unavailable('The data service is not running.');
    }
    try {
      const contentType = rawBody ? 'application/octet-stream' : body === undefined ? null : 'application/json';
      const response = await fetch(`http://127.0.0.1:${this.port}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(contentType ? { 'Content-Type': contentType } : {}),
        },
        body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      if (response.ok) {
        return { ok: true, data: text ? (JSON.parse(text) as unknown) : null };
      }
      return toFailure(response.status, text);
    } catch {
      return unreachable();
    }
  }

  /** Asks the backend to stop, waits a bounded time, then terminates it. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }
    this.child = null;
    this.clearStartupTimer();
    if (child.exitCode !== null) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, SHUTDOWN_WAIT_MS);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin?.end('shutdown\n');
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    this.start();
  }

  /**
   * Stops the service on purpose, for work on its files. The state reads as
   * starting meanwhile, so requests are refused and the page shows a restart
   * instead of a crash.
   */
  async stopForMaintenance(): Promise<void> {
    this.setState({ status: 'starting' });
    await this.stop();
  }

  /** Resolves with the first state that is not 'starting', or the current one after the timeout. */
  waitUntilSettled(timeoutMs: number): Promise<BackendState> {
    return new Promise((resolve) => {
      if (this.state.status !== 'starting') {
        resolve(this.state);
        return;
      }
      const finish = () => {
        clearTimeout(timer);
        this.off('state', onState);
        resolve(this.state);
      };
      const onState = (state: BackendState) => {
        if (state.status !== 'starting') {
          finish();
        }
      };
      const timer = setTimeout(finish, timeoutMs);
      this.on('state', onState);
    });
  }

  private detach(child: ChildProcess): void {
    this.child = null;
    this.clearStartupTimer();
    child.kill();
  }

  private clearStartupTimer(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }

  private setState(state: BackendState): void {
    this.state = state;
    this.emit('state', state);
  }
}

export interface DownloadedFile {
  bytes: Uint8Array<ArrayBuffer>;
  /** The name the backend suggested, restricted to safe characters; null when it gave none. */
  fileName: string | null;
  truncated: boolean;
}

function unavailable(message: string): ApiResult<never> {
  return { ok: false, error: { status: 503, code: 'BACKEND_UNAVAILABLE', message } };
}

function unreachable(): ApiResult<never> {
  return {
    ok: false,
    error: {
      status: 0,
      code: 'BACKEND_UNREACHABLE',
      message: 'The data service did not respond. The change may or may not have been saved.',
    },
  };
}

function toFailure(status: number, text: string): ApiResult<never> {
  let error: Partial<ApiErrorBody> = {};
  try {
    error = (text ? JSON.parse(text) : {}) as Partial<ApiErrorBody>;
  } catch {
    // A body that is not JSON still gets a plain failure below.
  }
  return {
    ok: false,
    error: {
      status,
      code: typeof error.code === 'string' ? error.code : 'ERROR',
      message: typeof error.message === 'string' ? error.message : 'The request failed.',
      fieldErrors: Array.isArray(error.fieldErrors) ? error.fieldErrors : undefined,
      correlationId: typeof error.correlationId === 'string' ? error.correlationId : undefined,
    },
  };
}
