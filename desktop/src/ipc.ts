import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { BackendManager } from './backend';
import type { SpotifyClient } from './spotifyClient';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];
const STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE'];
const BOOK_STATUSES = ['TO_READ', 'READING', 'FINISHED', 'ABANDONED'];
const TIME_FORMATS = ['H12', 'H24'];
const SPOTIFY_URI = /^spotify:(track|album|playlist|artist):[A-Za-z0-9]{22}$/;
const SPOTIFY_DEVICE = /^[A-Za-z0-9_-]{1,128}$/;
const EXPORT_DATASETS = ['tasks', 'reading-sessions', 'appointments', 'summaries'];
const BACKUP_NAME = /^(manual|auto|pre-migration|safety)-[A-Za-z0-9-]+\.db$/;
const MAX_INTEGER = 1_000_000;
// Generous transport bounds; the backend applies the real field rules.
const MAX_TITLE_CHARS = 2_000;
const MAX_DESCRIPTION_CHARS = 20_000;
const MAX_SHORT_TEXT_CHARS = 500;

export interface IpcContext {
  backend: BackendManager;
  isTrustedSender(event: IpcMainInvokeEvent): boolean;
  openDiagnostics(): Promise<void>;
  exit(): void;
  chooseCoverFile(bookId: string): Promise<unknown>;
  exportCsv(dataset: string, range: { from: string; to: string } | undefined): Promise<unknown>;
  saveBackupCopy(name: string): Promise<unknown>;
  openBackupFolder(): Promise<void>;
  restoreBackup(): Promise<unknown>;
  spotify: SpotifyClient;
  server: {
    describe(): Promise<unknown>;
    test(url: string, token: string): Promise<unknown>;
    use(choice: { url: string; token: string } | null): Promise<unknown>;
  };
}

class InvalidPayload extends Error {}

type Fields = Record<string, unknown>;

/**
 * Registers the complete set of renderer-callable operations. Each one checks
 * the sender, validates its payload, and calls one fixed backend route; there
 * is no generic HTTP, filesystem, or shell passthrough.
 */
