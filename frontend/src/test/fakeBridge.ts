import { vi } from 'vitest';
import type {
  ApiResult,
  AppSettings,
  BackendState,
  BackupStatus,
  CalendarEvent,
  DailyReview,
  Book,
  ReadingGoal,
  ReadingSession,
  ReadingSessionPage,
  CalendarRange,
  CalendarRangeQuery,
  Category,
  DateRangeQuery,
  DayDetails,
  DayTrackerBridge,
  ExportResult,
  SpotifyPlayback,
  SpotifyStatus,
  Progress,
  Task,
  TaskActivity,
  TaskPage,
  UpdateTaskInput,
} from '../api/bridge';

export function task(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: 'Sample task',
    description: null,
    categoryId: null,
    priority: 'MEDIUM',
    status: 'PENDING',
    plannedDate: null,
    deadlineDate: null,
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-10-04T12:00:00.000Z',
    updatedAt: '2026-10-04T12:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

export function appSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { displayName: '', timezone: 'UTC', weekStart: 1, timeFormat: 'H12', ...overrides };
}

/** A progress report for an interval with nothing recorded; override what a test needs. */
export function progress(overrides: Partial<Progress> & { from: string; to: string }): Progress {
  return {
    today: '2026-10-04',
    tasksCompleted: 0,
    tasksPlanned: 0,
    pagesRead: 0,
    readingDays: 0,
    elapsedDays: 0,
    consistencyPercent: null,
    targetPercent: null,
    days: [],
    completedTasks: [],
    books: [],
    ...overrides,
  };
}

