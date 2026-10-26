# Architecture

## Processes

```
React renderer  --(contextBridge: window.dayTracker)-->  Electron preload
Electron preload  --(named IPC channels)-->  Electron main
Electron main  --(HTTP on 127.0.0.1, bearer token)-->  Spring Boot  -->  SQLite
```

- **Renderer** (`frontend/`): sandboxed, no Node.js. Renders the interface and holds
  temporary form state. All data access goes through `src/api/client.ts`.
- **Preload** (`desktop/src/preload.ts`): exposes individual typed methods. It never
  exposes `ipcRenderer`, the backend port, or the launch token.
- **Main** (`desktop/src/main.ts`, `backend.ts`, `ipc.ts`): owns the window, the Java
  child process, and the IPC handlers. Every handler checks the sender, validates the
  payload, and calls one fixed backend route.
- **Backend** (`backend/`): Spring Boot, organised by feature (`tasks`, `health`) with
  shared `config`, `security`, `database`, and `common` packages. Business rules and
  persistence live here.

## Book covers

Covers and book suggestions are the only features that use the internet, and
only on request. When Open Library has no cover for a work, its ISBN is looked
up on Google Books (`books.google.com/books/content`, small size only; larger
sizes and unknown ISBNs return placeholders, and PNG placeholders are refused).
Google can return another book's cover for an unknown ISBN, so these covers are
labelled and always shown for confirmation. The
backend's `OpenLibraryClient` builds fixed Open Library URLs from a numeric
cover id, follows redirects by hand to Open Library and Internet Archive hosts
only, accepts nothing but JPEG, PNG, or WebP of at most 2 MB (decided from the
bytes), and has short timeouts. The chosen cover is stored in the
`book_covers` table (migration V002), so it works offline and is part of every
database backup.

The page still has no network access (`connect-src 'none'`). Images reach it
through the private `dt-cover:` scheme registered by the Electron main process
(`desktop/src/covers.ts`), which fetches the bytes from the backend with the
launch token: `dt-cover://book/<id>?v=<coverUpdatedAt>` for a stored cover and
`dt-cover://candidate/<cover id>` for a search preview. The content security
policy allows images from `'self'`, `data:`, and `dt-cover:` only. Image files
the user picks are read by the main process through a native file dialog, so
the page can never name a path.

## Settings and time

Settings live in the `settings` table (display name, timezone, week start, clock
style). The timezone is written explicitly the first time the application runs and is
never re-derived from the computer later. Backend services get the current zone from
`ZonePolicy` (implemented by `SettingsService`), not from a fixed bean, so a change
applies at once: it moves today, the date a completion time falls on, and the date of
an automatic backup. Reading-session dates, review dates, and all-day events are plain
dates and do not move. In the page, `lib/dates.ts` holds the same preferences as module
state, set by `useSettings` while rendering, so every formatted time uses them.

## Backups and restore

`BackupService` writes backups with `VACUUM INTO` to a temporary name, checks the result
(journal mode, `integrity_check`, `foreign_key_check`, migration history), writes a
`.json` description, and renames both into place. Failures delete the temporary file and
are remembered as the last attempt. Automatic backups run from a scheduled check (first
after 30 seconds, then hourly) and are named `auto-<date>.db`, so a day has at most one.

Restore is driven by the Electron main process (`desktop/src/restore.ts`) because it must
stop and start the backend and replace a file the backend holds open:

1. native open dialog, copy of the file to `data\restore-staging\staged-<n>.db`
2. backend `POST /lifecycle/restore/validate` checks the copy and counts its records
3. native confirmation showing those counts
4. backend `POST /lifecycle/restore/safety-backup` saves the current data
5. a journal is written, the backend stops, `daytracker.db` (and `-wal`, `-shm`) are renamed
   to `.previous`, the staged file is renamed in, the backend starts
6. on success the previous files and the journal are removed; on any failure the new files
   are removed, the previous ones renamed back, and the backend started on them

