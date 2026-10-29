# Day Tracker

Personal Windows desktop application for planning a day, recording completed work,
tracking reading, and reviewing progress. It runs offline and stores its data locally.

**Status: Sprint 7 (Release hardening).** This is release 0.1.0; see
[docs/release-notes.md](docs/release-notes.md) and the recorded results in
[docs/acceptance-checklist.md](docs/acceptance-checklist.md). In place: the app window with its bundled
Spring Boot backend and SQLite database, the calendar workspace (day, week and month
views laid out like a wall planner, with the hours of the day in the day and week
views, a small month for jumping to a date, and the selected-day panel), the full task workflow (create, edit, complete,
reopen, archive, categories, filters, carry-over, history, completion totals),
reading (books, sessions with corrections, a position derived separately from
pages read, an effective-dated daily target), timed and all-day appointments
shown on every date they cover with overlaps marked, a daily review with
explicit saving and protection against leaving unsaved edits, optional book
covers (found on Open Library or chosen from an image file) showing reading
progress, progress reports for a day, week, or month with the records behind
them, settings (display name, timezone, week start, 12/24-hour time, reading
target), checked backups with restore, and CSV exports.

## Layout

| Directory    | Contents                                                                 |
| ------------ | ------------------------------------------------------------------------ |
| `frontend/`  | React + TypeScript interface (Vite, CSS Modules, Vitest)                  |
| `desktop/`   | Electron main and preload, Java process management, IPC, installer config |
| `backend/`   | Spring Boot (Java 21) API, SQL migrations, backend tests                  |
| `contracts/` | OpenAPI description of the local API                                      |
| `docker/`    | Pinned Java 21 / Maven build-and-test image for the backend               |
| `scripts/`   | Development launcher, runtime download, packaging, smoke test             |
| `docs/`      | Architecture notes                                                        |

## Prerequisites (development only)

- Node.js 24 LTS (see `.nvmrc`) with npm
- A JDK, version 21 or newer. The backend is always compiled for Java 21; Maven
  itself comes from the Maven Wrapper.
- Docker Desktop, only for the optional containerised backend build

The installed application needs none of these.

## First-time setup

```powershell
cd frontend; npm ci; cd ..
cd desktop;  npm ci; cd ..
```

## Run in development

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
```

This builds the backend JAR, starts the Vite dev server on `127.0.0.1:5173`, and
opens Electron, which launches and supervises the Spring Boot process. Development
data is kept in `%APPDATA%\Day Tracker Dev`, apart from the installed app's data.
Set `DAYTRACKER_JAVA` to use a specific `java.exe` instead of the one on `PATH`.

## Tests

```powershell
cd backend;  .\mvnw.cmd verify      # unit, repository (real SQLite), and API tests
cd frontend; npm test               # React tests, including accessibility and keyboard checks
cd frontend; npm run typecheck
cd desktop;  npm run typecheck
```

These need the backend jar and the compiled desktop sources (`mvnw package`, then
`npm run build` in `desktop`); `scripts\package.ps1` runs them all in order.

| Script                          | What it checks                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `scripts\restore-test.mjs`      | Restore against the real backend: a known fixture comes back exactly, a file that cannot start is rolled back, a crash mid-restore is undone |
| `scripts\lifecycle-test.mjs`    | Start-up failure, start-up timeout, a newer database refused untouched, backend crash and restart, backend exits when its parent dies, two backends at once |
| `scripts\smoke-test.mjs <exe>`  | A packaged build end to end: data, settings, backups, a refused debugging port, no outside connections, a backend crash and restart, the app killed outright |
| `scripts\layout-check.mjs <exe>`| Every screen and dialog at 1100 x 720 and at 100%, 125% and 150% display scale: no overflow, nothing cut off or covered |
| `scripts\release-audit.mjs`     | What is in the package: no databases, logs, keys, test classes or placeholder text; security settings; licence notices |
| `scripts\install-test.mjs <setup.exe>` | Install, start, upgrade in place, and uninstall; user data survives both |

All of them use throwaway data directories and never touch the real profile. The
packaged-build scripts need `DAYTRACKER_ALLOW_DEBUG_PORT=1`, which they set themselves:
the released app otherwise refuses to start with a debugging port.

### Performance

```powershell
cd backend; .\mvnw.cmd test "-Dtest=PerformanceTest" "-Dtest.excluded.groups="
```

Builds a database with 10,000 tasks, 10,000 reading sessions and 5,000 appointments,
measures the main operations over HTTP, and writes `backend\target\performance-report.txt`.
It is left out of the normal build because the timings depend on the machine.

Backend build and tests in the pinned container (never mount real app data into it):

```powershell
docker build -f docker/backend.Dockerfile -t day-tracker-backend-build .
```

## Package

```powershell
powershell -ExecutionPolicy Bypass -File scripts\fetch-jre.ps1   # once: bundled Java 21 runtime
powershell -ExecutionPolicy Bypass -File scripts\package.ps1     # NSIS installer in desktop\release
```

`fetch-jre.ps1` downloads the pinned Eclipse Temurin 21 JRE, verifies its checksum,
and places it in `desktop\resources\jre` (not committed). The installer contains
Electron, the built frontend, the backend JAR, and that runtime with its license
notices.

### Unsigned builds and Smart App Control

The build is not code-signed. Windows Smart App Control, where it is enforcing, blocks
the step that edits the Electron executable (icon and version), so the default
installer build fails there. Two switches leave the executable unmodified:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package.ps1 -LocalRun        # desktop\release\win-unpacked\Day Tracker.exe
powershell -ExecutionPolicy Bypass -File scripts\package.ps1 -LocalInstaller  # desktop\release-installer\DayTracker-Setup-0.1.0.exe
```