export function registerIpc(context: IpcContext): void {
  const { backend } = context;
  const handle = (channel: string, handler: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!context.isTrustedSender(event)) {
        throw new Error('Rejected IPC call from an untrusted sender.');
      }
      try {
        return handler(...args);
      } catch (error) {
        if (error instanceof InvalidPayload) {
          return {
            ok: false,
            error: { status: 400, code: 'INVALID_REQUEST', message: error.message },
          };
        }
        throw error;
      }
    });
  };

  handle('backend:getState', () => backend.getState());
  handle('backend:restart', () => backend.restart());
  handle('app:openDiagnostics', () => context.openDiagnostics());
  handle('app:exit', () => context.exit());

  handle('calendar:getRange', (query) => backend.request('GET', `/api/v1/calendar?${dateRange(query)}`));
  handle('calendar:getDay', (date) => backend.request('GET', `/api/v1/days/${parseDate(date, 'date')}`));
  handle('progress:get', (query) => backend.request('GET', `/api/v1/progress?${dateRange(query)}`));

  handle('tasks:list', (query) => backend.request('GET', `/api/v1/tasks?${taskListQuery(query)}`));
  handle('tasks:get', (id) => backend.request('GET', `/api/v1/tasks/${parseUuid(id, 'id')}`));
  handle('tasks:create', (input) => backend.request('POST', '/api/v1/tasks', createTask(input)));
  handle('tasks:update', (id, input) =>
    backend.request('PATCH', `/api/v1/tasks/${parseUuid(id, 'id')}`, updateTask(input)),
  );
  handle('tasks:getActivity', (id) => backend.request('GET', `/api/v1/tasks/${parseUuid(id, 'id')}/activity`));

  handle('books:list', (archived) =>
    backend.request('GET', `/api/v1/books?archived=${archived === undefined ? false : parseBoolean(archived, 'archived')}`),
  );
  handle('books:create', (input) => backend.request('POST', '/api/v1/books', createBook(input)));
  handle('books:update', (id, input) =>
    backend.request('PATCH', `/api/v1/books/${parseUuid(id, 'id')}`, updateBook(input)),
  );

  handle('books:suggest', (query, techOnly) =>
    backend.request(
      'GET',
      `/api/v1/book-suggestions?${new URLSearchParams({
        q: parseText(query, 'query', MAX_SHORT_TEXT_CHARS),
        tech: String(techOnly === undefined ? false : parseBoolean(techOnly, 'techOnly')),
      })}`,
    ),
  );
  handle('books:findCovers', (id) =>
    backend.request('GET', `/api/v1/books/${parseUuid(id, 'id')}/cover-candidates`),
  );
  handle('books:setCover', (id, sourceId, source) => {
    const from = source === undefined ? 'OPEN_LIBRARY' : parseOneOf(source, 'source', ['OPEN_LIBRARY', 'GOOGLE_BOOKS']);
    const pattern = from === 'GOOGLE_BOOKS' ? /^(\d{9}[\dX]|\d{13})$/ : /^\d{1,12}$/;
    if (typeof sourceId !== 'string' || !pattern.test(sourceId)) {
      throw new InvalidPayload('sourceId must be an Open Library cover id or, for Google Books, an ISBN.');
    }
    return backend.request('PUT', `/api/v1/books/${parseUuid(id, 'id')}/cover`, { source: from, sourceId });
  });
  handle('books:chooseCoverFile', (id) => context.chooseCoverFile(parseUuid(id, 'id')));
  handle('books:removeCover', (id) => backend.request('DELETE', `/api/v1/books/${parseUuid(id, 'id')}/cover`));

  handle('readingSessions:list', (query) =>
    backend.request('GET', `/api/v1/reading-sessions?${readingSessionQuery(query)}`),
  );
  handle('readingSessions:create', (input) =>
    backend.request('POST', '/api/v1/reading-sessions', createReadingSession(input)),
  );
  handle('readingSessions:update', (id, input) =>
    backend.request('PATCH', `/api/v1/reading-sessions/${parseUuid(id, 'id')}`, updateReadingSession(input)),
  );
  handle('readingSessions:delete', (id, version) =>
    backend.request(
      'DELETE',
      `/api/v1/reading-sessions/${parseUuid(id, 'id')}?version=${parseInteger(version, 'version', 1, Number.MAX_SAFE_INTEGER)}`,
    ),
  );

  handle('readingGoals:list', () => backend.request('GET', '/api/v1/reading-goals'));
  handle('readingGoals:set', (effectiveDate, targetPages) =>
    backend.request('PUT', `/api/v1/reading-goals/${parseDate(effectiveDate, 'effectiveDate')}`, {
      targetPages: parseInteger(targetPages, 'targetPages', -MAX_INTEGER, MAX_INTEGER),
    }),
  );

  handle('events:list', (query) => backend.request('GET', `/api/v1/events?${dateRange(query)}`));
  handle('events:create', (input) => backend.request('POST', '/api/v1/events', createEvent(input)));
  handle('events:update', (id, input) =>
    backend.request('PATCH', `/api/v1/events/${parseUuid(id, 'id')}`, updateEvent(input)),
  );
  handle('events:delete', (id, version) =>
    backend.request(
      'DELETE',
      `/api/v1/events/${parseUuid(id, 'id')}?version=${parseInteger(version, 'version', 1, Number.MAX_SAFE_INTEGER)}`,
    ),
  );

  handle('reviews:get', (date) => backend.request('GET', `/api/v1/reviews/${parseDate(date, 'date')}`));
  handle('reviews:save', (date, input) =>
    backend.request('PUT', `/api/v1/reviews/${parseDate(date, 'date')}`, saveReview(input)),
  );

  handle('settings:get', () => backend.request('GET', '/api/v1/settings'));
  handle('settings:update', (input) => backend.request('PATCH', '/api/v1/settings', updateSettings(input)));

  handle('backups:status', () => backend.request('GET', '/api/v1/backups'));
  handle('backups:backupNow', () => backend.request('POST', '/api/v1/backups'));
  handle('backups:saveCopy', (name) => {
    if (typeof name !== 'string' || !BACKUP_NAME.test(name)) {
      throw new InvalidPayload('name must be the name of a backup.');
    }
    return context.saveBackupCopy(name);
  });
  handle('backups:openFolder', () => context.openBackupFolder());
  handle('backups:restore', () => context.restoreBackup());

  handle('exports:save', (dataset, range) =>
    context.exportCsv(
      parseOneOf(dataset, 'dataset', EXPORT_DATASETS),
      range === undefined || range === null ? undefined : exportRange(range),
    ),
  );

  handle('server:describe', () => context.server.describe());
  handle('server:test', (input) => {
    const fields = asRecord(input);
    return context.server.test(parseText(fields.url, 'url', 300), parseText(fields.token, 'token', 512));
  });
  handle('server:use', (input) => {
    if (input === null) {
      return context.server.use(null);
    }
    const fields = asRecord(input);
    return context.server.use({ url: parseText(fields.url, 'url', 300), token: parseText(fields.token, 'token', 512) });
  });

  const { spotify } = context;
  handle('spotify:status', () => spotify.status());
  handle('spotify:configure', (input) => {
    const fields = asRecord(input);
    return spotify.configure(parseText(fields.clientId, 'clientId', 64), parseText(fields.redirectUri, 'redirectUri', 200));
  });
  handle('spotify:connect', () => spotify.connect());
  handle('spotify:disconnect', () => spotify.disconnect());
  handle('spotify:search', (query) => {
    const text = parseText(query, 'query', 200).trim();
    if (text.length === 0) {
      throw new InvalidPayload('query must not be empty.');
    }
    return spotify.search(text);
  });
  handle('spotify:playlists', () => spotify.playlists());
  handle('spotify:devices', () => spotify.devices());
  handle('spotify:playback', () => spotify.playback());
  handle('spotify:play', (input) => {
    const fields = input === undefined || input === null ? {} : asRecord(input);
    return spotify.play({
      uri: fields.uri === undefined ? undefined : parsePattern(fields.uri, 'uri', SPOTIFY_URI),
      deviceId: fields.deviceId === undefined ? undefined : parsePattern(fields.deviceId, 'deviceId', SPOTIFY_DEVICE),
    });
  });
  handle('spotify:pause', () => spotify.pause());
  handle('spotify:next', () => spotify.next());
  handle('spotify:previous', () => spotify.previous());
  handle('spotify:transfer', (deviceId) => spotify.transfer(parsePattern(deviceId, 'deviceId', SPOTIFY_DEVICE)));

  handle('categories:list', () => backend.request('GET', '/api/v1/categories'));
  handle('categories:create', (input) => backend.request('POST', '/api/v1/categories', createCategory(input)));
  handle('categories:update', (id, input) =>
    backend.request('PATCH', `/api/v1/categories/${parseUuid(id, 'id')}`, updateCategory(input)),
  );
}

