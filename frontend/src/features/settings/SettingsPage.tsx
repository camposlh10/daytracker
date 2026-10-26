import { useState, type FormEvent } from 'react';
import {
  backupsApi,
  calendarApi,
  errorMessage,
  exportsApi,
  isCancelled,
  readingGoalsApi,
} from '../../api/client';
import type { AppSettings, BackupInfo, BackupKind, ExportDataset, UpdateSettingsInput } from '../../api/bridge';
import { useLoadable } from '../../app/useLoadable';
import { Button } from '../../components/Button';
import { LoadingState } from '../../components/States';
import { addDays, formatShortDate, formatTimestamp, timeZones, type IsoDate } from '../../lib/dates';
import { GoalDialog } from '../reading/GoalDialog';
import { pages } from '../reading/readingLabels';
import form from '../../components/form.module.css';
import styles from './settings.module.css';

const KIND_LABELS: Record<BackupKind, string> = {
  MANUAL: 'Manual',
  AUTOMATIC: 'Automatic',
  PRE_MIGRATION: 'Before an upgrade',
  SAFETY: 'Before a restore',
};

const EXPORTS: { dataset: ExportDataset; label: string }[] = [
  { dataset: 'tasks', label: 'Tasks' },
  { dataset: 'reading-sessions', label: 'Reading sessions' },
  { dataset: 'appointments', label: 'Appointments' },
];

const SUMMARY_DAYS = 90;

interface SettingsPageProps {
  settings: AppSettings | null;
  today: IsoDate;
  backendReady: boolean;
  onSave: (input: UpdateSettingsInput) => Promise<AppSettings>;
  /** Called after the reading target or the settings changed, so other screens reload. */
  onDataChanged: () => void;
  /** Runs after a restore succeeded; the default reloads the page so everything is read afresh. */
  onRestored?: () => void;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Notice = { kind: 'ok' | 'error'; text: string } | null;

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) {
    return null;
  }
  return notice.kind === 'error' ? (
    <p className={form.error} role="alert">
      {notice.text}
    </p>
  ) : (
    <p className={styles.ok} role="status">
      {notice.text}
    </p>
  );
}

export function SettingsPage({ settings, today, backendReady, onSave, onDataChanged, onRestored }: SettingsPageProps) {
  return (
    <div className={styles.page}>
      <header>
        <h1>Settings</h1>
      </header>
      {settings === null ? (
        <LoadingState label="Loading settings…" />
      ) : (
        <ProfileSection settings={settings} backendReady={backendReady} onSave={onSave} onSaved={onDataChanged} />
      )}
      <TargetSection today={today} backendReady={backendReady} onDataChanged={onDataChanged} />
      <BackupSection backendReady={backendReady} onRestored={onRestored} />
      <ExportSection today={today} backendReady={backendReady} />
    </div>
  );
}