The unsigned installer installed, upgraded and uninstalled cleanly on the development
machine, but Windows may warn about it elsewhere. A distributable installer needs a
code-signing certificate, which is a separate decision.

## Book covers and the network

Day Tracker works offline. The exceptions are optional and use Open Library
(openlibrary.org, run by the Internet Archive):

- While you type a title in "Add book", after three letters and a short pause,
  the text is sent to Open Library and matching books are suggested. Picking
  one fills in the title, author, a typical page count, and the cover; every
  field stays editable. Tick "Tech books only" to limit suggestions to
  programming and computing books; the publisher (O'Reilly, Manning, Packt, and
  other technical publishers) is then shown too, and the choice is remembered.
  Offline, the form simply works without suggestions.
- On a book's Cover dialog, "Search Open Library" sends its title and author
  and lists matching covers.
- When Open Library knows a book but has no cover for it, the cover is looked up
  on Google Books by the book's ISBN and labelled "Google Books". Google answers
  an unknown ISBN with some other book's cover, so such a cover is always shown
  for you to confirm first, and it is only fetched once you open the cover
  search or pick that book (not while you type). The
cover you pick is downloaded once and stored in the database, so it keeps
showing offline and is included in backups. You can also choose an image file
(JPEG, PNG, or WebP, up to 2 MB) instead.

The backend makes these requests only to Open Library, Internet Archive, and
Google Books addresses over HTTPS, checks that what it receives really is an image, and
passes images to the window through a private `dt-cover:` scheme, so the
window itself still has no network access.

## Download page

`website/` is a one-page download site in the app's colours: `index.html` with its
styles inline, and the icon, a screenshot and a weather picture in `website/assets`.
It is static, so any host works (GitHub Pages: publish the `website` folder). The
download buttons point to the installer of the latest GitHub release,
`https://github.com/camposlh10/daytracker/releases/latest/download/DayTracker-Setup-0.1.0.exe`;
attach the installer from `scripts\package.ps1` to a release with that name, and update
the version in the page (it appears in the two download links and the version notes)
when it changes.

## Weather

The sidebar shows the weather where this computer is. Windows supplies the location
(Settings, Privacy & security, Location; it must be on for desktop apps), and the
main process asks Open-Meteo (open-meteo.com, no account) for the current conditions,
at most every 15 minutes. Only the coordinates, rounded to two decimals (about a
kilometre), are sent. The temperature starts in °F when Windows' regional format uses
US measurements and in °C otherwise; click it to switch, and the choice is kept.
With location off, the sidebar says so; offline, it shows nothing.
The pictures are the 32 × 32 pixel-art set in `frontend/src/assets/weather`: animated
GIFs, and their still first frames when Windows is set to show fewer animations. The
set has no night or fog pictures, so clear nights show the sun and fog shows a cloud.

## Holidays

The calendar shows the public holidays of the country set as home location in Windows
(Settings, Time & language, Language & region, Country or region). The main process
asks Nager.Date (date.nager.at, no account) for a year's list, sending only the year
and the two-letter country, and keeps it in `%APPDATA%\Day Tracker\holidays` for 30
days. Holidays that apply only in some states or regions are left out.

## Music (Spotify)

The Music screen connects your Spotify account and controls playback on one of your
own Spotify devices (Spotify Connect): the Spotify desktop app, your phone, a speaker.
The sound comes from that device, not from Day Tracker. It needs the internet and is
only used when you open it; until you connect, nothing is sent to Spotify.

You don't have to open Spotify yourself. When you press play and nothing is playing
anywhere, Day Tracker plays on this computer's Spotify if it is open; otherwise it
starts the Spotify app minimized (the installer's copy in `%APPDATA%\Spotify`, or the
Microsoft Store app) and plays as soon as it appears, within 30 seconds. If Spotify is
not installed here, it plays on another open device, such as your phone. The Spotify
app needs to be installed and signed in with the same account once.

Spotify only allows this for apps registered by the user, so setup is once:

1. At `developer.spotify.com/dashboard`, create an app.
2. Add a redirect URI and tick Web API. Spotify's documentation allows loopback `http`
   addresses, but in 2026 its dashboard started refusing some new ones as "not secure".
   Day Tracker can receive any of these; use the first one the dashboard saves:
   - `https://<your-server>/spotify/callback`, if you deploy the backend somewhere with
     HTTPS (for example Railway). That public page only sends the browser back to
     `http://127.0.0.1:<port>/callback` on the same computer, with the port carried in
     the sign-in state; it stores and logs nothing, and the code it passes on is useless
     without the PKCE verifier that never leaves the desktop app. Every other route on
     that server still requires the launch token.
   - `http://127.0.0.1:43821/callback`
   - `http://[::1]:43821/callback`
   - `daytracker://spotify-callback` (an app link: Windows hands it to Day Tracker, and
     the browser asks before opening the app)

   A loopback address without a port also works (a free port is chosen at sign-in).
3. Under User Management, add the email of the Spotify account you will use.
4. On the Music screen, enter the Client ID and the redirect URI exactly as saved, then
   Connect Spotify.

Spotify's current rules (February 2026): the app owner needs Premium, an app in
development mode allows five accounts, and playback control works with Premium
accounts only. Free accounts can still sign in and search, but play/pause is refused
with a clear message.

How it works: sign-in uses the authorization code flow with PKCE (no client secret).
Your browser opens Spotify's own page, and Spotify returns to a one-time listener on
127.0.0.1. Only the refresh token is kept, in `%APPDATA%\Day Tracker\spotify.json`,
encrypted with Windows' per-user protection (DPAPI) and outside the data folder, so it
is never in a backup. The window never sees a token. Album art is fetched from
`i.scdn.co` by the main process through a private `dt-spotify:` scheme, so the page
still has no network access. Disconnect on the Music screen forgets the token.

## Where data lives

Under Electron's `userData` directory (`%APPDATA%\Day Tracker`):

- `data\db\daytracker.db` — the SQLite database
- `data\backups\` — backups: manual, automatic (one per day, newest seven kept), and the
  ones made before an upgrade or a restore
- `data\logs\backend.log` — rolling backend log (Open diagnostics opens this folder)
- `data\cache\` — the Java runtime's class-data archive, which only makes start-up
  faster and can be deleted at any time
- `data\restore-staging\` — a copy of a backup being checked for a restore; empty otherwise

Nothing mutable is stored next to the installed executable.

## Progress, settings, backups, and exports

- **Progress** (sidebar) shows a day, week, or month with tasks completed, pages
  read, reading days, and target achievement, plus the books and completed tasks
  behind the totals. A period in progress is judged on the days that have begun,
  one that has not begun shows only what is planned, and an empty one says "No
  activity recorded". Bars stop at 100% but the real count and percentage are
  written beside them. There is no combined score.
- **Settings** hold the display name, timezone, first day of the week, 12- or
  24-hour time, and the daily reading target. The timezone is taken from the
  computer once, on the first run, and then stored. Changing it changes what
  today is and which day a finished task is counted on; reading and review
  dates already recorded, and all-day events, keep their dates.
- **Backups** are made with `VACUUM INTO`, checked (integrity and foreign keys),
  and described by a small `.json` file beside them. A failed backup leaves no
  partial file and is shown as failed. One automatic backup is made per day while
  the app runs and the newest seven are kept; manual, pre-upgrade, and
  pre-restore backups are never deleted automatically. "Save a copy" copies one
  to a place you choose.
- **Restore** asks for a backup file, checks a copy of it (integrity, that it is a
  Day Tracker database, that its history matches, and that it is not from a newer
  version), shows what it contains, and waits for your confirmation. It then saves
  your current data to a safety backup, stops the data service, moves the current
  database aside, puts the restored one in place, and starts again. If the restored
  data does not start, the previous database is put back. A restore cut short by a
  crash is undone the next time the app starts.
- **Exports** save tasks, reading sessions, appointments, or daily summaries as CSV
  files (UTF-8, opens in Excel). Text that a spreadsheet would run as a formula is
  prefixed with an apostrophe.

## If something goes wrong

- **The window says the data service did not start or stopped.** Use Retry or Restart.
  Nothing is written while it is down, and text you typed stays on screen. "Open
  diagnostics" opens `data\logs`, where `backend.log` explains the failure.
- **"This backup was made by a newer version."** The file came from a later release;
  install that release to read it. Your current data was not touched.
- **A restore did not finish.** The previous database is put back automatically, and
  once more at the next start if the app was closed in the middle. The data from
  before the restore is also in a `safety-before-restore-*.db` file in the backup
  folder.
- **Uninstalling** removes the program but keeps your data in `%APPDATA%\Day Tracker`.
  Delete that folder yourself to remove everything.
- **Upgrading** is running a newer installer over the old one. Databases are upgraded
  on first start, after a `pre-migration-*.db` backup, and a failed upgrade leaves the
  old data as it was.