function dateRange(value: unknown): string {
  const range = asRecord(value);
  return new URLSearchParams({ from: parseDate(range.from, 'from'), to: parseDate(range.to, 'to') }).toString();
}

function exportRange(value: unknown): { from: string; to: string } {
  const range = asRecord(value);
  return { from: parseDate(range.from, 'from'), to: parseDate(range.to, 'to') };
}

function updateSettings(value: unknown): Fields {
  const input = asRecord(value);
  const settings: Fields = {};
  if (input.displayName !== undefined) {
    settings.displayName = parseText(input.displayName, 'displayName', MAX_SHORT_TEXT_CHARS);
  }
  if (input.timezone !== undefined) {
    settings.timezone = parseText(input.timezone, 'timezone', 64);
  }
  if (input.weekStart !== undefined) {
    settings.weekStart = parseInteger(input.weekStart, 'weekStart', 0, 6);
  }
  if (input.timeFormat !== undefined) {
    settings.timeFormat = parseOneOf(input.timeFormat, 'timeFormat', TIME_FORMATS);
  }
  return settings;
}

function taskListQuery(value: unknown): string {
  const query = value === undefined || value === null ? {} : asRecord(value);
  const params = new URLSearchParams({
    page: String(parseInteger(query.page ?? 0, 'page', 0, 1_000_000)),
    size: String(parseInteger(query.size ?? 50, 'size', 1, 200)),
  });
  if (query.q !== undefined) {
    params.set('q', parseText(query.q, 'q', MAX_SHORT_TEXT_CHARS));
  }
  if (query.status !== undefined) {
    params.set('status', parseOneOf(query.status, 'status', STATUSES));
  }
  if (query.priority !== undefined) {
    params.set('priority', parseOneOf(query.priority, 'priority', PRIORITIES));
  }
  if (query.categoryId !== undefined) {
    params.set('categoryId', parseUuid(query.categoryId, 'categoryId'));
  }
  if (query.plannedFrom !== undefined) {
    params.set('plannedFrom', parseDate(query.plannedFrom, 'plannedFrom'));
  }
  if (query.plannedTo !== undefined) {
    params.set('plannedTo', parseDate(query.plannedTo, 'plannedTo'));
  }
  if (query.scheduled !== undefined) {
    params.set('scheduled', String(parseBoolean(query.scheduled, 'scheduled')));
  }
  if (query.archived !== undefined) {
    params.set('archived', String(parseBoolean(query.archived, 'archived')));
  }
  return params.toString();
}

