// Types shared by the Electron main process, the preload script, and the React
// frontend. Type-only: the sandboxed preload cannot load other modules at runtime.
// DTO shapes mirror contracts/openapi.yaml.

export type BackendState =
  | { status: 'starting' }
  | { status: 'ready' }
  | { status: 'failed'; reason: 'startup' | 'timeout' | 'crashed'; message: string };

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  plannedDate: string | null;
  deadlineDate: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface TaskPage {
  items: Task[];
  page: number;
  size: number;
  total: number;
}

export interface CreateTaskInput {
  /** Client-generated UUID; repeating the same create is safe. */
  id: string;
  title: string;
  description?: string | null;
  categoryId?: string | null;
  priority?: TaskPriority;
  plannedDate?: string | null;
  deadlineDate?: string | null;
}

/**
 * A partial update: only the properties present are changed, and null clears a
 * nullable one. `version` is the version last seen; a stale one is refused (409).
 */
export interface UpdateTaskInput {
  version: number;
  title?: string;
  description?: string | null;
  categoryId?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  plannedDate?: string | null;
  deadlineDate?: string | null;
  archived?: boolean;
}

export interface TaskListQuery {
  page?: number;
  size?: number;
  /** Searches title and description. */
  q?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  categoryId?: string;
  /** Inclusive, YYYY-MM-DD. */
  plannedFrom?: string;
  /** Exclusive, YYYY-MM-DD. */
  plannedTo?: string;
  /** false lists only tasks without a planned date. */
  scheduled?: boolean;
  /** true lists archived tasks instead of normal ones. */
  archived?: boolean;
}

export interface TaskActivity {
  action: 'CREATED' | 'COMPLETED' | 'REOPENED' | 'STATUS_CHANGED' | 'RESCHEDULED' | 'ARCHIVED' | 'RESTORED' | 'EDITED';
  previousStatus: TaskStatus | null;
  newStatus: TaskStatus | null;
  previousPlannedDate: string | null;
  newPlannedDate: string | null;
  occurredAt: string;
}

