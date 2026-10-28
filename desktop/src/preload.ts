import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { BackendState, DayTrackerBridge } from './shared/bridge-types';

// Each method maps to one fixed channel. ipcRenderer itself is never exposed,
// and the renderer never sees the backend port or launch token.
const bridge: DayTrackerBridge = {
  backend: {
    getState: () => ipcRenderer.invoke('backend:getState'),
    onStateChange: (listener) => {
      const handler = (_event: IpcRendererEvent, state: BackendState) => listener(state);
      ipcRenderer.on('backend:state', handler);
      return () => {
        ipcRenderer.removeListener('backend:state', handler);
      };
    },
    restart: () => ipcRenderer.invoke('backend:restart'),
  },
  app: {
    openDiagnostics: () => ipcRenderer.invoke('app:openDiagnostics'),
    exit: () => ipcRenderer.invoke('app:exit'),
  },
  calendar: {
    getRange: (query) => ipcRenderer.invoke('calendar:getRange', query),
    getDay: (date) => ipcRenderer.invoke('calendar:getDay', date),
  },
  tasks: {
    list: (query) => ipcRenderer.invoke('tasks:list', query),
    get: (id) => ipcRenderer.invoke('tasks:get', id),
    create: (input) => ipcRenderer.invoke('tasks:create', input),
    update: (id, input) => ipcRenderer.invoke('tasks:update', id, input),
    getActivity: (id) => ipcRenderer.invoke('tasks:getActivity', id),
  },
  categories: {
    list: () => ipcRenderer.invoke('categories:list'),
    create: (input) => ipcRenderer.invoke('categories:create', input),
    update: (id, input) => ipcRenderer.invoke('categories:update', id, input),
  },
  books: {
    list: (archived) => ipcRenderer.invoke('books:list', archived),
    create: (input) => ipcRenderer.invoke('books:create', input),
    update: (id, input) => ipcRenderer.invoke('books:update', id, input),
    suggest: (query, techOnly) => ipcRenderer.invoke('books:suggest', query, techOnly),
    findCovers: (id) => ipcRenderer.invoke('books:findCovers', id),
    setCover: (id, sourceId, source) => ipcRenderer.invoke('books:setCover', id, sourceId, source),
    chooseCoverFile: (id) => ipcRenderer.invoke('books:chooseCoverFile', id),
    removeCover: (id) => ipcRenderer.invoke('books:removeCover', id),
  },
  readingSessions: {
    list: (query) => ipcRenderer.invoke('readingSessions:list', query),
    create: (input) => ipcRenderer.invoke('readingSessions:create', input),
    update: (id, input) => ipcRenderer.invoke('readingSessions:update', id, input),
    delete: (id, version) => ipcRenderer.invoke('readingSessions:delete', id, version),
  },
  readingGoals: {
    list: () => ipcRenderer.invoke('readingGoals:list'),
    set: (effectiveDate, targetPages) => ipcRenderer.invoke('readingGoals:set', effectiveDate, targetPages),
  },
  events: {
    list: (query) => ipcRenderer.invoke('events:list', query),
    create: (input) => ipcRenderer.invoke('events:create', input),
    update: (id, input) => ipcRenderer.invoke('events:update', id, input),
    delete: (id, version) => ipcRenderer.invoke('events:delete', id, version),
  },
  reviews: {
    get: (date) => ipcRenderer.invoke('reviews:get', date),
    save: (date, input) => ipcRenderer.invoke('reviews:save', date, input),
  },
  progress: {
    get: (query) => ipcRenderer.invoke('progress:get', query),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (input) => ipcRenderer.invoke('settings:update', input),
  },
  backups: {
    status: () => ipcRenderer.invoke('backups:status'),
    backupNow: () => ipcRenderer.invoke('backups:backupNow'),
    saveCopy: (name) => ipcRenderer.invoke('backups:saveCopy', name),
    openFolder: () => ipcRenderer.invoke('backups:openFolder'),
    restore: () => ipcRenderer.invoke('backups:restore'),
  },
  exports: {
    save: (dataset, range) => ipcRenderer.invoke('exports:save', dataset, range),
  },
  server: {
    describe: () => ipcRenderer.invoke('server:describe'),
    test: (input) => ipcRenderer.invoke('server:test', input),
    use: (input) => ipcRenderer.invoke('server:use', input),
  },
  spotify: {
    status: () => ipcRenderer.invoke('spotify:status'),
    configure: (input) => ipcRenderer.invoke('spotify:configure', input),
    connect: () => ipcRenderer.invoke('spotify:connect'),
    disconnect: () => ipcRenderer.invoke('spotify:disconnect'),
    search: (query) => ipcRenderer.invoke('spotify:search', query),
    playlists: () => ipcRenderer.invoke('spotify:playlists'),
    devices: () => ipcRenderer.invoke('spotify:devices'),
    playback: () => ipcRenderer.invoke('spotify:playback'),
    play: (input) => ipcRenderer.invoke('spotify:play', input),
    pause: () => ipcRenderer.invoke('spotify:pause'),
    next: () => ipcRenderer.invoke('spotify:next'),
    previous: () => ipcRenderer.invoke('spotify:previous'),
    transfer: (deviceId) => ipcRenderer.invoke('spotify:transfer', deviceId),
  },
};

contextBridge.exposeInMainWorld('dayTracker', bridge);
