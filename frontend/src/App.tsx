import { useEffect, useState } from 'react';
import { categoriesApi } from './api/client';
import type { Category } from './api/bridge';
import { useBackendState } from './app/useBackendState';
import { useLoadable } from './app/useLoadable';
import { useSettings } from './app/useSettings';
import { useToday } from './app/useToday';
import { LoadingState } from './components/States';
import { CalendarPage } from './features/calendar/CalendarPage';
import { BackendDownBanner } from './features/lifecycle/BackendDownBanner';
import { StartupFailure } from './features/lifecycle/StartupFailure';
import { MiniPlayer, MusicPage } from './features/music/MusicPage';
import { useSpotify } from './features/music/useSpotify';
import { ProgressPage } from './features/progress/ProgressPage';
import { ReadingPage } from './features/reading/ReadingPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { TasksPage } from './features/tasks/TasksPage';
import styles from './App.module.css';

type View = 'calendar' | 'tasks' | 'reading' | 'progress' | 'music' | 'settings';

const NO_CATEGORIES: Category[] = [];

const VIEWS: { id: View; label: string }[] = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'reading', label: 'Reading' },
  { id: 'progress', label: 'Progress' },
  { id: 'music', label: 'Music' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const backend = useBackendState();
  const preferences = useSettings(backend.status === 'ready');
  // Spotify does not depend on the data service, so it is not tied to its state.
  const spotify = useSpotify();
  const today = useToday(preferences.settings?.timezone);
  const [view, setView] = useState<View>('calendar');
  const [dataVersion, setDataVersion] = useState(0);
  // The sidebar spot where the calendar puts its small month.
  const [calendarSlot, setCalendarSlot] = useState<HTMLDivElement | null>(null);
  const categoryList = useLoadable('categories', dataVersion, backend.status === 'ready', () =>
    categoriesApi.list(),
  );
  const categories = categoryList.status === 'loaded' ? categoryList.data : NO_CATEGORIES;
  // Once the workspace has been shown it stays mounted through a backend
  // crash or restart, so in-progress input survives.
  const [workspaceShown, setWorkspaceShown] = useState(false);

  // Wait for the settings, so the first screen already uses the chosen timezone and week start.
  useEffect(() => {
    if (backend.status === 'ready' && preferences.settled) {
      setWorkspaceShown(true);
    }
  }, [backend.status, preferences.settled]);

  if (!workspaceShown) {
    if (backend.status === 'failed') {
      return <StartupFailure message={backend.message} />;
    }
    return (
      <main className={styles.centered}>
        <LoadingState label="Starting Day Tracker…" />
      </main>
    );
  }

  const backendReady = backend.status === 'ready';

  const dataChanged = () => setDataVersion((version) => version + 1);

  return (
    <div className={styles.app}>
      {!backendReady && <BackendDownBanner restarting={backend.status === 'starting'} />}
      <div className={styles.shell}>
        <nav className={styles.sidebar} aria-label="Main">
          <p className={styles.brand}>Day Tracker</p>
          {preferences.settings?.displayName && <p className={styles.user}>{preferences.settings.displayName}</p>}
          <ul className={styles.nav}>
            {VIEWS.map(({ id, label }) => (
              <li key={id}>
                <button
                  type="button"
                  className={styles.navItem}
                  aria-current={view === id ? 'page' : undefined}
                  onClick={() => setView(id)}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
          <div ref={setCalendarSlot} className={styles.slot} hidden={view !== 'calendar'} />
          <MiniPlayer spotify={spotify} onOpen={() => setView('music')} />
        </nav>
        <main className={styles.main}>
          {/* The calendar stays mounted while another view is open, so its
              selected date and any unsaved input are kept. */}
          <div className={styles.view} hidden={view !== 'calendar'}>
            <CalendarPage
              today={today}
              backendReady={backendReady}
              categories={categories}
              dataVersion={dataVersion}
              weekStart={preferences.weekStart}
              active={view === 'calendar'}
              sidebarSlot={calendarSlot}
            />
          </div>
          {view === 'reading' && (
            <ReadingPage
              today={today}
              backendReady={backendReady}
              onDataChanged={dataChanged}
            />
          )}
          {view === 'progress' && (
            <ProgressPage
              today={today}
              weekStart={preferences.weekStart}
              backendReady={backendReady}
              dataVersion={dataVersion}
            />
          )}
          {view === 'music' && <MusicPage spotify={spotify} />}
          {view === 'settings' && (
            <SettingsPage
              settings={preferences.settings}
              today={today}
              backendReady={backendReady}
              onSave={preferences.save}
              onDataChanged={dataChanged}
            />
          )}
          {view === 'tasks' && (
            <TasksPage
              categories={categories}
              backendReady={backendReady}
              onDataChanged={dataChanged}
            />
          )}
        </main>
      </div>
    </div>
  );
}
