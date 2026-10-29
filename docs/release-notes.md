# Day Tracker 0.1.0 — release notes

First release. Windows x64, one person, one local profile, no account and no
internet connection needed.

## What is in it

- **Calendar** in day, week and month views, with a day panel for the selected date:
  tasks, reading, appointments, and a daily review.
  - The day and week views show the hours of the day with appointments at their
    times; click an empty hour to add one there. Tasks, reading and all-day
    appointments are listed above the hours.
  - Zoom the hours with Ctrl + plus and minus (Ctrl + 0 resets), Ctrl + mouse wheel,
    or the − and + buttons. The zoom is remembered.
  - Days that have passed, and the past hours of today, are grayed out.
  - The day panel lists the selected day's tasks, appointments, carried-over tasks and
    reading. New tasks and appointments, and the daily review (today and earlier
    days), come from **+ Create**.
  - A small month in the sidebar jumps to any date.
  - Keys: D, W, M for the views, T for today, N and P (or J and K) for the next and
    previous period, C for a new appointment.
- **Tasks**: create, edit, schedule, complete, reopen, archive; categories, filters,
  search, carry-over of unfinished work, and a history of each task.
- **Reading**: books (with optional covers), reading sessions that can be corrected,
  a position kept separate from pages read, and a daily target that applies from a
  chosen date onward.
- **Appointments**: timed and all-day, shown on every date they cover, overlaps marked.
- **Progress**: day, week and month reports computed from the saved records, with the
  records behind each total.
- **Settings**: name, timezone, first day of the week, 12/24-hour time, reading target.
- **Music**: connect your own Spotify account and control playback on your Spotify
  devices: search, play songs and playlists, pause, skip. A player at the bottom of
  the sidebar shows the song, artist, cover and position, with previous, play or
  pause, and next. You don't need to open Spotify: when nothing is playing, pressing
  play starts the Spotify app on this computer minimized and plays there (it must be
  installed and signed in once). Needs Premium for playback control and a one-time
  setup in the Spotify developer dashboard (see the README).
- **Data tools**: checked backups (manual, daily automatic, before an upgrade, before a
  restore), restore from a file, and CSV exports.

## Installing, upgrading, removing

- Run `DayTracker-Setup-0.1.0.exe`. It installs for the current user only; no
  administrator rights, Java, Node, Maven or Docker are needed.
- To upgrade, run a newer installer over the old one. On first start the database is
  upgraded after a `pre-migration-*.db` backup, and a database from a *newer* version
  is refused without being changed.
- Uninstalling removes the program and keeps your data in `%APPDATA%\Day Tracker`.
  Delete that folder to remove everything.
- **The installer is not code-signed.** Windows SmartScreen or Smart App Control may
  warn about it or block it. Signing needs a certificate and is a separate decision.

## Your data

Everything is in `%APPDATA%\Day Tracker\data`: the database (`db`), backups
(`backups`) and logs (`logs`). The database is not encrypted; it is protected by your
Windows account's file permissions.

### Backing up and restoring

- Settings → Backups → **Back up now** makes a checked copy in the backup folder.
  **Save a copy…** puts a copy wherever you choose, for example a USB drive.
- Settings → Backups → **Restore from a file…** asks for a backup, checks it, shows
  how many tasks, books, sessions, appointments and reviews it holds, and waits for
  your confirmation. Your current data is saved to a `safety-before-restore-*.db`
  backup first. If the restored data does not start, the previous data is put back.
- A backup from a newer version of Day Tracker, a damaged file, or a file that is not
  a Day Tracker backup is refused, and nothing is changed.
- CSV exports are for spreadsheets, not backups: they do not contain everything.

## Known limits

- Windows 11 x64 only. Other systems need separate packaging and testing.
- Book suggestions and covers contact Open Library and Google Books, and the Music
  screen contacts Spotify, only when you use them; everything else works offline.
- Music plays on a Spotify device (the Spotify app, a phone), not inside Day Tracker:
  in-app playback would need a DRM-enabled browser engine that this build does not have.
  Day Tracker starts the installed Spotify app in the background when needed.
- Dates and times follow the timezone in Settings. Changing it moves "today" and the
  day a finished task is counted on; reading and review dates already recorded, and
  all-day events, keep their dates.
- The interface is one soft dark theme; there is no theme choice.
- The first start of a new installation takes a few seconds while the data service
  starts; later starts are faster.
- No automatic updates, tray icon, reminders, recurring tasks, or calendar sync.

## Troubleshooting

See "If something goes wrong" in the [README](../README.md). Logs are in
`%APPDATA%\Day Tracker\data\logs`.
