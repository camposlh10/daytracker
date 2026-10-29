import {
  bridge,
  type ApiErrorBody,
  type ApiResult,
  type AppSettings,
  type BackupInfo,
  type BackupStatus,
  type Book,
  type BookSuggestion,
  type CoverCandidate,
  type CoverSource,
  type CalendarEvent,
  type CreateEventInput,
  type DailyReview,
  type SaveReviewInput,
  type UpdateEventInput,
  type CreateBookInput,
  type CreateReadingSessionInput,
  type ReadingGoal,
  type ReadingSession,
  type ReadingSessionPage,
  type ReadingSessionQuery,
  type ServerConnection,
  type SpotifyDevice,
  type SpotifyPlayback,
  type SpotifyPlayInput,
  type SpotifyRepeat,
  type SpotifyTrackPage,
  type Weather,
  type Holiday,
  type SpotifyPlaylist,
  type SpotifySearchResult,
  type SpotifyStatus,
  type UpdateBookInput,
  type UpdateReadingSessionInput,
  type CalendarRange,
  type CalendarRangeQuery,
  type Category,
  type CreateCategoryInput,
  type CreateTaskInput,
  type DateRangeQuery,
  type DayDetails,
  type ExportDataset,
  type ExportResult,
  type Progress,
  type RestoreResult,
  type Task,
  type TaskActivity,
  type TaskListQuery,
  type TaskPage,
  type UpdateCategoryInput,
  type UpdateSettingsInput,
  type UpdateTaskInput,
} from './bridge';

/** A failed backend call, carrying the API error body. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: NonNullable<ApiErrorBody['fieldErrors']>;
  readonly correlationId: string | undefined;

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = body.status;
    this.code = body.code;
    this.fieldErrors = body.fieldErrors ?? [];
    this.correlationId = body.correlationId;
  }
}

async function unwrap<T>(call: Promise<ApiResult<T>>): Promise<T> {
  const result = await call;
  if (!result.ok) {
    throw new ApiError(result.error);
  }
  return result.data;
}

// The single data-access layer: components call these instead of the bridge.
export const tasksApi = {
  list: (query?: TaskListQuery): Promise<TaskPage> => unwrap(bridge().tasks.list(query)),
  get: (id: string): Promise<Task> => unwrap(bridge().tasks.get(id)),
  create: (input: CreateTaskInput): Promise<Task> => unwrap(bridge().tasks.create(input)),
  update: (id: string, input: UpdateTaskInput): Promise<Task> => unwrap(bridge().tasks.update(id, input)),
  getActivity: (id: string): Promise<TaskActivity[]> => unwrap(bridge().tasks.getActivity(id)),
};

export const categoriesApi = {
  list: (): Promise<Category[]> => unwrap(bridge().categories.list()),
  create: (input: CreateCategoryInput): Promise<Category> => unwrap(bridge().categories.create(input)),
  update: (id: string, input: UpdateCategoryInput): Promise<Category> =>
    unwrap(bridge().categories.update(id, input)),
};

export const booksApi = {
  list: (archived = false): Promise<Book[]> => unwrap(bridge().books.list(archived)),
  create: (input: CreateBookInput): Promise<Book> => unwrap(bridge().books.create(input)),
  update: (id: string, input: UpdateBookInput): Promise<Book> => unwrap(bridge().books.update(id, input)),
  suggest: (query: string, techOnly = false): Promise<BookSuggestion[]> =>
    unwrap(bridge().books.suggest(query, techOnly)),
  findCovers: (id: string): Promise<CoverCandidate[]> => unwrap(bridge().books.findCovers(id)),
  setCover: (id: string, sourceId: string, source: CoverSource = 'OPEN_LIBRARY'): Promise<Book> =>
    unwrap(bridge().books.setCover(id, sourceId, source)),
  chooseCoverFile: (id: string): Promise<Book> => unwrap(bridge().books.chooseCoverFile(id)),
  removeCover: (id: string): Promise<null> => unwrap(bridge().books.removeCover(id)),
};

/** The address of a book's stored cover; it changes whenever the cover does. */
export function bookCoverUrl(book: Pick<Book, 'id' | 'coverUpdatedAt'>): string | null {
  return book.coverUpdatedAt ? `dt-cover://book/${book.id}?v=${encodeURIComponent(book.coverUpdatedAt)}` : null;
}

/** The address of a search result's preview image. */
export function candidateCoverUrl(candidate: CoverCandidate): string {
  return coverPreviewUrl(candidate.source, candidate.sourceId);
}

/** The address of a cover preview: an Open Library cover id, or an ISBN on Google Books. */
export function coverPreviewUrl(source: CoverSource, id: string): string {
  return source === 'GOOGLE_BOOKS' ? `dt-cover://google/${id}` : `dt-cover://candidate/${id}`;
}

export const COVER_SOURCE_NAMES: Record<CoverSource, string> = {
  OPEN_LIBRARY: 'Open Library',
  GOOGLE_BOOKS: 'Google Books',
};

export const readingSessionsApi = {
  list: (query?: ReadingSessionQuery): Promise<ReadingSessionPage> => unwrap(bridge().readingSessions.list(query)),
  create: (input: CreateReadingSessionInput): Promise<ReadingSession> =>
    unwrap(bridge().readingSessions.create(input)),
  update: (id: string, input: UpdateReadingSessionInput): Promise<ReadingSession> =>
    unwrap(bridge().readingSessions.update(id, input)),
  delete: (id: string, version: number): Promise<null> => unwrap(bridge().readingSessions.delete(id, version)),
};