function createTask(value: unknown): Fields {
  const input = asRecord(value);
  const task: Fields = {
    id: parseUuid(input.id, 'id'),
    title: parseText(input.title, 'title', MAX_TITLE_CHARS),
  };
  copyTaskFields(input, task, false);
  return task;
}

function updateTask(value: unknown): Fields {
  const input = asRecord(value);
  const task: Fields = { version: parseInteger(input.version, 'version', 1, Number.MAX_SAFE_INTEGER) };
  if (input.title !== undefined) {
    task.title = parseText(input.title, 'title', MAX_TITLE_CHARS);
  }
  copyTaskFields(input, task, true);
  return task;
}

/** Copies the optional task fields that are present; null clears a nullable field. */
function copyTaskFields(input: Fields, task: Fields, isUpdate: boolean): void {
  if (input.description !== undefined) {
    task.description = nullable(input.description, (v) => parseText(v, 'description', MAX_DESCRIPTION_CHARS));
  }
  if (input.categoryId !== undefined) {
    task.categoryId = nullable(input.categoryId, (v) => parseUuid(v, 'categoryId'));
  }
  if (input.priority !== undefined) {
    task.priority = parseOneOf(input.priority, 'priority', PRIORITIES);
  }
  if (input.plannedDate !== undefined) {
    task.plannedDate = nullable(input.plannedDate, (v) => parseDate(v, 'plannedDate'));
  }
  if (input.deadlineDate !== undefined) {
    task.deadlineDate = nullable(input.deadlineDate, (v) => parseDate(v, 'deadlineDate'));
  }
  if (isUpdate && input.status !== undefined) {
    task.status = parseOneOf(input.status, 'status', STATUSES);
  }
  if (isUpdate && input.archived !== undefined) {
    task.archived = parseBoolean(input.archived, 'archived');
  }
}

function createCategory(value: unknown): Fields {
  const input = asRecord(value);
  return {
    id: parseUuid(input.id, 'id'),
    name: parseText(input.name, 'name', MAX_SHORT_TEXT_CHARS),
    color: parseText(input.color, 'color', 20),
  };
}

