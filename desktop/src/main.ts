import { app, BrowserWindow, dialog, Menu, session, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BackendManager } from './backend';
import type { ApiResult, ExportDataset } from './shared/bridge-types';
import { chooseCoverFile, handleCoverScheme, registerCoverScheme } from './covers';
import { exportCsv, openBackupFolder, saveBackupCopy } from './dataTools';
import { registerIpc } from './ipc';
import { restoreFromBackup } from './restore';
import { recoverInterruptedRestore } from './restoreSwap';
import { describeServer, loadServer, normalizeServerUrl, saveServer, testServer, validToken } from './serverConfig';
import { createSpotify, handleSpotifyImageScheme } from './spotify';
import { HolidayService } from './holidays';
import { usesUsMeasurements, WeatherService } from './weather';
import { loadPlacement, rememberPlacement } from './windowState';

const DEV_SERVER_URL = 'http://127.0.0.1:5173/';
const STARTUP_TIMEOUT_MS = 60_000;
// The page draws its own title bar, like Spotify's; Windows draws its buttons over the
// right end in these colours (--color-titlebar and --color-text-secondary in tokens.css).
const TITLE_BAR = { color: '#181b21', symbolColor: '#b4bdca', height: 56 };
const MIN_WIDTH = 1100;
const MIN_HEIGHT = 720;

const isDev = !app.isPackaged;
const rendererIndex = path.join(__dirname, '..', 'renderer', 'index.html');
const rendererUrl = isDev ? DEV_SERVER_URL : pathToFileURL(rendererIndex).href;

// A debugging port would let any program on this computer drive the window and
// call the data bridge. The released app refuses to start with one; the automated
// release checks opt in explicitly. Diagnostics for users are the log folder.
if (!isDev && process.env.DAYTRACKER_ALLOW_DEBUG_PORT !== '1' && process.argv.some((arg) => /^--(remote-debugging|inspect)/.test(arg))) {
  console.error('Day Tracker does not start with a debugging port.');
  app.exit(2);
}

// Development and automated smoke tests must not touch the real profile.
// DAYTRACKER_USER_DATA redirects all mutable data to another directory.
if (process.env.DAYTRACKER_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.DAYTRACKER_USER_DATA));
} else if (isDev) {
  app.setPath('userData', path.join(app.getPath('appData'), 'Day Tracker Dev'));
}

let mainWindow: BrowserWindow | null = null;
let backend: BackendManager | null = null;
let backendStopped = false;
let spotifyClient: ReturnType<typeof createSpotify> | null = null;

function resolveBackendPaths(): { javaPath: string; jarPath: string } {
  if (isDev) {
    return {
      javaPath: process.env.DAYTRACKER_JAVA ?? 'java',
      jarPath: path.resolve(__dirname, '..', '..', 'backend', 'target', 'day-tracker-backend.jar'),
    };
  }
  return {
    javaPath: path.join(process.resourcesPath, 'jre', 'bin', 'java.exe'),
    jarPath: path.join(process.resourcesPath, 'backend', 'backend.jar'),
  };
}

function isAppUrl(url: string): boolean {
  return url === rendererUrl || url.startsWith(`${rendererUrl}#`) || url.startsWith(`${rendererUrl}?`);
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  return (
    mainWindow !== null &&
    event.sender === mainWindow.webContents &&
    event.senderFrame !== null &&
    event.senderFrame === mainWindow.webContents.mainFrame &&
    isAppUrl(event.senderFrame.url)
  );
}

function createWindow(): void {
  const placementFile = path.join(app.getPath('userData'), 'window.json');
  const placement = loadPlacement(placementFile, MIN_WIDTH, MIN_HEIGHT);
  mainWindow = new BrowserWindow({
    ...placement.bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: '#20242C',
    title: 'Day Tracker',
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLE_BAR,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: isDev,
    },
  });
  mainWindow.once('ready-to-show', () => {
    if (placement.maximized) {
      mainWindow?.maximize();
    }
    mainWindow?.show();
  });
  rememberPlacement(mainWindow, placementFile);
  // The page refuses to unload while it holds unsaved edits; let the user decide.
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const options = {
      type: 'question' as const,
      buttons: ['Stay', 'Leave without saving'],
      defaultId: 0,
      cancelId: 0,
      title: 'Unsaved changes',
      message: 'You have changes that are not saved.',
      detail: 'Stay to save them, or leave and lose them.',
    };
    const choice = mainWindow ? dialog.showMessageBoxSync(mainWindow, options) : dialog.showMessageBoxSync(options);
    if (choice === 1) {
      event.preventDefault();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  if (isDev) {
    void mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(rendererIndex);
  }
}

registerCoverScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second start is either the user opening the app again or Windows handing over
  // an app link, such as the answer to a Spotify sign-in.
  app.on('second-instance', (_event, argv) => {
    const link = argv.find((arg) => /^[a-z][a-z0-9+.-]{2,40}:\/\//.test(arg) && !/^https?:/.test(arg));
    if (link && spotifyClient) {
      spotifyClient.handleLink(link);
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  // The app shows one local page: no new windows, no navigation away from it.
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url)) {
        event.preventDefault();
      }
    });
  });

  app.on('window-all-closed', () => app.quit());

  // Give the backend a bounded chance to stop cleanly before the process exits.
  // This runs only after every window has closed, so a quit that the user
  // cancels because of unsaved changes leaves the backend running.
  app.on('will-quit', (event) => {
    if (backend && !backendStopped) {
      event.preventDefault();
      void backend.stop().finally(() => {
        backendStopped = true;
        app.quit();
      });
    }
  });

  void app.whenReady().then(async () => {
    if (!isDev) {
      Menu.setApplicationMenu(null);
    }
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

    const dataDir = path.join(app.getPath('userData'), 'data');
    // The user's own server, when one was chosen in Settings; otherwise a local data service.
    const remote = await loadServer(app.getPath('userData'));
    const manager = new BackendManager({
      ...resolveBackendPaths(),
      dataDir,
      startupTimeoutMs: STARTUP_TIMEOUT_MS,
      cacheDir: isDev ? undefined : path.join(dataDir, 'cache'),
      remote: remote ?? undefined,
    });
    const onServer = <T,>(local: () => Promise<T>) => (): Promise<T | ApiResult<never>> =>
      remote
        ? Promise.resolve({
            ok: false,
            error: { status: 400, code: 'NOT_ON_SERVER', message: 'This works only when your data is on this computer.' },
          })
        : local();
    backend = manager;
    manager.on('state', (state) => mainWindow?.webContents.send('backend:state', state));

    handleCoverScheme(session.defaultSession.protocol, manager);
    handleSpotifyImageScheme(session.defaultSession.protocol);
    const spotify = createSpotify(app.getPath('userData'));
    spotifyClient = spotify;
    // Keeps an app-link redirect working after the app moved or was updated.
    void spotify.currentRedirect();

    registerIpc({
      backend: manager,
      isTrustedSender,
      openDiagnostics: async () => {
        const logsDir = path.join(dataDir, 'logs');
        await mkdir(logsDir, { recursive: true });
        await shell.openPath(logsDir);
      },
      exit: () => app.quit(),
      chooseCoverFile: (bookId) => chooseCoverFile(mainWindow, manager, bookId),
      exportCsv: (dataset, range) =>
        exportCsv({ window: mainWindow, backend: manager, dataDir }, dataset as ExportDataset, range),
      saveBackupCopy: (name) => onServer(() => saveBackupCopy({ window: mainWindow, backend: manager, dataDir }, name))(),
      openBackupFolder: async () => {
        if (!remote) {
          await openBackupFolder(dataDir);
        }
      },
      restoreBackup: onServer(() => restoreFromBackup({ window: mainWindow, backend: manager, dataDir })),
      spotify,
      weather: new WeatherService({ usMeasurements: await usesUsMeasurements() }),
      holidays: new HolidayService({ cacheDir: path.join(app.getPath('userData'), 'holidays') }),
      openLink: async (url) => {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return invalidLink();
        }
        // Web pages only: no files, programs or other schemes.
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          return invalidLink();
        }
        await shell.openExternal(parsed.href);
        return { ok: true, data: null };
      },
      server: {
        describe: () => describeServer(app.getPath('userData'), remote),
        test: (url, token) => {
          const baseUrl = normalizeServerUrl(url);
          if (!baseUrl) {
            return Promise.resolve(invalidServer());
          }
          if (!validToken(token)) {
            return Promise.resolve(invalidToken());
          }
          return testServer(baseUrl, token);
        },
        // The new choice takes effect on a restart, so nothing half-switched is ever shown.
        use: async (choice) => {
          if (choice === null) {
            await saveServer(app.getPath('userData'), null);
          } else {
            const baseUrl = normalizeServerUrl(choice.url);
            if (!baseUrl) {
              return invalidServer();
            }
            if (!validToken(choice.token)) {
              return invalidToken();
            }
            const check = await testServer(baseUrl, choice.token);
            if (!check.ok) {
              return check;
            }
            await saveServer(app.getPath('userData'), { baseUrl, token: choice.token });
          }
          app.relaunch();
          app.quit();
          return { ok: true, data: null };
        },
      },
    });

    createWindow();
    // A restore cut short by a crash is undone before the data service opens the database.
    void (remote ? Promise.resolve(null) : recoverInterruptedRestore(dataDir))
      .catch(() => null)
      .then((undone) => {
        manager.start();
        if (undone) {
          void dialog.showMessageBox({ type: 'info', title: 'Day Tracker', message: undone });
        }
      });
  });
}

function invalidLink(): ApiResult<never> {
  return {
    ok: false,
    error: { status: 400, code: 'VALIDATION_FAILED', message: 'Only web addresses (https:// or http://) can be opened.' },
  };
}

function invalidServer(): ApiResult<never> {
  return {
    ok: false,
    error: {
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Enter the server address as https://name.example, without a path (http is allowed only on this computer).',
    },
  };
}

function invalidToken(): ApiResult<never> {
  return {
    ok: false,
    error: {
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'The access token is the DAYTRACKER_TOKEN the server runs with: at least 32 characters, no spaces.',
    },
  };
}
