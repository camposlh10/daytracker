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
  - The day panel shows reading first, then the selected day's tasks, carried-over
    tasks and appointments. New tasks and appointments, and the daily review (today and earlier
    days), come from **+ Create**.
  - Its Reading card always shows the book you are reading: cover, title, author and
    page. When you read more than one, arrows (or the arrow keys) switch between them,
    and Log reading starts with the book on show.
  - A small month in the sidebar jumps to any date.
  - Keys: D, W, M for the views, T for today, N and P (or J and K) for the next and
    previous period, C for a new appointment.
- **Tasks**: create, edit, schedule, complete, reopen, archive; categories, filters,
  search, carry-over of unfinished work, and a history of each task.
- **Reading**: books (with optional covers), reading sessions that can be corrected,
  a position kept separate from pages read, and a daily target that applies from a
  chosen date onward.
- **Appointments**: timed and all-day, shown on every date they cover, overlaps marked.
  A new one lasts an hour (or one day) unless you switch on **Set an end**; it uses
  your timezone from Settings, and a description can be added if you want one.
  An appointment can repeat **every day** (until a last day, or without end), on
  **days of the week** you press (Mon, Wed, Fri…, also with an optional last day), or
  on **dates you choose** by pressing them on a small calendar; editing or deleting one
  changes all its dates. Links can be added and open in your browser.
- **Holidays**: the public holidays of the country set as your home location in
  Windows appear on their dates (a gold ★) and in the day panel, from Nager.Date.
  Only the country and the year are sent; each year's list is kept for 30 days, so it
  also shows offline. Holidays of only some states are not shown.
- **Progress**: day, week and month reports computed from the saved records, with the
  records behind each total.
- **Settings**: name, timezone, first day of the week, 12/24-hour time, reading target.
- **Music**: connect your own Spotify account and control playback on your Spotify
  devices: search, play songs and playlists, pause, skip. **Your library** lists Liked
  Songs and your playlists; open one to see its songs, play any of them (the list
  carries on after it) or add it to the queue. Spotify only lists the songs of
  playlists you made or collaborate on; the ones you follow still play whole.
  Liked Songs need one reconnect (Disconnect, then Connect) for the new permission. A player bar across the
  bottom of the window, like Spotify's, shows the song or podcast episode, artist or
  show, cover, device and position, with shuffle, previous, play or pause, next,
  repeat, a bar to jump within the song, and volume (15-second skips for episodes). You don't need to open Spotify: when nothing is playing, pressing
  play starts the Spotify app on this computer minimized and plays there (it must be
  installed and signed in once). Needs Premium for playback control and a one-time
  setup in the Spotify developer dashboard (see the README).
- **Window**: opens about as large as Spotify's desktop app the first time, then where
  and how large you last left it. Its own dark title bar, like Spotify's, has a ⋯ menu with every
  screen, back and forward (also Alt+Left and Alt+Right), and a profile button for
  Settings. The sidebar shows the app's icon and a greeting for the time of day
  (good morning, good afternoon or good night) with your name, and the weather where
  you are now. The weather uses Windows' location (Settings, Privacy & security,
  Location) and Open-Meteo; only coordinates rounded to about a kilometre are sent,
  at most every 15 minutes; click the temperature to switch °C and °F. Scroll bars are hidden; everything still scrolls.
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
  screen contacts Spotify, only when you use them. The sidebar's weather contacts
  Open-Meteo with your approximate location; everything else works offline.
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