function updateCategory(value: unknown): Fields {
  const input = asRecord(value);
  const category: Fields = { version: parseInteger(input.version, 'version', 1, Number.MAX_SAFE_INTEGER) };
  if (input.name !== undefined) {
    category.name = parseText(input.name, 'name', MAX_SHORT_TEXT_CHARS);
  }
  if (input.color !== undefined) {
    category.color = parseText(input.color, 'color', 20);
  }
  if (input.archived !== undefined) {
    category.archived = parseBoolean(input.archived, 'archived');
  }
  return category;
}

function createBook(value: unknown): Fields {
  const input = asRecord(value);
  const book: Fields = {
    id: parseUuid(input.id, 'id'),
    title: parseText(input.title, 'title', MAX_TITLE_CHARS),
    totalPages: parseInteger(input.totalPages, 'totalPages', -MAX_INTEGER, MAX_INTEGER),
  };
  if (input.author !== undefined) {
    book.author = nullable(input.author, (v) => parseText(v, 'author', MAX_SHORT_TEXT_CHARS));
  }
  if (input.initialPage !== undefined) {
    book.initialPage = parseInteger(input.initialPage, 'initialPage', -MAX_INTEGER, MAX_INTEGER);
  }
  if (input.status !== undefined) {
    book.status = parseOneOf(input.status, 'status', BOOK_STATUSES);
  }
  return book;
}

function updateBook(value: unknown): Fields {
  const input = asRecord(value);
  const book: Fields = { version: parseInteger(input.version, 'version', 1, Number.MAX_SAFE_INTEGER) };
  if (input.title !== undefined) {
    book.title = parseText(input.title, 'title', MAX_TITLE_CHARS);
  }
  if (input.author !== undefined) {
    book.author = parseText(input.author, 'author', MAX_SHORT_TEXT_CHARS);
  }
  if (input.totalPages !== undefined) {
    book.totalPages = parseInteger(input.totalPages, 'totalPages', -MAX_INTEGER, MAX_INTEGER);
  }
  if (input.initialPage !== undefined) {
    book.initialPage = parseInteger(input.initialPage, 'initialPage', -MAX_INTEGER, MAX_INTEGER);
  }
  if (input.status !== undefined) {
    book.status = parseOneOf(input.status, 'status', BOOK_STATUSES);
  }
  if (input.archived !== undefined) {
    book.archived = parseBoolean(input.archived, 'archived');
  }
  return book;
}

function readingSessionQuery(value: unknown): string {
  const query = value === undefined || value === null ? {} : asRecord(value);
  const params = new URLSearchParams({
    page: String(parseInteger(query.page ?? 0, 'page', 0, 1_000_000)),
    size: String(parseInteger(query.size ?? 50, 'size', 1, 200)),
  });
  if (query.bookId !== undefined) {
    params.set('bookId', parseUuid(query.bookId, 'bookId'));
  }
  if (query.from !== undefined) {
    params.set('from', parseDate(query.from, 'from'));
  }
  if (query.to !== undefined) {
    params.set('to', parseDate(query.to, 'to'));
  }
  return params.toString();
}

function createReadingSession(value: unknown): Fields {
  const input = asRecord(value);
  const session: Fields = {
    id: parseUuid(input.id, 'id'),
    bookId: parseUuid(input.bookId, 'bookId'),
    activityDate: parseDate(input.activityDate, 'activityDate'),
    pagesRead: parseInteger(input.pagesRead, 'pagesRead', -MAX_INTEGER, MAX_INTEGER),
  };
  copySessionFields(input, session);
  return session;
}

function updateReadingSession(value: unknown): Fields {
  const input = asRecord(value);
  const session: Fields = { version: parseInteger(input.version, 'version', 1, Number.MAX_SAFE_INTEGER) };
  if (input.activityDate !== undefined) {
    session.activityDate = parseDate(input.activityDate, 'activityDate');
  }
  if (input.pagesRead !== undefined) {
    session.pagesRead = parseInteger(input.pagesRead, 'pagesRead', -MAX_INTEGER, MAX_INTEGER);
  }
  copySessionFields(input, session);
  return session;
}

