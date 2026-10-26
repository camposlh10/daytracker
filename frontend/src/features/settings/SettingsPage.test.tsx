import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BackupInfo, BackupStatus } from '../../api/bridge';
import { appSettings, emptyDay, installFakeBridge } from '../../test/fakeBridge';
import { SettingsPage } from './SettingsPage';

function backup(overrides: Partial<BackupInfo> = {}): BackupInfo {
  return {
    name: 'manual-20261025-153012345.db',
    kind: 'MANUAL',
    createdAt: '2026-10-25T15:30:12.000Z',
    sizeBytes: 204_800,
    schemaVersion: 3,
    appVersion: '0.1.0',
    verified: true,
    ...overrides,
  };
}

function setup(
  prepare: (bridge: ReturnType<typeof installFakeBridge>['bridge']) => void = () => undefined,
  overrides: Partial<React.ComponentProps<typeof SettingsPage>> = {},
) {
  const fake = installFakeBridge();
  prepare(fake.bridge);
  fake.bridge.calendar.getDay.mockResolvedValue({ ok: true, data: emptyDay('2026-10-25') });
  fake.bridge.readingGoals.list.mockResolvedValue({ ok: true, data: [] });
  const onSave = vi.fn(async (input) => appSettings(input));
  const onDataChanged = vi.fn();
  const onRestored = vi.fn();
  render(
    <SettingsPage
      settings={appSettings({ displayName: 'Ana', timezone: 'America/Sao_Paulo' })}
      today="2026-10-25"
      backendReady
      onSave={onSave}
      onDataChanged={onDataChanged}
      onRestored={onRestored}
      {...overrides}
    />,
  );
  return { ...fake, onSave, onDataChanged, onRestored };
}

