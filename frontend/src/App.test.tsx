import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { formatLongDate, formatMonthTitle, todayIso } from './lib/dates';
import { appSettings, installFakeBridge } from './test/fakeBridge';

/** The task form is hidden on an empty day until "+ Task" is pressed. */
async function openTaskForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '+ Task' }));
  return screen.getByLabelText(/Add a task for this day/);
}

describe('App lifecycle', () => {
  it('shows a loading state, not an empty workspace, while the backend starts', async () => {
    const { bridge } = installFakeBridge({ status: 'starting' });

    render(<App />);

    expect(await screen.findByText('Starting Day Tracker…')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(bridge.calendar.getRange).not.toHaveBeenCalled();
  });

  it('offers Retry, Open diagnostics, and Exit when startup fails', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge({
      status: 'failed',
      reason: 'timeout',
      message: 'The data service did not start in time.',
    });

    render(<App />);

    expect(await screen.findByText('The data service did not start in time.')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await user.click(screen.getByRole('button', { name: 'Open diagnostics' }));
    await user.click(screen.getByRole('button', { name: 'Exit' }));
    expect(bridge.backend.restart).toHaveBeenCalledTimes(1);
    expect(bridge.app.openDiagnostics).toHaveBeenCalledTimes(1);
    expect(bridge.app.exit).toHaveBeenCalledTimes(1);
  });

  it('opens the calendar on today once the backend reports ready', async () => {
    const { pushState } = installFakeBridge({ status: 'starting' });
    render(<App />);
    await screen.findByText('Starting Day Tracker…');

    act(() => pushState({ status: 'ready' }));

    expect(await screen.findByRole('grid', { name: formatMonthTitle(todayIso()) })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: formatLongDate(todayIso()) })).toBeInTheDocument();
  });

  it('keeps typed input and disables saving when the backend crashes', async () => {
    const user = userEvent.setup();
    const { bridge, pushState } = installFakeBridge({ status: 'ready' });
    render(<App />);
    const input = await openTaskForm(user);
    await user.type(input, 'Unsaved thought');

    act(() => pushState({ status: 'failed', reason: 'crashed', message: 'The data service stopped unexpectedly.' }));

    expect(await screen.findByText(/The data service stopped/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Add a task for this day/)).toHaveValue('Unsaved thought');
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Restart' }));
    expect(bridge.backend.restart).toHaveBeenCalledTimes(1);
    expect(bridge.tasks.create).not.toHaveBeenCalled();
  });
});

describe('App navigation', () => {
  it('keeps the calendar selection and draft while the task list is open', async () => {
    const user = userEvent.setup();
    installFakeBridge({ status: 'ready' });
    render(<App />);
    await user.type(await openTaskForm(user), 'Half-written');

    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(await screen.findByText('No tasks yet')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.getByLabelText(/Add a task for this day/)).toHaveValue('Half-written');
  });

  it('returns to today from another view', async () => {
    const user = userEvent.setup();
    installFakeBridge({ status: 'ready' });
    render(<App />);
    await screen.findByRole('grid');
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Tasks' }));

    await user.click(screen.getByRole('button', { name: 'Go to today' }));

    expect(screen.getByRole('grid', { name: formatMonthTitle(todayIso()) })).toBeInTheDocument();
  });
});

describe('App settings', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the settings before showing the calendar', async () => {
    const { bridge } = installFakeBridge({ status: 'ready' });
    let release: () => void = () => undefined;
    bridge.settings.get.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ ok: true, data: appSettings() }))),
    );

    render(<App />);

    // The settings are only asked for once the backend state is known to be ready.
    await waitFor(() => expect(bridge.settings.get).toHaveBeenCalled());
    expect(screen.getByText('Starting Day Tracker…')).toBeInTheDocument();
    expect(bridge.calendar.getRange).not.toHaveBeenCalled();
    act(() => release());
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });

  it('starts the calendar week on the chosen day', async () => {
    const { bridge } = installFakeBridge({ status: 'ready' });
    bridge.settings.get.mockResolvedValue({ ok: true, data: appSettings({ weekStart: 0 }) });

    render(<App />);

    await screen.findByRole('grid');
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('Sun');
  });

  it('uses the chosen timezone to decide what today is', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 20:00 UTC on the 25th is already Monday the 26th at UTC+14.
    vi.setSystemTime(new Date('2026-10-25T20:00:00Z'));
    const { bridge } = installFakeBridge({ status: 'ready' });
    bridge.settings.get.mockResolvedValue({ ok: true, data: appSettings({ timezone: 'Pacific/Kiritimati' }) });

    render(<App />);

    expect(await screen.findByRole('heading', { level: 2, name: 'Monday, October 26, 2026' })).toBeInTheDocument();
  });

  it('still opens with defaults when the settings cannot be read', async () => {
    const { bridge } = installFakeBridge({ status: 'ready' });
    bridge.settings.get.mockResolvedValue({
      ok: false,
      error: { status: 500, code: 'ERROR', message: 'broken' },
    });

    render(<App />);

    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });

  it('shows the display name and opens Progress and Settings', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge({ status: 'ready' });
    bridge.settings.get.mockResolvedValue({ ok: true, data: appSettings({ displayName: 'Ana' }) });
    render(<App />);
    expect(await screen.findByText('Ana')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Progress' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Progress' })).toBeInTheDocument();
    expect(bridge.progress.get).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Display name')).toHaveValue('Ana');
  });

  it('applies saved settings at once', async () => {
    const user = userEvent.setup();
    installFakeBridge({ status: 'ready' });
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Settings' }));

    await user.type(await screen.findByLabelText('Display name'), 'Bea');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(screen.getAllByText('Bea').length).toBeGreaterThan(0);
  });
});