function ProfileSection({
  settings,
  backendReady,
  onSave,
  onSaved,
}: {
  settings: AppSettings;
  backendReady: boolean;
  onSave: (input: UpdateSettingsInput) => Promise<AppSettings>;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [weekStart, setWeekStart] = useState(settings.weekStart);
  const [timeFormat, setTimeFormat] = useState(settings.timeFormat);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const zones = timeZones().includes(settings.timezone) ? timeZones() : [settings.timezone, ...timeZones()];
  const dirty =
    displayName !== settings.displayName ||
    timezone !== settings.timezone ||
    weekStart !== settings.weekStart ||
    timeFormat !== settings.timeFormat;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await onSave({ displayName, timezone, weekStart, timeFormat });
      onSaved();
      setNotice({ kind: 'ok', text: 'Settings saved.' });
    } catch (failure) {
      setNotice({ kind: 'error', text: errorMessage(failure) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="settings-profile">
      <h2 id="settings-profile">Profile and display</h2>
      <form className={styles.form} onSubmit={(event) => void save(event)}>
        <div className={form.field}>
          <label className={form.label} htmlFor="setting-name">
            Display name
          </label>
          <input
            id="setting-name"
            className={form.control}
            value={displayName}
            maxLength={60}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>
        <div className={form.field}>
          <label className={form.label} htmlFor="setting-timezone">
            Timezone
          </label>
          <select
            id="setting-timezone"
            className={form.control}
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <p className={styles.hint}>
            Decides what "today" is and which day a finished task belongs to. Reading and review dates you already
            recorded, and all-day events, keep their dates.
          </p>
        </div>
        <div className={styles.row}>
          <div className={form.field}>
            <label className={form.label} htmlFor="setting-week">
              Week starts on
            </label>
            <select
              id="setting-week"
              className={form.control}
              value={weekStart}
              onChange={(event) => setWeekStart(Number(event.target.value))}
            >
              {Array.from({ length: 7 }, (_, index) => (
                <option key={index} value={index}>
                  {longWeekday(index)}
                </option>
              ))}
            </select>
          </div>
          <div className={form.field}>
            <label className={form.label} htmlFor="setting-clock">
              Time display
            </label>
            <select
              id="setting-clock"
              className={form.control}
              value={timeFormat}
              onChange={(event) => setTimeFormat(event.target.value as AppSettings['timeFormat'])}
            >
              <option value="H12">12-hour (9:30 PM)</option>
              <option value="H24">24-hour (21:30)</option>
            </select>
          </div>
        </div>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={!dirty || saving || !backendReady}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
          <NoticeLine notice={notice} />
        </div>
      </form>
    </section>
  );
}

/** "Sunday" … "Saturday" for 0 … 6. */
function longWeekday(index: number): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2023, 0, 1 + index)),
  );
}

function TargetSection({
  today,
  backendReady,
  onDataChanged,
}: {
  today: IsoDate;
  backendReady: boolean;
  onDataChanged: () => void;
}) {
  const [changes, setChanges] = useState(0);
  const [open, setOpen] = useState(false);
  const day = useLoadable(`settings-day:${today}`, changes, backendReady, () => calendarApi.getDay(today));
  const goals = useLoadable('settings-goals', changes, backendReady, () => readingGoalsApi.list());

  return (
    <section className={styles.section} aria-labelledby="settings-target">
      <h2 id="settings-target">Reading target</h2>
      {day.status === 'loaded' ? (
        <p>
          {pages(day.data.readingGoal.targetPages)} a day
          {day.data.readingGoal.effectiveDate
            ? `, since ${formatShortDate(day.data.readingGoal.effectiveDate)}`
            : ' (the starting default)'}
          . Earlier days keep the target they had.
        </p>
      ) : day.status === 'error' ? (
        <p className={form.error} role="alert">
          The target could not be loaded: {day.message}
        </p>
      ) : (
        <p className={styles.muted}>Loading…</p>
      )}
      <div className={styles.actions}>
        <Button disabled={day.status !== 'loaded'} onClick={() => setOpen(true)}>
          Change target
        </Button>
      </div>
      {open && day.status === 'loaded' && (
        <GoalDialog
          current={day.data.readingGoal}
          history={goals.status === 'loaded' ? goals.data : []}
          today={today}
          backendReady={backendReady}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setChanges((count) => count + 1);
            onDataChanged();
          }}
        />
      )}
    </section>
  );
}

