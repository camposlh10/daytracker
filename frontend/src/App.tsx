import { useEffect, useState } from 'react';
import { categoriesApi } from './api/client';
import type { Category } from './api/bridge';
import { useBackendState } from './app/useBackendState';
import { useLoadable } from './app/useLoadable';
import { useSettings } from './app/useSettings';
import { useToday } from './app/useToday';
import { Logo } from './components/Logo';
import { LoadingState } from './components/States';
import type { MenuOption } from './components/MenuButton';
import { TitleBar } from './components/TitleBar';
import { useGreeting } from './app/useGreeting';
import { CalendarPage } from './features/calendar/CalendarPage';
import { BackendDownBanner } from './features/lifecycle/BackendDownBanner';
import { StartupFailure } from './features/lifecycle/StartupFailure';
import { MusicPage } from './features/music/MusicPage';
import { PlayerBar } from './features/music/PlayerBar';
import { useSpotify } from './features/music/useSpotify';
import { ProgressPage } from './features/progress/ProgressPage';
import { ReadingPage } from './features/reading/ReadingPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { TasksPage } from './features/tasks/TasksPage';
import { WeatherBadge } from './features/weather/WeatherBadge';
import styles from './App.module.css';

type View = 'calendar' | 'tasks' | 'reading' | 'progress' | 'music' | 'settings';

const NO_CATEGORIES: Category[] = [];

const VIEWS: MenuOption<View>[] = [
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
  const greeting = useGreeting();
  // The views visited, for the title bar's back and forward buttons.
  const [history, setHistory] = useState<{ views: View[]; at: number }>({ views: ['calendar'], at: 0 });
  const view = history.views[history.at];
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

  const setView = (next: View) =>
    setHistory((current) =>
      current.views[current.at] === next
        ? current
        : { views: [...current.views.slice(0, current.at + 1), next], at: current.at + 1 },
    );
  const go = (step: number) =>
    setHistory((current) => {
      const at = current.at + step;
      return at < 0 || at >= current.views.length ? current : { ...current, at };
    });

  // Alt+Left and Alt+Right go back and forward, as in a browser or Spotify.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        go(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Wait for the settings, so the first screen already uses the chosen timezone and week start.
  useEffect(() => {
    if (backend.status === 'ready' && preferences.settled) {
      setWorkspaceShown(true);
    }
  }, [backend.status, preferences.settled]);

  if (!workspaceShown) {
    return (
      <div className={styles.app}>
        <TitleBar minimal />
        {backend.status === 'failed' ? (
          <StartupFailure message={backend.message} />
        ) : (
          <main className={styles.centered}>
            <LoadingState label="Starting Day Tracker…" />
          </main>
        )}
      </div>
    );
  }

  const backendReady = backend.status === 'ready';

  const dataChanged = () => setDataVersion((version) => version + 1);

  return (
    <div className={styles.app}>
      <TitleBar
        screens={VIEWS}
        current={view}
        onNavigate={setView}
        canGoBack={history.at > 0}
        canGoForward={history.at < history.views.length - 1}
        onBack={() => go(-1)}
        onForward={() => go(1)}
        displayName={preferences.settings?.displayName}
        onProfile={() => setView('settings')}
      />
      {!backendReady && <BackendDownBanner restarting={backend.status === 'starting'} />}
      <div className={styles.shell}>
        <aside className={styles.sidebar} aria-label="Day Tracker">
          <div className={styles.brand}>
            <Logo />
            <div className={styles.brandText}>
              <p className={styles.name}>Day Tracker</p>
              <p className={styles.greeting}>
                {greeting}
                {preferences.settings?.displayName ? `, ${preferences.settings.displayName}` : ''}
              </p>
            </div>
            <WeatherBadge />
          </div>
          <div ref={setCalendarSlot} className={styles.slot} hidden={view !== 'calendar'} />
        </aside>
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
      <PlayerBar spotify={spotify} onOpen={() => setView('music')} />
    </div>
  );
}