describe('SettingsPage', () => {
  it('saves only after something changed, with every display setting', async () => {
    const { onSave, onDataChanged } = setup();
    const user = userEvent.setup();
    const save = screen.getByRole('button', { name: 'Save settings' });
    expect(save).toBeDisabled();

    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), 'Ana Souza');
    await user.selectOptions(screen.getByLabelText('Week starts on'), 'Sunday');
    await user.selectOptions(screen.getByLabelText('Time display'), '24-hour (21:30)');
    await user.click(save);

    expect(onSave).toHaveBeenCalledWith({
      displayName: 'Ana Souza',
      timezone: 'America/Sao_Paulo',
      weekStart: 0,
      timeFormat: 'H24',
    });
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(onDataChanged).toHaveBeenCalled();
  });

  it('explains what a timezone change does and does not affect', () => {
    setup();

    expect(screen.getByText(/all-day events, keep their dates/)).toBeInTheDocument();
  });

  it('shows a failed save', async () => {
    const { onSave } = setup();
    onSave.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Display name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('shows the current reading target and lets it be changed', async () => {
    const { bridge, onDataChanged } = setup();
    const user = userEvent.setup();
    bridge.readingGoals.set.mockResolvedValue({
      ok: true,
      data: { effectiveDate: '2026-10-25', targetPages: 40, updatedAt: '2026-10-25T12:00:00.000Z' },
    });

    expect(await screen.findByText(/30 pages a day/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change target' }));
    const field = await screen.findByLabelText('Pages per day');
    await user.clear(field);
    await user.type(field, '40');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(bridge.readingGoals.set).toHaveBeenCalledWith('2026-10-25', 40));
    expect(onDataChanged).toHaveBeenCalled();
  });

  describe('backups', () => {
    it('lists backups with their location and makes one on request', async () => {
      const listed: BackupStatus = {
        directory: 'C:\\Users\\Ana\\AppData\\Roaming\\Day Tracker\\data\\backups',
        backups: [backup()],
        lastAttempt: null,
      };
      const { bridge } = setup((fake) => {
        fake.backups.status.mockResolvedValue({ ok: true, data: listed });
        fake.backups.backupNow.mockResolvedValue({ ok: true, data: backup({ name: 'manual-20261025-160000000.db' }) });
      });
      const user = userEvent.setup();

      const list = await screen.findByRole('list', { name: 'Backups' });
      expect(within(list).getByText('manual-20261025-153012345.db')).toBeInTheDocument();
      expect(screen.getByText(/Day Tracker\\data\\backups/)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Back up now' }));

      expect(await screen.findByText('Backup saved and checked: manual-20261025-160000000.db.')).toBeInTheDocument();
      expect(bridge.backups.status).toHaveBeenCalledTimes(2);
    });

    it('never reports a failed backup as a success', async () => {
      const { bridge } = setup();
      bridge.backups.backupNow.mockResolvedValue({
        ok: false,
        error: { status: 500, code: 'BACKUP_FAILED', message: 'The backup could not be written. The disk may be full.' },
      });
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Back up now' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('The backup could not be written');
      expect(screen.queryByText(/Backup saved/)).not.toBeInTheDocument();
    });

    it('shows the last failed attempt when the page is opened', async () => {
      setup((fake) =>
        fake.backups.status.mockResolvedValue({
          ok: true,
          data: {
            directory: 'C:\\backups',
            backups: [],
            lastAttempt: {
              kind: 'AUTOMATIC',
              ok: false,
              at: '2026-10-25T10:00:00.000Z',
              message: 'The backup could not be written.',
              fileName: null,
            },
          },
        }),
      );

      expect(await screen.findByText(/The last backup failed/)).toBeInTheDocument();
      expect(screen.getByText('No backups yet.')).toBeInTheDocument();
    });

    it('saves a copy of a listed backup and stays quiet when the dialog is cancelled', async () => {
      const { bridge } = setup((fake) => {
        fake.backups.status.mockResolvedValue({
          ok: true,
          data: { directory: 'C:\\backups', backups: [backup()], lastAttempt: null },
        });
        fake.backups.saveCopy
          .mockResolvedValueOnce({ ok: false, error: { status: 0, code: 'CANCELLED', message: 'No place was chosen.' } })
          .mockResolvedValueOnce({ ok: true, data: { fileName: 'my-copy.db' } });
      });
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Save a copy…' }));
      await waitFor(() => expect(bridge.backups.saveCopy).toHaveBeenCalledWith('manual-20261025-153012345.db'));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Save a copy…' }));
      expect(await screen.findByText('Copy saved as my-copy.db.')).toBeInTheDocument();
    });

    it('reloads everything after a restore and keeps quiet when it is cancelled', async () => {
      const { bridge, onRestored } = setup();
      bridge.backups.restore
        .mockResolvedValueOnce({ ok: false, error: { status: 0, code: 'CANCELLED', message: 'No file was chosen.' } })
        .mockResolvedValueOnce({ ok: true, data: { counts: { tasks: 3 } } });
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Restore from a file…' }));
      await waitFor(() => expect(bridge.backups.restore).toHaveBeenCalledTimes(1));
      expect(onRestored).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Restore from a file…' }));
      await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    });

    it('explains why a backup file was refused', async () => {
      const { bridge, onRestored } = setup();
      bridge.backups.restore.mockResolvedValue({
        ok: false,
        error: { status: 400, code: 'RESTORE_REJECTED', message: 'That backup was made by a newer version of Day Tracker.' },
      });
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Restore from a file…' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('newer version');
      expect(onRestored).not.toHaveBeenCalled();
    });
  });

  describe('exports', () => {
    it('asks for each dataset and reports the saved file', async () => {
      const { bridge } = setup();
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Reading sessions' }));

      expect(bridge.exports.save).toHaveBeenCalledWith('reading-sessions', undefined);
      expect(await screen.findByText('Saved tasks.csv.')).toBeInTheDocument();
    });

    it('exports the last 90 days of summaries, ending today', async () => {
      const { bridge } = setup();
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: /Daily summaries/ }));

      expect(bridge.exports.save).toHaveBeenCalledWith('summaries', { from: '2026-07-28', to: '2026-10-26' });
    });

    it('warns when an export was cut short', async () => {
      const { bridge } = setup();
      bridge.exports.save.mockResolvedValue({ ok: true, data: { fileName: 'tasks.csv', truncated: true } });
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Tasks' }));

      expect(await screen.findByText(/not complete/)).toBeInTheDocument();
    });

    it('stays quiet when the save dialog is cancelled but reports other failures', async () => {
      const { bridge } = setup();
      bridge.exports.save
        .mockResolvedValueOnce({ ok: false, error: { status: 0, code: 'CANCELLED', message: 'No place was chosen.' } })
        .mockResolvedValueOnce({
          ok: false,
          error: { status: 400, code: 'FILE_WRITE_FAILED', message: 'There is not enough free disk space.' },
        });
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Tasks' }));
      await waitFor(() => expect(bridge.exports.save).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Tasks' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('not enough free disk space');
    });
  });
});
