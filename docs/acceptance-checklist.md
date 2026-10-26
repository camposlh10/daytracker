# Release 0.1.0 — acceptance checklist and recorded results

Recorded on 25 October 2026 on the development machine:

| | |
| --- | --- |
| Machine | 12th Gen Intel Core i7-12650H (10 cores, 16 threads), 31.6 GB RAM, NVMe SSD |
| System | Windows 11 Home 10.0.26200, display scale 100% |
| Build | `package.ps1 -LocalRun` (unpacked) and `-LocalInstaller` (unsigned NSIS installer), Java 21.0.12 runtime bundled |

"Passed" means a script or test ran and passed; the command is given so it can be run
again. "Not verified" means exactly that. Nothing here was checked by eye alone except
where it says so.

## Automated checks

| Check | Result | How |
| --- | --- | --- |
| Backend unit, repository (real SQLite), API and backup tests | 139 passed | `mvnw verify` |
| Frontend tests, including accessibility rules, keyboard-only use and colour contrast | 177 passed | `npm test` |
| Restore against the real backend (known fixture restored exactly; unstartable file rolled back; crash mid-restore undone) | Passed | `node scripts\restore-test.mjs` |
| Start-up failure, timeout, newer database refused untouched, crash and restart, orphan protection, two backends | Passed | `node scripts\lifecycle-test.mjs` |

## Packaged Windows tests (specification section 15)

| Requirement | Result | Evidence |
| --- | --- | --- |
| Install and start with no separately installed Java, Node, Maven or Docker | Passed | `install-test.mjs` installs the real installer, starts it with `PATH` limited to the Windows folder, and saves a task. The runtime is inside the install folder. |
| Work with networking disabled; close, reopen, verify records | **Partly verified** | `smoke-test.mjs` finds no connection from the app or its helpers to any other computer, and records survive restart. The network adapter itself was not switched off (needs administrator rights). The only network use is Open Library / Google Books on request. |
| Start-up timeout | Passed | `lifecycle-test.mjs` (a 300 ms limit is reported as a timeout and the process is stopped) |
| Occupied-port resilience | Passed by design | The backend never asks for a fixed port: the operating system assigns a free one on every start (`server.port=0`). `lifecycle-test.mjs` runs two at once on different ports. |
| Backend crash handling | Passed | `smoke-test.mjs` kills the Java process under the real app: the window is told, changes are refused, an explicit restart works, data is intact, nothing was written while it was down. The frontend test keeps typed text on screen during a crash. |
| No orphan Java process after normal exit | Passed | `smoke-test.mjs` (after every exit) |
| No orphan Java process when the app is killed outright | Passed | `smoke-test.mjs` third launch; `lifecycle-test.mjs` |
| Upgrade an existing populated installation without losing data | Passed, with a limit | `install-test.mjs` installs over a populated installation and the data is intact. Only one build exists, so it is the same version over itself. A populated version-1 database upgraded to the current schema keeps every row (`MigrationRunnerTest`), and a failed upgrade leaves the data and a backup intact. |
| Uninstall keeps user data | Passed | `install-test.mjs` |
| Keyboard-only main workflows | Passed (automated) | `keyboard.test.tsx`: arrow keys through the calendar, adding a task, reaching every screen, dialogs trap Tab and return focus, saving settings. Not done by hand on the real window. |
| Scrolling and display scaling at 100%, 125%, 150% | Passed at emulated scales | `layout-check.mjs` at 1100 x 720: every screen and dialog, no sideways overflow, nothing cut off or covered. The scale is emulated in the window; the machine itself is at 100%, so real Windows 125% and 150% were **not verified**. |

## Performance targets (specification section 15)

Fixture: 10,000 tasks, 10,000 reading sessions, 5,000 appointments in a real SQLite
file. Median and worst of 25 runs over HTTP on localhost, after 5 warm-up runs
(`mvnw test -Dtest=PerformanceTest -Dtest.excluded.groups=`). The window adds a hop
through the main process, which is small next to these figures.

| Operation | Target | Median | Worst |
| --- | --- | --- | --- |
| Calendar range, month grid (42 days) | 300 ms | 38 ms | 50 ms |
| Calendar range, 93 days (the maximum) | 300 ms | 68 ms | 74 ms |
| Selected day | — | 5 ms | 9 ms |
| Progress, one month / one year | — | 14 ms / 53 ms | 17 ms / 72 ms |
| Task list, first page / text search | — | 3 ms / 4 ms | 4 ms / 6 ms |
| Save: task / reading session / appointment | 500 ms | 3 / 2 / 2 ms | 3 / 3 / 2 ms |
| Export 10,000+ tasks as CSV | — | 55 ms | 63 ms |
| Backup now (`VACUUM INTO`) | — | 104 ms | 131 ms |

Cold start (window opens, data service ready), packaged build, fresh data folder, idle
machine: **5.4 to 5.6 s** over four runs; target 10 s. The first run measured 11 to 13 s
when Docker Desktop was starting at the same time, so the figure depends on machine
load. The Java runtime's class-data archive (`data\cache`) makes later starts
faster (about 4 to 5 s). The window never waits on Java or the disk: every call is
asynchronous.

## Definition of done (specification section 16)

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Soft dark calendar-centred interface in React | Done. Text and control colours were measured against WCAG 2.2 (`contrast.test.ts`); input borders and the hover blue were adjusted to pass. |
| 2 | All first-release functional requirements with real persisted data | Done for the items in the specification's first-release column. |
| 3 | Java 21 and Spring Boot own backend rules and database operations | Done. |
| 4 | Installed app runs offline without development tools | Done (see networking note above). |
| 5 | Date/time, reading, completion and historical reporting rules | Done; covered by fixed-clock rule tests, including timezone changes. |
| 6 | Backup, restore, migration failure and crash recovery exercised | Done (restore, lifecycle and migration tests above). |
| 7 | Automated checks pass and this checklist is complete | Automated checks pass. The items marked "not verified" below are open. |
| 8 | No sample records, credentials, debug tokens or placeholder actions in production | Passed: `node scripts\release-audit.mjs` (no databases, logs or keys in the package; no test classes or placeholder text; token only from the environment; loopback only; debugging port refused). |
| 9 | Documentation sufficient for another developer | README, architecture notes, API contract, release notes. The container build instructions are unconfirmed (below). |

## Not verified — still open

- **Docker build** (`docker build -f docker/backend.Dockerfile ...`): Docker Desktop is
  installed, but its engine did not start in ten minutes here, so the image was never
  built. The Dockerfile is pinned and has not been run.
- **Code signing.** The installer and executable are unsigned. Windows may warn or
  block them on another computer. Signing needs a certificate.
- **Real Windows display scaling** at 125% and 150% (the machine runs at 100%).
- **Windows high-contrast themes.** A fallback focus outline was added; it has not been
  seen in a high-contrast theme.
- **Screen readers** (Narrator, NVDA). The automated rules (axe) find no violations and
  controls are labelled, but no screen reader was used.
- **Network adapter disabled** (see above).
- **Upgrade from an older build**, because no older build exists yet.
