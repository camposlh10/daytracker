import { app, BrowserWindow, dialog, Menu, session, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BackendManager } from './backend';
import type { ExportDataset } from './shared/bridge-types';
import { chooseCoverFile, handleCoverScheme, registerCoverScheme } from './covers';
import { exportCsv, openBackupFolder, saveBackupCopy } from './dataTools';
import { registerIpc } from './ipc';
import { restoreFromBackup } from './restore';
import { recoverInterruptedRestore } from './restoreSwap';
import { createSpotify, handleSpotifyImageScheme } from './spotify';

const DEV_SERVER_URL = 'http://127.0.0.1:5173/';
const STARTUP_TIMEOUT_MS = 60_000;

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
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#20242C',
    title: 'Day Tracker',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: isDev,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
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

  void app.whenReady().then(() => {
    if (!isDev) {
      Menu.setApplicationMenu(null);
    }
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

    const dataDir = path.join(app.getPath('userData'), 'data');
    const manager = new BackendManager({
      ...resolveBackendPaths(),
      dataDir,
      startupTimeoutMs: STARTUP_TIMEOUT_MS,
      cacheDir: isDev ? undefined : path.join(dataDir, 'cache'),
    });
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
      saveBackupCopy: (name) => saveBackupCopy({ window: mainWindow, backend: manager, dataDir }, name),
      openBackupFolder: () => openBackupFolder(dataDir),
      restoreBackup: () => restoreFromBackup({ window: mainWindow, backend: manager, dataDir }),
      spotify,
    });

    createWindow();
    // A restore cut short by a crash is undone before the data service opens the database.
    void recoverInterruptedRestore(dataDir)
      .catch(() => null)
      .then((undone) => {
        manager.start();
        if (undone) {
          void dialog.showMessageBox({ type: 'info', title: 'Day Tracker', message: undone });
        }
      });
  });
}