export interface Category {
  id: string;
  name: string;
  /** #RRGGBB */
  color: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateCategoryInput {
  id: string;
  name: string;
  color: string;
}

export interface UpdateCategoryInput {
  version: number;
  name?: string;
  color?: string;
  archived?: boolean;
}

export type BookStatus = 'TO_READ' | 'READING' | 'FINISHED' | 'ABANDONED';

export interface Book {
  id: string;
  title: string;
  author: string | null;
  totalPages: number;
  initialPage: number;
  status: BookStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** Position: the ending page of the latest dated session that recorded one, else the initial page. */
  currentPage: number;
  /** Effort: the sum of pages read in all sessions. Independent of the position. */
  pagesReadTotal: number;
  /** When the cover image last changed; null when the book has no cover. */
  coverUpdatedAt: string | null;
}

/**
 * Where a cover comes from: an Open Library cover id, or, when Open Library has
 * no cover, the Google Books cover of an ISBN. Google can answer an ISBN with the
 * wrong book, so its covers are always shown for confirmation first.
 */
export type CoverSource = 'OPEN_LIBRARY' | 'GOOGLE_BOOKS';

/** A book suggested from Open Library while a title is typed. */
export interface BookSuggestion {
  title: string;
  author: string | null;
  /** Set only for known technical publishers, such as O'Reilly or Manning. */
  publisher: string | null;
  firstPublishYear: number | null;
  /** The typical page count across editions; only a starting value. */
  totalPages: number | null;
  coverSource: CoverSource | null;
  /** Usable with setCover together with coverSource. */
  coverId: string | null;
}

/** An Open Library search result that has a cover. */
export interface CoverCandidate {
  source: CoverSource;
  /** An Open Library cover id, or an ISBN for Google Books. */
  sourceId: string;
  title: string;
  author: string | null;
  firstPublishYear: number | null;
}

export interface CreateBookInput {
  id: string;
  title: string;
  author?: string | null;
  totalPages: number;
  initialPage?: number;
  status?: BookStatus;
}

/** Omitted properties are unchanged; an empty author clears it. */
export interface UpdateBookInput {
  version: number;
  title?: string;
  author?: string;
  totalPages?: number;
  initialPage?: number;
  status?: BookStatus;
  archived?: boolean;
}

export interface ReadingSession {
  id: string;
  bookId: string;
  bookTitle: string;
  /** YYYY-MM-DD */
  activityDate: string;
  pagesRead: number;
  endingPage: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateReadingSessionInput {
  id: string;
  bookId: string;
  activityDate: string;
  pagesRead: number;
  endingPage?: number | null;
  notes?: string | null;
}

/** Only the properties present are changed; null removes the ending page or the notes. */
export interface UpdateReadingSessionInput {
  version: number;
  activityDate?: string;
  pagesRead?: number;
  endingPage?: number | null;
  notes?: string | null;
}

export interface ReadingSessionQuery {
  bookId?: string;
  /** Inclusive, YYYY-MM-DD. */
  from?: string;
  /** Exclusive, YYYY-MM-DD. */
  to?: string;
  page?: number;
  size?: number;
}

export interface ReadingSessionPage {
  items: ReadingSession[];
  page: number;
  size: number;
  total: number;
}

export interface ReadingGoal {
  effectiveDate: string;
  targetPages: number;
  updatedAt: string;
}

/** The daily target in force on a date; effectiveDate is null for the built-in default. */
export interface EffectiveReadingGoal {
  targetPages: number;
  effectiveDate: string | null;
}

/**
 * An appointment. A timed event has instants (shown in this computer's zone) and
 * the zone it was entered in, with its wall-clock start and end there for
 * editing. An all-day event has a start date and an exclusive end date only.
 */
export interface CalendarEvent {
  id: string;
  title: string;
  notes: string | null;
  categoryId: string | null;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  /** IANA zone, such as Europe/Lisbon. */
  timezone: string | null;
  /** YYYY-MM-DDTHH:mm:ss in the event's zone. */
  localStart: string | null;
  localEnd: string | null;
  startDate: string | null;
  endDateExclusive: string | null;
  /** True when a timed event overlaps another one. Overlaps are allowed. */
  overlapsAnother: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * Every editable field of an event. A timed event sends start, end (wall-clock
 * YYYY-MM-DDTHH:mm) and timezone; an all-day event sends startDate and the
 * exclusive endDateExclusive. The other kind's fields are left out.
 */
export interface EventFields {
  title: string;
  notes?: string | null;
  categoryId?: string | null;
  allDay: boolean;
  start?: string;
  end?: string;
  timezone?: string;
  startDate?: string;
  endDateExclusive?: string;
}

export type CreateEventInput = EventFields & { id: string };
export type UpdateEventInput = EventFields & { version: number };

export interface DailyReview {
  id: string;
  reviewDate: string;
  wins: string;
  obstacles: string;
  tomorrowPriority: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** version is null for the first save of a date, and the loaded version after that. */
export interface SaveReviewInput {
  version: number | null;
  wins: string;
  obstacles: string;
  tomorrowPriority: string;
}

/**
 * A compact entry on a calendar date: an appointment (on every date it
 * overlaps), the reading recorded on that date (one entry per book), or a
 * planned task. Listed in that order within a date.
 */
export type CalendarItem =
  | {
      type: 'EVENT';
      id: string;
      date: string;
      title: string;
      allDay: boolean;
      startsAt: string | null;
      endsAt: string | null;
      /** The event began on an earlier date. */
      continued: boolean;
      overlapsAnother: boolean;
    }
  | {
      type: 'TASK';
      id: string;
      /** YYYY-MM-DD */
      date: string;
      title: string;
      status: TaskStatus;
      priority: TaskPriority;
    }
  | {
      type: 'READING';
      id: string;
      date: string;
      /** The book's title. */
      title: string;
      /** Pages of that book read on that date. */
      pagesRead: number;
      bookId: string;
      /** When the book's cover last changed; null when it has none. */
      coverUpdatedAt: string | null;
    };

export interface CalendarRange {
  /** Inclusive, YYYY-MM-DD. */
  from: string;
  /** Exclusive, YYYY-MM-DD. */
  to: string;
  items: CalendarItem[];
}

export interface DateRangeQuery {
  /** Inclusive, YYYY-MM-DD. */
  from: string;
  /** Exclusive, YYYY-MM-DD. */
  to: string;
}

export type CalendarRangeQuery = DateRangeQuery;

export interface DayDetails {
  date: string;
  tasks: Task[];
  /** Unfinished tasks planned on earlier dates that have already passed. */
  carryOver: Task[];
  readingSessions: ReadingSession[];
  /** Sum of pages read in this date's sessions. */
  pagesRead: number;
  readingGoal: EffectiveReadingGoal;
  /** Appointments overlapping this date: all-day first, then by start time. */
  events: CalendarEvent[];
  /** Null until a review is written for this date. */
  review: DailyReview | null;
}

/** One day of a progress report. Dates are in the configured timezone. */
export interface DayProgress {
  date: string;
  tasksCompleted: number;
  pagesRead: number;
  /** The daily target in force on that date. */
  targetPages: number;
  /** Pages read against the target, not capped; null for a day that has not begun. */
  targetPercent: number | null;
  /** True for a day after today: planned items may exist but no activity can. */
  future: boolean;
}

/** A book read during the period, with where it stands now. */
export interface BookProgress {
  bookId: string;
  title: string;
  coverUpdatedAt: string | null;
  /** Pages read in the period. */
  pagesRead: number;
  /** Where the book stands now, which is not limited to the period. */
  currentPage: number;
  totalPages: number;
  positionPercent: number;
}

/**
 * A report for an interval. Rates cover only the days that have begun, so a week
 * in progress is judged on the days elapsed; a period that has not begun has no rates.
 */
export interface Progress {
  from: string;
  to: string;
  /** Today in the configured timezone. */
  today: string;
  tasksCompleted: number;
  /** Tasks planned on a date in the interval, finished or not; archived ones are left out. */
  tasksPlanned: number;
  pagesRead: number;
  /** Distinct dates in the interval with reading. */
  readingDays: number;
  /** Days of the interval up to and including today. */
  elapsedDays: number;
  /** Reading days as a share of elapsed days; null when no day has begun. */
  consistencyPercent: number | null;
  /** Pages read against the targets of the elapsed days, not capped; null when no day has begun. */
  targetPercent: number | null;
  days: DayProgress[];
  /** The tasks behind tasksCompleted, oldest first (at most 500). */
  completedTasks: Task[];
  books: BookProgress[];
}

export type TimeFormat = 'H12' | 'H24';

export interface AppSettings {
  /** May be empty. */
  displayName: string;
  /** An IANA region, such as America/Sao_Paulo. */
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekStart: number;
  timeFormat: TimeFormat;
}

/** Only the properties present are changed. */
export type UpdateSettingsInput = Partial<AppSettings>;

export type BackupKind = 'MANUAL' | 'AUTOMATIC' | 'PRE_MIGRATION' | 'SAFETY';

export interface BackupInfo {
  name: string;
  kind: BackupKind;
  createdAt: string;
  sizeBytes: number;
  schemaVersion: number | null;
  appVersion: string | null;
  verified: boolean;
}

export interface BackupAttempt {
  kind: BackupKind;
  ok: boolean;
  at: string;
  message: string;
  fileName: string | null;
}

export interface BackupStatus {
  /** Where backups are kept. */
  directory: string;
  /** Newest first. */
  backups: BackupInfo[];
  /** Null until a backup was attempted in this session. */
  lastAttempt: BackupAttempt | null;
}

export type ExportDataset = 'tasks' | 'reading-sessions' | 'appointments' | 'summaries';

export interface ExportResult {
  fileName: string;
  /** True when the data was cut at the export size limit. */
  truncated: boolean;
}

export interface RestoreResult {
  /** What the restored data contains. */
  counts: Record<string, number>;
}

/** Where the data lives. Null addresses mean this computer. */
export interface ServerConnection {
  /** The server this session uses. */
  activeUrl: string | null;
  /** The server chosen for the next start. */
  savedUrl: string | null;
  /** False when Windows cannot encrypt the token, so a server cannot be saved. */
  canEncrypt: boolean;
}

/** Whether Spotify is set up. The Client ID comes from the user's own app in the Spotify developer dashboard. */
export interface SpotifyStatus {
  clientId: string | null;
  /** Exactly as registered in the Spotify dashboard. */
  redirectUri: string;
  connected: boolean;
  /** Null until known; may be empty. */
  displayName: string | null;
}

export interface SpotifyTrack {
  /** spotify:track:... */
  uri: string;
  name: string;
  artists: string;
  album: string;
  durationMs: number;
  /** Album art, shown through dt-spotify://image/<id>; null when there is none. */
  imageId: string | null;
}

export interface SpotifyPlaylist {
  /** spotify:playlist:... */
  uri: string;
  name: string;
  owner: string;
  trackCount: number | null;
  imageId: string | null;
}

export interface SpotifySearchResult {
  tracks: SpotifyTrack[];
  playlists: SpotifyPlaylist[];
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

/** What is playing on the user's active Spotify device. */
export interface SpotifyPlayback {
  isPlaying: boolean;
  progressMs: number;
  /** Null for podcasts and when nothing is loaded. */
  track: SpotifyTrack | null;
  deviceName: string | null;
}

export interface SpotifyPlayInput {
  /** A track, album, playlist, or artist URI; omitted to resume. */
  uri?: string;
  /** Play on this device instead of the active one. */
  deviceId?: string;
}

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  /** HTTP status, or 0 when the backend could not be reached. */
  status: number;
  code: string;
  message: string;
  fieldErrors?: ApiFieldError[];
  correlationId?: string;
}

// Errors cross IPC as data; a thrown error would lose its structure.
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorBody };

export interface DayTrackerBridge {
  backend: {
    getState(): Promise<BackendState>;
    /** Returns a function that removes the listener. */
    onStateChange(listener: (state: BackendState) => void): () => void;
    restart(): Promise<void>;
  };
  app: {
    openDiagnostics(): Promise<void>;
    exit(): Promise<void>;
  };
  calendar: {
    /** At most 93 days. */
    getRange(query: CalendarRangeQuery): Promise<ApiResult<CalendarRange>>;
    getDay(date: string): Promise<ApiResult<DayDetails>>;
  };
  tasks: {
    list(query?: TaskListQuery): Promise<ApiResult<TaskPage>>;
    get(id: string): Promise<ApiResult<Task>>;
    create(input: CreateTaskInput): Promise<ApiResult<Task>>;
    update(id: string, input: UpdateTaskInput): Promise<ApiResult<Task>>;
    getActivity(id: string): Promise<ApiResult<TaskActivity[]>>;
  };
  categories: {
    /** Every category, archived ones included, by name. */
    list(): Promise<ApiResult<Category[]>>;
    create(input: CreateCategoryInput): Promise<ApiResult<Category>>;
    update(id: string, input: UpdateCategoryInput): Promise<ApiResult<Category>>;
  };
  books: {
    /** Current books by default; archived ones when asked. */
    list(archived?: boolean): Promise<ApiResult<Book[]>>;
    create(input: CreateBookInput): Promise<ApiResult<Book>>;
    update(id: string, input: UpdateBookInput): Promise<ApiResult<Book>>;
    /**
     * Books matching typed text (at least 3 characters), from Open Library; with
     * techOnly, only books filed under computing subjects. Needs the internet.
     */
    suggest(query: string, techOnly?: boolean): Promise<ApiResult<BookSuggestion[]>>;
    /** Searches Open Library by the book's title and author. Needs the internet. */
    findCovers(id: string): Promise<ApiResult<CoverCandidate[]>>;
    /** Downloads the chosen cover once and stores it with the book. */
    setCover(id: string, sourceId: string, source?: CoverSource): Promise<ApiResult<Book>>;
    /** Asks for an image file and stores it as the cover; code CANCELLED when no file is chosen. */
    chooseCoverFile(id: string): Promise<ApiResult<Book>>;
    removeCover(id: string): Promise<ApiResult<null>>;
  };
  readingSessions: {
    list(query?: ReadingSessionQuery): Promise<ApiResult<ReadingSessionPage>>;
    create(input: CreateReadingSessionInput): Promise<ApiResult<ReadingSession>>;
    update(id: string, input: UpdateReadingSessionInput): Promise<ApiResult<ReadingSession>>;
    /** Removes the session from every total. Repeating it is harmless. */
    delete(id: string, version: number): Promise<ApiResult<null>>;
  };
  readingGoals: {
    /** Every recorded target, oldest effective date first. */
    list(): Promise<ApiResult<ReadingGoal[]>>;
    /** Sets the daily target from the given date onward. */
    set(effectiveDate: string, targetPages: number): Promise<ApiResult<ReadingGoal>>;
  };
  events: {
    /** Events appearing on any date in the range; at most 93 days. */
    list(query: DateRangeQuery): Promise<ApiResult<CalendarEvent[]>>;
    create(input: CreateEventInput): Promise<ApiResult<CalendarEvent>>;
    update(id: string, input: UpdateEventInput): Promise<ApiResult<CalendarEvent>>;
    delete(id: string, version: number): Promise<ApiResult<null>>;
  };
  reviews: {
    /** Fails with 404 when no review was written for the date. */
    get(date: string): Promise<ApiResult<DailyReview>>;
    save(date: string, input: SaveReviewInput): Promise<ApiResult<DailyReview>>;
  };
  progress: {
    /** At most 366 days. */
    get(query: DateRangeQuery): Promise<ApiResult<Progress>>;
  };
  settings: {
    get(): Promise<ApiResult<AppSettings>>;
    update(input: UpdateSettingsInput): Promise<ApiResult<AppSettings>>;
  };
  backups: {
    status(): Promise<ApiResult<BackupStatus>>;
    /** Makes a verified backup in the backup folder. A failure is reported, never hidden. */
    backupNow(): Promise<ApiResult<BackupInfo>>;
    /** Asks where to save a copy of one of the listed backups; code CANCELLED when no place is chosen. */
    saveCopy(name: string): Promise<ApiResult<{ fileName: string }>>;
    openFolder(): Promise<void>;
    /**
     * Asks for a backup file, checks it, asks for confirmation, saves the current data to a
     * safety backup, and replaces the data. Code CANCELLED when the user backs out. After
     * success the page should reload.
     */
    restore(): Promise<ApiResult<RestoreResult>>;
  };
  exports: {
    /** Asks where to save a CSV file; the range applies to summaries only. Code CANCELLED when no place is chosen. */
    save(dataset: ExportDataset, range?: DateRangeQuery): Promise<ApiResult<ExportResult>>;
  };
  /**
   * The user's own Day Tracker server. Choosing one (or going back to this computer)
   * checks the server, saves the choice, and restarts the app.
   */
  server: {
    describe(): Promise<ServerConnection>;
    /** Checks the address and access token without saving anything. */
    test(input: { url: string; token: string }): Promise<ApiResult<{ apiVersion: string }>>;
    /** null goes back to this computer. The app restarts when this succeeds. */
    use(input: { url: string; token: string } | null): Promise<ApiResult<null>>;
  };
  /**
   * Spotify Connect: controls playback on the user's own Spotify devices. Needs the
   * internet, a Client ID from the user's Spotify developer app, and a Premium account
   * for playback control. Errors use codes such as SPOTIFY_NOT_CONNECTED,
   * SPOTIFY_PREMIUM_REQUIRED, SPOTIFY_NO_DEVICE, and SPOTIFY_UNAVAILABLE.
   */
  spotify: {
    status(): Promise<ApiResult<SpotifyStatus>>;
    /**
     * Saves the Client ID and the redirect URI registered for the user's Spotify app:
     * http://127.0.0.1:PORT/path, http://[::1]:PORT/path (port optional), or an app
     * link such as daytracker://callback.
     */
    configure(input: { clientId: string; redirectUri: string }): Promise<ApiResult<SpotifyStatus>>;
    /** Opens Spotify's sign-in page in the browser and waits; code CANCELLED when the user backs out. */
    connect(): Promise<ApiResult<SpotifyStatus>>;
    disconnect(): Promise<ApiResult<SpotifyStatus>>;
    search(query: string): Promise<ApiResult<SpotifySearchResult>>;
    playlists(): Promise<ApiResult<SpotifyPlaylist[]>>;
    devices(): Promise<ApiResult<SpotifyDevice[]>>;
    /** Null when nothing is playing on any device. */
    playback(): Promise<ApiResult<SpotifyPlayback | null>>;
    play(input?: SpotifyPlayInput): Promise<ApiResult<null>>;
    pause(): Promise<ApiResult<null>>;
    next(): Promise<ApiResult<null>>;
    previous(): Promise<ApiResult<null>>;
    transfer(deviceId: string): Promise<ApiResult<null>>;
  };
}