function BackupSection({ backendReady, onRestored }: { backendReady: boolean; onRestored?: () => void }) {
  const [changes, setChanges] = useState(0);
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const status = useLoadable('backups', changes, backendReady, () => backupsApi.status());

  const run = async (kind: 'backup' | 'restore', action: () => Promise<string>) => {
    setBusy(kind);
    setNotice(null);
    try {
      setNotice({ kind: 'ok', text: await action() });
    } catch (failure) {
      if (!isCancelled(failure)) {
        setNotice({ kind: 'error', text: errorMessage(failure) });
      }
    } finally {
      setBusy(null);
      setChanges((count) => count + 1);
    }
  };

  const backUp = () =>
    run('backup', async () => {
      const backup = await backupsApi.backupNow();
      return `Backup saved and checked: ${backup.name}.`;
    });

  const restore = () =>
    run('restore', async () => {
      await backupsApi.restore();
      // The data was replaced underneath every screen; load them all again.
      (onRestored ?? (() => window.location.reload()))();
      return 'Backup restored.';
    });

  const copy = (backup: BackupInfo) =>
    run('backup', async () => `Copy saved as ${(await backupsApi.saveCopy(backup.name)).fileName}.`);

  const last = status.status === 'loaded' ? status.data.lastAttempt : null;

  return (
    <section className={styles.section} aria-labelledby="settings-backups">
      <h2 id="settings-backups">Backups</h2>
      <p className={styles.muted}>
        A backup is a complete, checked copy of your data. One is made automatically each day the app is open, and the
        newest seven are kept. Manual backups are never deleted.
      </p>
      <div className={styles.actions}>
        <Button variant="primary" disabled={busy !== null || !backendReady} onClick={() => void backUp()}>
          {busy === 'backup' ? 'Backing up…' : 'Back up now'}
        </Button>
        <Button onClick={() => void backupsApi.openFolder()}>Open backup folder</Button>
        <Button disabled={busy !== null || !backendReady} onClick={() => void restore()}>
          {busy === 'restore' ? 'Restoring…' : 'Restore from a file…'}
        </Button>
      </div>
      <NoticeLine notice={notice} />
      {last && !last.ok && (
        <p className={form.error} role="alert">
          The last backup failed ({formatTimestamp(last.at)}): {last.message}
        </p>
      )}

      {status.status === 'loading' && <p className={styles.muted}>Loading…</p>}
      {status.status === 'error' && (
        <p className={form.error} role="alert">
          Backups could not be listed: {status.message}
        </p>
      )}
      {status.status === 'loaded' && (
        <>
          <p className={styles.muted}>
            Location: <code>{status.data.directory}</code>
          </p>
          {status.data.backups.length === 0 ? (
            <p className={styles.muted}>No backups yet.</p>
          ) : (
            <ul className={styles.backups} aria-label="Backups">
              {status.data.backups.map((backup) => (
                <li key={backup.name} className={styles.backup}>
                  <div>
                    <strong>{KIND_LABELS[backup.kind]}</strong> · {formatTimestamp(backup.createdAt)} ·{' '}
                    {formatSize(backup.sizeBytes)}
                    {!backup.verified && <span className={styles.warning}> · not checked</span>}
                    <div className={styles.muted}>{backup.name}</div>
                  </div>
                  <Button disabled={busy !== null} onClick={() => void copy(backup)}>
                    Save a copy…
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function ExportSection({ today, backendReady }: { today: IsoDate; backendReady: boolean }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const save = async (dataset: ExportDataset, range?: { from: string; to: string }) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await exportsApi.save(dataset, range);
      setNotice({
        kind: 'ok',
        text: result.truncated
          ? `Saved ${result.fileName}, but it was cut at the size limit and is not complete.`
          : `Saved ${result.fileName}.`,
      });
    } catch (failure) {
      if (!isCancelled(failure)) {
        setNotice({ kind: 'error', text: errorMessage(failure) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="settings-export">
      <h2 id="settings-export">Export to a spreadsheet</h2>
      <p className={styles.muted}>Each export is a CSV file that opens in Excel or any spreadsheet.</p>
      <div className={styles.actions}>
        {EXPORTS.map(({ dataset, label }) => (
          <Button key={dataset} disabled={busy || !backendReady} onClick={() => void save(dataset)}>
            {label}
          </Button>
        ))}
        <Button
          disabled={busy || !backendReady}
          onClick={() => void save('summaries', { from: addDays(today, 1 - SUMMARY_DAYS), to: addDays(today, 1) })}
        >
          Daily summaries (last {SUMMARY_DAYS} days)
        </Button>
      </div>
      <NoticeLine notice={notice} />
    </section>
  );
}
