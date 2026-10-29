; Day Tracker's installer, in the app's colours and words.
;
; electron-builder includes this file before it builds the installer pages, so the
; Modern UI settings below apply to them. The pictures beside it (installerSidebar.bmp,
; uninstallerSidebar.bmp, installerHeader.bmp, installer.ico) are set in package.json.

; The welcome and finish pages and the header strip: the app's dark background and
; light text (--color-app-bg and --color-text in frontend/src/styles/tokens.css).
!define MUI_BGCOLOR "20242C"
!define MUI_TEXTCOLOR "EDF0F5"

!ifndef BUILD_UNINSTALLER
  ; Welcome, before choosing who it is installed for.
  !macro customWelcomePage
    !define MUI_WELCOMEPAGE_TITLE "Welcome to Day Tracker"
    !define MUI_WELCOMEPAGE_TEXT "Plan your days, keep your appointments and tasks together, track your reading, and play your music without leaving your calendar.$\r$\n$\r$\nDay Tracker keeps your data on this computer: no account, no cloud.$\r$\n$\r$\nClick Next to continue."
    !insertmacro MUI_PAGE_WELCOME
  !macroend

  ; Finish: what electron-builder shows, in our words.
  !define MUI_FINISHPAGE_TITLE "Day Tracker is ready"
  !define MUI_FINISHPAGE_TEXT "Your calendar, tasks, reading and music are one click away. Day Tracker is on the Start menu and on the desktop.$\r$\n$\r$\nIf Windows asks about it the first time, it is because the app is not code-signed yet."
  !define MUI_FINISHPAGE_RUN_TEXT "Open Day Tracker now"
!else
  ; Removing it: say what happens to the data before anything is removed.
  !macro customUnWelcomePage
    !define MUI_WELCOMEPAGE_TITLE "Remove Day Tracker"
    !define MUI_WELCOMEPAGE_TEXT "This removes the Day Tracker app from this computer.$\r$\n$\r$\nYour calendar, tasks, reading and backups are kept in your profile (%APPDATA%\Day Tracker), so installing it again picks up where you left off.$\r$\n$\r$\nClick Next to continue."
    !insertmacro MUI_UNPAGE_WELCOME
  !macroend

  !define MUI_FINISHPAGE_TITLE "Day Tracker was removed"
  !define MUI_FINISHPAGE_TEXT "Thank you for using Day Tracker. Your data is still in your profile if you come back."
!endif
