import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DayProgress, Progress } from '../../api/bridge';
import { installFakeBridge, progress, task } from '../../test/fakeBridge';
import { ProgressPage } from './ProgressPage';

function day(date: string, overrides: Partial<DayProgress> = {}): DayProgress {
  return { date, tasksCompleted: 0, pagesRead: 0, targetPages: 30, targetPercent: 0, future: false, ...overrides };
}

const WEEK_FROM = '2026-09-28';
const WEEK_TO = '2026-10-05';

function weekReport(overrides: Partial<Progress> = {}): Progress {
  return progress({
    from: WEEK_FROM,
    to: WEEK_TO,
    today: '2026-10-01',
    elapsedDays: 4,
    days: [
      day('2026-09-28', { pagesRead: 45, targetPercent: 150, tasksCompleted: 2 }),
      day('2026-09-29', { pagesRead: 15, targetPercent: 50 }),
      day('2026-09-30'),
      day('2026-10-01'),
      day('2026-10-02', { targetPercent: null, future: true }),
      day('2026-10-03', { targetPercent: null, future: true }),
      day('2026-10-04', { targetPercent: null, future: true }),
    ],
    ...overrides,
  });
}

describe('ProgressPage', () => {
  it('shows a week in progress judged on the days that have begun, with real figures above the cap', async () => {
    const { bridge } = installFakeBridge();
    bridge.progress.get.mockResolvedValue({
      ok: true,
      data: weekReport({
        tasksCompleted: 2,
        tasksPlanned: 3,
        pagesRead: 60,
        readingDays: 2,
        consistencyPercent: 50,
        targetPercent: 50,
        completedTasks: [task({ title: 'Ship it', status: 'DONE', completedAt: '2026-09-28T15:00:00.000Z' })],
        books: [
          {
            bookId: crypto.randomUUID(),
            title: 'Dune',
            coverUpdatedAt: null,
            pagesRead: 60,
            currentPage: 120,
            totalPages: 600,
            positionPercent: 20,
          },
        ],
      }),
    });

    render(<ProgressPage today="2026-10-01" weekStart={1} backendReady />);

    expect(await screen.findByText('Week of Sep 28 – Oct 4, 2026')).toBeInTheDocument();
    expect(bridge.progress.get).toHaveBeenCalledWith({ from: WEEK_FROM, to: WEEK_TO });
    expect(screen.getByText('In progress: 4 of 7 days so far. 3 tasks planned for this week.')).toBeInTheDocument();
    const totals = screen.getByLabelText('Totals');
    expect(within(totals).getByText('2 of 4')).toBeInTheDocument();
    expect(within(totals).getByText('50% of the days so far')).toBeInTheDocument();
    expect(within(totals).getByText('50% of the 120 pages target')).toBeInTheDocument();

    // The bar is capped at the target, while the text keeps the real count and percentage.
    const bar = screen.getByLabelText('Reading target on Sep 28, 2026');
    expect(bar).toHaveAttribute('value', '30');
    expect(bar).toHaveAttribute('max', '30');
    expect(screen.getByText('45 of 30 pages (150%)')).toBeInTheDocument();
    expect(screen.getAllByText('Upcoming')).toHaveLength(3);

    expect(screen.getByText('Ship it')).toBeInTheDocument();
    expect(screen.getByText(/60 pages in this week · now on page 120 of 600/)).toBeInTheDocument();
  });

  it('says there was no activity for an empty past period', async () => {
    const { bridge } = installFakeBridge();
    bridge.progress.get.mockResolvedValue({
      ok: true,
      data: weekReport({ today: '2026-11-01', elapsedDays: 7, consistencyPercent: 0, targetPercent: 0 }),
    });

    render(<ProgressPage today="2026-10-01" weekStart={1} backendReady />);

    expect(await screen.findByText('No activity recorded')).toBeInTheDocument();
    expect(screen.queryByLabelText('Totals')).not.toBeInTheDocument();
  });

  it('shows what is planned for a future period without any rates', async () => {
    const { bridge } = installFakeBridge();
    bridge.progress.get.mockResolvedValue({
      ok: true,
      data: weekReport({
        today: '2026-09-01',
        elapsedDays: 0,
        tasksPlanned: 2,
        days: weekReport().days.map((entry) => ({ ...entry, targetPercent: null, future: true })),
      }),
    });

    render(<ProgressPage today="2026-10-01" weekStart={1} backendReady />);

    expect(await screen.findByText('This period has not started. 2 tasks planned for this week.')).toBeInTheDocument();
    expect(screen.queryByText('No activity recorded')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Totals')).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('says nothing is planned when a future period is empty', async () => {
    const { bridge } = installFakeBridge();
    bridge.progress.get.mockResolvedValue({ ok: true, data: weekReport({ elapsedDays: 0 }) });

    render(<ProgressPage today="2026-10-01" weekStart={1} backendReady />);

    expect(await screen.findByText('Nothing planned yet.')).toBeInTheDocument();
  });

  it('follows the week-start setting and moves between periods', async () => {
    const { bridge } = installFakeBridge();
    const user = userEvent.setup();

    // 2026-10-01 is a Thursday: a Sunday-first week starts on Sep 27.
    render(<ProgressPage today="2026-10-01" weekStart={0} backendReady />);
    await screen.findByText('Week of Sep 27 – Oct 3, 2026');
    expect(bridge.progress.get).toHaveBeenLastCalledWith({ from: '2026-09-27', to: '2026-10-04' });

    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(await screen.findByText('Week of Sep 20 – Sep 26, 2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Month' }));
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
    expect(bridge.progress.get).toHaveBeenLastCalledWith({ from: '2026-09-01', to: '2026-10-01' });

    await user.click(screen.getByRole('button', { name: 'Day' }));
    expect(await screen.findByRole('heading', { name: 'Thursday, September 24, 2026' })).toBeInTheDocument();
    expect(bridge.progress.get).toHaveBeenLastCalledWith({ from: '2026-09-24', to: '2026-09-25' });

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('heading', { name: 'Thursday, October 1, 2026' })).toBeInTheDocument();
  });

  it('reports a failure instead of showing zeroes', async () => {
    const { bridge } = installFakeBridge();
    bridge.progress.get.mockResolvedValue({
      ok: false,
      error: { status: 0, code: 'BACKEND_UNREACHABLE', message: 'The data service did not respond.' },
    });

    render(<ProgressPage today="2026-10-01" weekStart={1} backendReady />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Progress could not be loaded');
  });
});