export function category(overrides: Partial<Category> = {}): Category {
  return {
    id: crypto.randomUUID(),
    name: 'Work',
    color: '#668BE8',
    archivedAt: null,
    createdAt: '2026-10-04T12:00:00.000Z',
    updatedAt: '2026-10-04T12:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

export function book(overrides: Partial<Book> = {}): Book {
  return {
    id: crypto.randomUUID(),
    title: 'Sample book',
    author: 'An Author',
    totalPages: 300,
    initialPage: 0,
    status: 'READING',
    archivedAt: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    version: 1,
    currentPage: 0,
    pagesReadTotal: 0,
    coverUpdatedAt: null,
    ...overrides,
  };
}

export function readingSession(overrides: Partial<ReadingSession> = {}): ReadingSession {
  return {
    id: crypto.randomUUID(),
    bookId: crypto.randomUUID(),
    bookTitle: 'Sample book',
    activityDate: '2026-10-04',
    pagesRead: 20,
    endingPage: null,
    notes: null,
    createdAt: '2026-10-04T12:00:00.000Z',
    updatedAt: '2026-10-04T12:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

export function calendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: crypto.randomUUID(),
    title: 'Sample event',
    notes: null,
    categoryId: null,
    allDay: false,
    startsAt: '2026-10-04T12:00:00Z',
    endsAt: '2026-10-04T13:00:00Z',
    timezone: 'UTC',
    localStart: '2026-10-04T12:00:00',
    localEnd: '2026-10-04T13:00:00',
    startDate: null,
    endDateExclusive: null,
    overlapsAnother: false,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

export function dailyReview(overrides: Partial<DailyReview> = {}): DailyReview {
  return {
    id: crypto.randomUUID(),
    reviewDate: '2026-10-04',
    wins: '',
    obstacles: '',
    tomorrowPriority: '',
    createdAt: '2026-10-04T20:00:00.000Z',
    updatedAt: '2026-10-04T20:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

/** A day with nothing recorded and the default reading target. */
export function emptyDay(date: string): DayDetails {
  return {
    date,
    tasks: [],
    carryOver: [],
    readingSessions: [],
    pagesRead: 0,
    readingGoal: { targetPages: 30, effectiveDate: null },
    events: [],
    review: null,
  };
}

export function page(items: Task[]): ApiResult<TaskPage> {
  return { ok: true, data: { items, page: 0, size: 50, total: items.length } };
}

/** Installs a controllable stand-in for the preload bridge on window. */
export function installFakeBridge(initial: BackendState = { status: 'ready' }) {
  const listeners = new Set<(state: BackendState) => void>();
  let state = initial;
  let settings = appSettings();
  const fake = {
    backend: {
      getState: vi.fn(async () => state),
      onStateChange: vi.fn((listener: (next: BackendState) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }),
      restart: vi.fn(async () => undefined),
    },
    app: {
      openDiagnostics: vi.fn(async () => undefined),
      exit: vi.fn(async () => undefined),
    },
    calendar: {
      getRange: vi.fn(
        async (query: CalendarRangeQuery): Promise<ApiResult<CalendarRange>> => ({
          ok: true,
          data: { from: query.from, to: query.to, items: [] },
        }),
      ),
      getDay: vi.fn(
        async (date: string): Promise<ApiResult<DayDetails>> => ({ ok: true, data: emptyDay(date) }),
      ),
    },
    tasks: {
      list: vi.fn(async (): Promise<ApiResult<TaskPage>> => page([])),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(
        async (id: string, input: UpdateTaskInput): Promise<ApiResult<Task>> => ({
          ok: true,
          data: task({ id, version: input.version + 1 }),
        }),
      ),
      getActivity: vi.fn(async (): Promise<ApiResult<TaskActivity[]>> => ({ ok: true, data: [] })),
    },
    categories: {
      list: vi.fn(async (): Promise<ApiResult<Category[]>> => ({ ok: true, data: [] })),
      create: vi.fn(),
      update: vi.fn(),
    },
    books: {
      list: vi.fn(async (): Promise<ApiResult<Book[]>> => ({ ok: true, data: [] })),
      create: vi.fn(),
      update: vi.fn(),
      suggest: vi.fn(),
      findCovers: vi.fn(),
      setCover: vi.fn(),
      chooseCoverFile: vi.fn(),
      removeCover: vi.fn(async (): Promise<ApiResult<null>> => ({ ok: true, data: null })),
    },
    readingSessions: {
      list: vi.fn(
        async (): Promise<ApiResult<ReadingSessionPage>> => ({
          ok: true,
          data: { items: [], page: 0, size: 50, total: 0 },
        }),
      ),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(async (): Promise<ApiResult<null>> => ({ ok: true, data: null })),
    },
    readingGoals: {
      list: vi.fn(async (): Promise<ApiResult<ReadingGoal[]>> => ({ ok: true, data: [] })),
      set: vi.fn(),
    },
    events: {
      list: vi.fn(async (): Promise<ApiResult<CalendarEvent[]>> => ({ ok: true, data: [] })),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(async (): Promise<ApiResult<null>> => ({ ok: true, data: null })),
    },
    reviews: {
      get: vi.fn(),
      save: vi.fn(),
    },
    progress: {
      get: vi.fn(
        async (query: DateRangeQuery): Promise<ApiResult<Progress>> => ({
          ok: true,
          data: progress({ from: query.from, to: query.to }),
        }),
      ),
    },
    settings: {
      get: vi.fn(async (): Promise<ApiResult<AppSettings>> => ({ ok: true, data: settings })),
      update: vi.fn(async (input): Promise<ApiResult<AppSettings>> => {
        settings = { ...settings, ...input };
        return { ok: true, data: settings };
      }),
    },
    backups: {
      status: vi.fn(
        async (): Promise<ApiResult<BackupStatus>> => ({
          ok: true,
          data: { directory: 'C:\Data\backups', backups: [], lastAttempt: null },
        }),
      ),
      backupNow: vi.fn(),
      saveCopy: vi.fn(),
      openFolder: vi.fn(async () => undefined),
      restore: vi.fn(),
    },
    spotify: {
      status: vi.fn(
        async (): Promise<ApiResult<SpotifyStatus>> => ({
          ok: true,
          data: { clientId: null, redirectUri: 'http://127.0.0.1:43821/callback', connected: false, displayName: null },
        }),
      ),
      configure: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      search: vi.fn(),
      playlists: vi.fn(),
      devices: vi.fn(),
      playback: vi.fn(async (): Promise<ApiResult<SpotifyPlayback | null>> => ({ ok: true, data: null })),
      play: vi.fn(async (): Promise<ApiResult<null>> => ({ ok: true, data: null })),
      pause: vi.fn(async (): Promise<ApiResult<null>> => ({ ok: true, data: null })),
      next: vi.fn(async (): Promise<ApiResult<null>> => ({ ok: true, data: null })),
      previous: vi.fn(async (): Promise<ApiResult<null>> => ({ ok: true, data: null })),
      transfer: vi.fn(async (): Promise<ApiResult<null>> => ({ ok: true, data: null })),
    },
    exports: {
      save: vi.fn(
        async (): Promise<ApiResult<ExportResult>> => ({ ok: true, data: { fileName: 'tasks.csv', truncated: false } }),
      ),
    },
  } satisfies DayTrackerBridge;
  window.dayTracker = fake;
  return {
    bridge: fake,
    pushState(next: BackendState) {
      state = next;
      listeners.forEach((listener) => listener(next));
    },
  };
}