export const readingGoalsApi = {
  list: (): Promise<ReadingGoal[]> => unwrap(bridge().readingGoals.list()),
  set: (effectiveDate: string, targetPages: number): Promise<ReadingGoal> =>
    unwrap(bridge().readingGoals.set(effectiveDate, targetPages)),
};

export const eventsApi = {
  list: (query: DateRangeQuery): Promise<CalendarEvent[]> => unwrap(bridge().events.list(query)),
  /** As stored: a repeating appointment with its first occurrence. */
  get: (id: string): Promise<CalendarEvent> => unwrap(bridge().events.get(id)),
  create: (input: CreateEventInput): Promise<CalendarEvent> => unwrap(bridge().events.create(input)),
  update: (id: string, input: UpdateEventInput): Promise<CalendarEvent> => unwrap(bridge().events.update(id, input)),
  delete: (id: string, version: number): Promise<null> => unwrap(bridge().events.delete(id, version)),
};

export const reviewsApi = {
  save: (date: string, input: SaveReviewInput): Promise<DailyReview> => unwrap(bridge().reviews.save(date, input)),
};

export const progressApi = {
  get: (query: DateRangeQuery): Promise<Progress> => unwrap(bridge().progress.get(query)),
};

export const settingsApi = {
  get: (): Promise<AppSettings> => unwrap(bridge().settings.get()),
  update: (input: UpdateSettingsInput): Promise<AppSettings> => unwrap(bridge().settings.update(input)),
};

export const backupsApi = {
  status: (): Promise<BackupStatus> => unwrap(bridge().backups.status()),
  backupNow: (): Promise<BackupInfo> => unwrap(bridge().backups.backupNow()),
  saveCopy: (name: string): Promise<{ fileName: string }> => unwrap(bridge().backups.saveCopy(name)),
  openFolder: (): Promise<void> => bridge().backups.openFolder(),
  restore: (): Promise<RestoreResult> => unwrap(bridge().backups.restore()),
};

export const serverApi = {
  describe: (): Promise<ServerConnection> => bridge().server.describe(),
  test: (url: string, token: string): Promise<{ apiVersion: string }> => unwrap(bridge().server.test({ url, token })),
  /** Restarts the app when it succeeds. */
  use: (choice: { url: string; token: string } | null): Promise<null> => unwrap(bridge().server.use(choice)),
};

export const exportsApi = {
  save: (dataset: ExportDataset, range?: DateRangeQuery): Promise<ExportResult> =>
    unwrap(bridge().exports.save(dataset, range)),
};

export const holidaysApi = {
  list: (year: number): Promise<Holiday[]> => unwrap(bridge().holidays.list(year)),
};

/** Opens a web address in the default browser. */
export const openLink = (url: string): Promise<null> => unwrap(bridge().app.openLink(url));

export const weatherApi = {
  current: (): Promise<Weather> => unwrap(bridge().weather.current()),
};

export const spotifyApi = {
  status: (): Promise<SpotifyStatus> => unwrap(bridge().spotify.status()),
  configure: (clientId: string, redirectUri: string): Promise<SpotifyStatus> =>
    unwrap(bridge().spotify.configure({ clientId, redirectUri })),
  connect: (): Promise<SpotifyStatus> => unwrap(bridge().spotify.connect()),
  disconnect: (): Promise<SpotifyStatus> => unwrap(bridge().spotify.disconnect()),
  search: (query: string): Promise<SpotifySearchResult> => unwrap(bridge().spotify.search(query)),
  playlists: (): Promise<SpotifyPlaylist[]> => unwrap(bridge().spotify.playlists()),
  devices: (): Promise<SpotifyDevice[]> => unwrap(bridge().spotify.devices()),
  playback: (): Promise<SpotifyPlayback | null> => unwrap(bridge().spotify.playback()),
  playlistItems: (playlistId: string, offset = 0): Promise<SpotifyTrackPage> =>
    unwrap(bridge().spotify.playlistItems(playlistId, offset)),
  likedSongs: (offset = 0): Promise<SpotifyTrackPage> => unwrap(bridge().spotify.likedSongs(offset)),
  queue: (uri: string): Promise<null> => unwrap(bridge().spotify.queue(uri)),
  play: (input?: SpotifyPlayInput): Promise<null> => unwrap(bridge().spotify.play(input)),
  pause: (): Promise<null> => unwrap(bridge().spotify.pause()),
  next: (): Promise<null> => unwrap(bridge().spotify.next()),
  previous: (): Promise<null> => unwrap(bridge().spotify.previous()),
  seek: (positionMs: number): Promise<null> => unwrap(bridge().spotify.seek(positionMs)),
  volume: (percent: number): Promise<null> => unwrap(bridge().spotify.volume(percent)),
  shuffle: (on: boolean): Promise<null> => unwrap(bridge().spotify.shuffle(on)),
  repeat: (mode: SpotifyRepeat): Promise<null> => unwrap(bridge().spotify.repeat(mode)),
  transfer: (deviceId: string): Promise<null> => unwrap(bridge().spotify.transfer(deviceId)),
};

/** Album art through the private scheme served by the main process. */
export function spotifyImageUrl(imageId: string | null): string | null {
  return imageId ? `dt-spotify://image/${imageId}` : null;
}

export const calendarApi = {
  getRange: (query: CalendarRangeQuery): Promise<CalendarRange> => unwrap(bridge().calendar.getRange(query)),
  getDay: (date: string): Promise<DayDetails> => unwrap(bridge().calendar.getDay(date)),
};

/** True when the user closed a native dialog without choosing anything. */
export function isCancelled(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'CANCELLED';
}

/** True when the record was changed after it was loaded (stale version). */
export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.fieldErrors[0]?.message ?? error.message;
  }
  return 'Something went wrong. Please try again.';
}
