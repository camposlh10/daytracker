import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiResult, DayDetails, Task } from '../../api/bridge';
import { emptyDay, installFakeBridge, task } from '../../test/fakeBridge';
import { CalendarPage } from './CalendarPage';

function day(date: string, tasks: Task[], carryOver: Task[] = []): ApiResult<DayDetails> {
  return { ok: true, data: { ...emptyDay(date), tasks, carryOver } };
}

const panel = () => screen.getByRole('complementary', { name: 'Selected day' });

describe('CalendarPage task actions', () => {
  it('completes and reopens a task from the selected day and reloads', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const pending = task({ title: 'Write report', plannedDate: '2026-10-04', version: 3 });
    const done = { ...pending, status: 'DONE' as const, completedAt: '2026-10-04T15:00:00.000Z', version: 4 };
    bridge.calendar.getDay.mockResolvedValueOnce(day('2026-10-04', [pending])).mockResolvedValue(day('2026-10-04', [done]));
    render(<CalendarPage today="2026-10-04" backendReady />);

    await user.click(await screen.findByRole('button', { name: 'Mark “Write report” as done' }));

    expect(bridge.tasks.update).toHaveBeenCalledWith(pending.id, { version: 3, status: 'DONE' });
    await user.click(await screen.findByRole('button', { name: 'Reopen “Write report”' }));
    expect(bridge.tasks.update).toHaveBeenLastCalledWith(pending.id, { version: 4, status: 'PENDING' });
  });

  it('lists carried-over tasks and moves one to the selected day only when asked', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const overdue = task({ title: 'Overdue task', plannedDate: '2026-10-01', version: 2 });
    bridge.calendar.getDay.mockResolvedValue(day('2026-10-04', [], [overdue]));
    render(<CalendarPage today="2026-10-04" backendReady />);

    const carried = await screen.findByRole('list', { name: 'Carried over tasks' });
    expect(within(carried).getByText('Overdue task')).toBeInTheDocument();
    expect(within(carried).getByText(/Planned Oct 1, 2026/)).toBeInTheDocument();
    expect(bridge.tasks.update).not.toHaveBeenCalled();

    await user.click(within(carried).getByRole('button', { name: 'Move “Overdue task” to this day' }));

    expect(bridge.tasks.update).toHaveBeenCalledWith(overdue.id, { version: 2, plannedDate: '2026-10-04' });
  });

  it('explains a stale change and shows the current state instead', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const stale = task({ title: 'Edited elsewhere', plannedDate: '2026-10-04' });
    bridge.calendar.getDay.mockResolvedValue(day('2026-10-04', [stale]));
    bridge.tasks.update.mockResolvedValue({
      ok: false,
      error: { status: 409, code: 'CONFLICT', message: 'The task was changed after it was loaded.' },
    });
    render(<CalendarPage today="2026-10-04" backendReady />);
    await screen.findByText('Edited elsewhere');
    const readsBefore = bridge.calendar.getDay.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Mark “Edited elsewhere” as done' }));

    expect(await within(panel()).findByRole('alert')).toHaveTextContent(/had changed, so nothing was saved/);
    await waitFor(() => expect(bridge.calendar.getDay.mock.calls.length).toBeGreaterThan(readsBefore));
  });

  it('opens the full editor from the toolbar with the selected date filled in', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.tasks.create.mockResolvedValue({ ok: true, data: task({ title: 'Plan trip' }) });
    render(<CalendarPage today="2026-10-04" backendReady />);
    await user.click(screen.getByRole('button', { name: /^Thursday, October 15, 2026/ }));

    await user.click(screen.getByRole('button', { name: '+ Add task' }));
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    expect(within(dialog).getByLabelText(/Planned date/)).toHaveValue('2026-10-15');
    await user.type(within(dialog).getByLabelText('Title'), 'Plan trip');
    await user.selectOptions(within(dialog).getByLabelText('Priority'), 'HIGH');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bridge.tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Plan trip',
        priority: 'HIGH',
        plannedDate: '2026-10-15',
        deadlineDate: null,
        categoryId: null,
      }),
    );
  });

  it('opens a task for editing from the selected day', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const existing = task({ title: 'Existing', plannedDate: '2026-10-04' });
    bridge.calendar.getDay.mockResolvedValue(day('2026-10-04', [existing]));
    render(<CalendarPage today="2026-10-04" backendReady />);

    await user.click(await screen.findByRole('button', { name: 'Edit “Existing”' }));

    const dialog = screen.getByRole('dialog', { name: 'Edit task' });
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Existing');
    expect(bridge.tasks.getActivity).toHaveBeenCalledWith(existing.id);
  });
});