function copySessionFields(input: Fields, session: Fields): void {
  if (input.endingPage !== undefined) {
    session.endingPage = nullable(input.endingPage, (v) => parseInteger(v, 'endingPage', -MAX_INTEGER, MAX_INTEGER));
  }
  if (input.notes !== undefined) {
    session.notes = nullable(input.notes, (v) => parseText(v, 'notes', MAX_DESCRIPTION_CHARS));
  }
}

function createEvent(value: unknown): Fields {
  const input = asRecord(value);
  return { id: parseUuid(input.id, 'id'), ...eventFields(input) };
}

function updateEvent(value: unknown): Fields {
  const input = asRecord(value);
  return { version: parseInteger(input.version, 'version', 1, Number.MAX_SAFE_INTEGER), ...eventFields(input) };
}

function eventFields(input: Fields): Fields {
  const event: Fields = {
    title: parseText(input.title, 'title', MAX_TITLE_CHARS),
    allDay: parseBoolean(input.allDay, 'allDay'),
  };
  if (input.notes !== undefined) {
    event.notes = nullable(input.notes, (v) => parseText(v, 'notes', MAX_DESCRIPTION_CHARS));
  }
  if (input.categoryId !== undefined) {
    event.categoryId = nullable(input.categoryId, (v) => parseUuid(v, 'categoryId'));
  }
  if (input.start !== undefined) {
    event.start = parseLocalDateTime(input.start, 'start');
  }
  if (input.end !== undefined) {
    event.end = parseLocalDateTime(input.end, 'end');
  }
  if (input.timezone !== undefined) {
    event.timezone = parseText(input.timezone, 'timezone', 64);
  }
  if (input.startDate !== undefined) {
    event.startDate = parseDate(input.startDate, 'startDate');
  }
  if (input.endDateExclusive !== undefined) {
    event.endDateExclusive = parseDate(input.endDateExclusive, 'endDateExclusive');
  }
  return event;
}

function saveReview(value: unknown): Fields {
  const input = asRecord(value);
  return {
    version: nullable(input.version, (v) => parseInteger(v, 'version', 1, Number.MAX_SAFE_INTEGER)),
    wins: parseText(input.wins, 'wins', MAX_DESCRIPTION_CHARS),
    obstacles: parseText(input.obstacles, 'obstacles', MAX_DESCRIPTION_CHARS),
    tomorrowPriority: parseText(input.tomorrowPriority, 'tomorrowPriority', MAX_DESCRIPTION_CHARS),
  };
}

function parsePattern(value: unknown, field: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new InvalidPayload(`${field} is not in the expected form.`);
  }
  return value;
}

function parseLocalDateTime(value: unknown, field: string): string {
  if (typeof value !== 'string' || !LOCAL_DATE_TIME.test(value)) {
    throw new InvalidPayload(`${field} must be a YYYY-MM-DDTHH:mm date and time.`);
  }
  return value;
}

function asRecord(value: unknown): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidPayload('Expected an object.');
  }
  return value as Fields;
}

function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

function parseText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new InvalidPayload(`${field} must be text of a reasonable length.`);
  }
  return value;
}

function parseOneOf(value: unknown, field: string, allowed: string[]): string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new InvalidPayload(`${field} must be one of ${allowed.join(', ')}.`);
  }
  return value;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new InvalidPayload(`${field} must be true or false.`);
  }
  return value;
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new InvalidPayload(`${field} must be a UUID.`);
  }
  return value.toLowerCase();
}

function parseInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new InvalidPayload(`${field} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function parseDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new InvalidPayload(`${field} must be a YYYY-MM-DD date.`);
  }
  return value;
}