If the application dies between steps 5 and 6, the next launch finds the journal and puts
the previous files back before the backend starts. The page never names a path: it can only
ask for a restore, a backup copy, or an export, and the user chooses the place in a native
dialog. Saving is refused inside the application's own data folder.

## Startup

1. Electron takes the single-instance lock; a second launch focuses the first window.
2. Main generates a random token and starts `java -jar backend.jar` with the token and
   data directory in the child environment (never on the command line).
3. Spring Boot binds `127.0.0.1` on an OS-assigned port, opens the database, and runs
   pending migrations as part of context startup.
4. When ready it prints `DAYTRACKER_READY {"port":N}` on stdout. Main then makes an
   authenticated `GET /api/v1/health` request and reports `ready` to the renderer.
5. Until then the renderer shows a loading state. If startup fails or exceeds 60
   seconds, it shows Retry, Open diagnostics, and Exit rather than empty data.

## Shutdown and recovery

- **Normal exit:** main writes `shutdown` to the child's stdin and waits up to 8
  seconds (the backend stops accepting requests, then closes the database) before
  terminating it.
- **Electron dies:** the child's stdin reaches end-of-stream, and the backend shuts
  itself down, so no Java process is orphaned.
- **Backend dies:** main reports `failed / crashed`. The workspace stays mounted so
  typed input is kept, saving is disabled, and the user can restart explicitly.
  Requests are never retried automatically.

## Release hardening

- **No debugging port.** The released app exits at once if started with
  `--remote-debugging-port` or `--inspect` (a port would let any program on the
  computer drive the window and call the data bridge). The automated release checks set
  `DAYTRACKER_ALLOW_DEBUG_PORT=1` to opt in; users diagnose from the log folder.
- **Faster starts.** The packaged backend runs with `-XX:+AutoCreateSharedArchive`, writing
  a class-data archive to `data\cache\backend.jsa` as it exits. The next start skips
  re-reading and verifying the same classes, which saves about two seconds. A missing or
  stale archive is ignored and rebuilt by the JVM, so it is never a failure.
- **No fixed port.** The backend asks the operating system for a free port on every start
  and reports it on stdout, so an occupied port cannot stop it.
- **Orphan protection.** The backend watches its standard input; when the app dies for
  any reason the pipe closes and the backend exits on its own (`lifecycle-test.mjs` and
  `smoke-test.mjs` kill the parent outright and check this).
- **Interface checks.** `axe-core` runs on every screen and dialog in the frontend tests;
  colour tokens are measured against WCAG 2.2 in `contrast.test.ts`; the focus ring falls
  back to an outline in Windows high-contrast themes; `layout-check.mjs` checks the
  packaged window at the minimum size and several display scales.

## Database

- One SQLite file. Every connection has `foreign_keys=ON`, WAL journaling, and a 5
  second busy timeout. Transactions start with `BEGIN IMMEDIATE`, which serialises
  writers.
- Ids are UUID text, system times are fixed-width UTC ISO-8601 text, calendar dates
  are `YYYY-MM-DD` text.
- Schema: `backend/src/main/resources/db/migration/V001__initial_schema.sql`.

### Migrations

Scripts are named `V001__description.sql`, `V002__...` and applied in version order.
The runner records each script's SHA-256 checksum in `schema_migrations` and commits a
script together with its ledger row in one transaction. Startup aborts when:

- an applied script's checksum no longer matches (scripts are immutable once released),
- a script fails (it is rolled back completely),
- the database was written by a newer version of the application.

Before upgrading a database that already has migrations applied, the runner writes a
consistent copy to `data\backups\pre-migration-v<N>-<timestamp>.db` using
`VACUUM INTO`.

The runner splits scripts on semicolons, so a script must not contain semicolons
inside string literals or trigger bodies; such a change needs its own documented
procedure.

## API

Described in `contracts/openapi.yaml`. Errors always have the shape
`{ code, message, fieldErrors?, correlationId }`. Creates carry a client-generated
UUID: replaying the same request returns the existing record, and the same id with
a different payload returns 409.
