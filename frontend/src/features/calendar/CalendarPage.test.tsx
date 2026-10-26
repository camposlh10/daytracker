import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ApiResult,
  CalendarItem,
  CalendarRange,
  CalendarRangeQuery,
  DayDetails,
  Task,
} from '../../api/bridge';
import { emptyDay, installFakeBridge, progress, task } from '../../test/fakeBridge';
import { CalendarPage } from './CalendarPage';

type TaskItem = Extract<CalendarItem, { type: 'TASK' }>;

function item(date: string, title: string, overrides: Partial<TaskItem> = {}): CalendarItem {
  return { type: 'TASK', id: crypto.randomUUID(), date, title, status: 'PENDING', priority: 'MEDIUM', ...overrides };
}

function rangeOf(items: CalendarItem[]) {
  return async (query: CalendarRangeQuery): Promise<ApiResult<CalendarRange>> => ({
    ok: true,
    data: {
      from: query.from,
      to: query.to,
      items: items.filter((entry) => entry.date >= query.from && entry.date < query.to),
    },
  });
}

function dayOf(date: string, titles: string[], carryOver: Task[] = []): ApiResult<DayDetails> {
  return {
    ok: true,
    data: { ...emptyDay(date), tasks: titles.map((title) => task({ title, plannedDate: date })), carryOver },
  };
}

/** The task form is hidden on an empty day until "+ Task" is pressed. */
async function openTaskForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '+ Task' }));
  return screen.getByLabelText(/Add a task for this day/);
}

const title = () => screen.getByRole('heading', { level: 1 });
const panelDate = () => within(screen.getByRole('complementary', { name: 'Selected day' })).getByRole('heading', { level: 2 });
const dayButton = (name: RegExp) => screen.getByRole('button', { name });
const selectedCells = () => screen.getAllByRole('gridcell', { selected: true });

describe('CalendarPage navigation', () => {
  it('shows a fixed six-week month with today selected', async () => {
    const { bridge } = installFakeBridge();

    render(<CalendarPage today="2026-10-04" backendReady />);

    expect(title()).toHaveTextContent('October 2026');
    expect(panelDate()).toHaveTextContent('Sunday, October 4, 2026');
    const cells = screen.getAllByRole('gridcell');
    expect(cells).toHaveLength(42);
    expect(within(cells[0]).getByRole('button', { name: /^Monday, September 28, 2026/ })).toBeInTheDocument();
    expect(within(cells[41]).getByRole('button', { name: /^Sunday, November 8, 2026/ })).toBeInTheDocument();
    expect(dayButton(/^Sunday, October 4, 2026, today/)).toHaveAttribute('aria-current', 'date');
    await waitFor(() =>
      expect(bridge.calendar.getRange).toHaveBeenCalledWith({ from: '2026-09-28', to: '2026-11-09' }),
    );
  });

  it('moves forward across a year boundary without losing the selected date', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    render(<CalendarPage today="2026-12-15" backendReady />);

    await user.click(screen.getByRole('button', { name: 'Next month' }));

    expect(title()).toHaveTextContent('January 2027');
    expect(dayButton(/^Friday, January 1, 2027/)).toBeInTheDocument();
    expect(dayButton(/^Sunday, January 31, 2027/)).toBeInTheDocument();
    expect(panelDate()).toHaveTextContent('Tuesday, December 15, 2026');
    await waitFor(() =>
      expect(bridge.calendar.getRange).toHaveBeenCalledWith({ from: '2026-12-28', to: '2027-02-08' }),
    );

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(title()).toHaveTextContent('February 2027');
    expect(screen.queryByRole('button', { name: /February 29, 2027/ })).not.toBeInTheDocument();
  });

  it('moves backward across a year boundary and back to today', async () => {
    const user = userEvent.setup();
    installFakeBridge();
    render(<CalendarPage today="2027-01-31" backendReady />);

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(title()).toHaveTextContent('December 2026');
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(title()).toHaveTextContent('November 2026');

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(title()).toHaveTextContent('January 2027');
    expect(panelDate()).toHaveTextContent('Sunday, January 31, 2027');
  });

  it('shows a leap day', async () => {
    installFakeBridge();
    render(<CalendarPage today="2028-02-10" backendReady />);

    expect(dayButton(/^Tuesday, February 29, 2028/)).toBeInTheDocument();
  });

  it('switches between month and week without losing the selected date', async () => {
    const user = userEvent.setup();
    installFakeBridge();
    render(<CalendarPage today="2026-10-04" backendReady />);

    await user.click(screen.getByRole('button', { name: 'Week' }));
    expect(title()).toHaveTextContent('Sep 28 – Oct 4, 2026');
    expect(screen.getAllByRole('gridcell')).toHaveLength(7);
    expect(selectedCells()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(title()).toHaveTextContent('Oct 5 – Oct 11, 2026');
    expect(panelDate()).toHaveTextContent('Sunday, October 4, 2026');

    await user.click(screen.getByRole('button', { name: 'Month' }));
    expect(title()).toHaveTextContent('October 2026');
    expect(within(selectedCells()[0]).getByRole('button', { name: /October 4, 2026/ })).toBeInTheDocument();
  });

  it('shows a week that spans two years', async () => {
    const user = userEvent.setup();
    installFakeBridge();
    render(<CalendarPage today="2027-01-01" backendReady />);

    await user.click(screen.getByRole('button', { name: 'Week' }));

    expect(title()).toHaveTextContent('Dec 28, 2026 – Jan 3, 2027');
    expect(dayButton(/^Thursday, December 31, 2026/)).toBeInTheDocument();
    expect(dayButton(/^Friday, January 1, 2027, today/)).toBeInTheDocument();
  });

  it('moves between days with the arrow keys, following into the next month', async () => {
    const user = userEvent.setup();
    installFakeBridge();
    render(<CalendarPage today="2026-10-31" backendReady />);

    dayButton(/^Saturday, October 31, 2026/).focus();
    await user.keyboard('{ArrowRight}');

    expect(title()).toHaveTextContent('November 2026');
    expect(panelDate()).toHaveTextContent('Sunday, November 1, 2026');
    expect(dayButton(/^Sunday, November 1, 2026/)).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(panelDate()).toHaveTextContent('Sunday, October 25, 2026');
    expect(title()).toHaveTextContent('October 2026');
  });
});

describe('CalendarPage selected day', () => {
  it('updates the selected-day panel when a day is clicked', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.calendar.getDay.mockImplementation(async (date: string) =>
      date === '2026-10-15' ? dayOf(date, ['Dentist', 'Groceries']) : dayOf(date, []),
    );
    render(<CalendarPage today="2026-10-04" backendReady />);
    // An empty day shows no Tasks section, only a way to add the first task.
    expect(await screen.findByRole('button', { name: '+ Task' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tasks' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No tasks planned/)).not.toBeInTheDocument();

    await user.click(dayButton(/^Thursday, October 15, 2026/));

    expect(panelDate()).toHaveTextContent('Thursday, October 15, 2026');
    const tasks = await screen.findByRole('list', { name: 'Tasks for this day' });
    expect(within(tasks).getByText('Dentist')).toBeInTheDocument();
    expect(within(tasks).getByText('Groceries')).toBeInTheDocument();
    expect(bridge.calendar.getDay).toHaveBeenLastCalledWith('2026-10-15');
  });

  it('ignores a late response for a day that is no longer selected', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    let finishSlowDay: (result: ApiResult<DayDetails>) => void = () => undefined;
    bridge.calendar.getDay.mockImplementation((date: string) =>
      date === '2026-10-15'
        ? new Promise<ApiResult<DayDetails>>((resolve) => (finishSlowDay = resolve))
        : Promise.resolve(dayOf(date, date === '2026-10-16' ? ['Friday task'] : [])),
    );
    render(<CalendarPage today="2026-10-04" backendReady />);

    await user.click(dayButton(/^Thursday, October 15, 2026/));
    await user.click(dayButton(/^Friday, October 16, 2026/));
    expect(await screen.findByText('Friday task')).toBeInTheDocument();

    finishSlowDay(dayOf('2026-10-15', ['Thursday task']));
    await Promise.resolve();

    expect(panelDate()).toHaveTextContent('Friday, October 16, 2026');
    expect(screen.getByText('Friday task')).toBeInTheDocument();
    expect(screen.queryByText('Thursday task')).not.toBeInTheDocument();
  });

  it('shows three items per month cell and opens the day from "+N more"', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const titles = ['One', 'Two', 'Three', 'Four', 'Five'];
    bridge.calendar.getRange.mockImplementation(rangeOf(titles.map((name) => item('2026-10-20', name))));
    bridge.calendar.getDay.mockImplementation(async (date: string) =>
      dayOf(date, date === '2026-10-20' ? titles : []),
    );
    render(<CalendarPage today="2026-10-04" backendReady />);

    const more = await screen.findByText('+2 more');
    const cell = dayButton(/^Tuesday, October 20, 2026, 5 items/).closest('[role="gridcell"]') as HTMLElement;
    expect(within(cell).getByText('Three')).toBeInTheDocument();
    expect(within(cell).queryByText('Four')).not.toBeInTheDocument();

    await user.click(more);

    expect(panelDate()).toHaveTextContent('Tuesday, October 20, 2026');
    const tasks = await screen.findByRole('list', { name: 'Tasks for this day' });
    expect(within(tasks).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getAllByRole('gridcell')).toHaveLength(42);
  });

  it('labels status and high priority with text, not only color', async () => {
    const { bridge } = installFakeBridge();
    bridge.calendar.getRange.mockImplementation(
      rangeOf([item('2026-10-06', 'Ship it', { status: 'DONE', priority: 'HIGH' })]),
    );
    render(<CalendarPage today="2026-10-04" backendReady />);

    const cell = (await screen.findByText('Ship it')).closest('[role="gridcell"]') as HTMLElement;
    expect(within(cell).getByRole('img', { name: 'Done' })).toBeInTheDocument();
    expect(within(cell).getByRole('img', { name: 'High priority' })).toBeInTheDocument();
  });

  it('summarises the week of the selected date with its date range', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.calendar.getRange.mockImplementation(
      rangeOf([
        item('2026-10-13', 'A', { status: 'DONE' }),
        item('2026-10-15', 'B'),
        item('2026-10-18', 'C'),
        item('2026-10-19', 'Next week'),
      ]),
    );
    bridge.progress.get.mockImplementation(async (query) => ({
      ok: true,
      data: progress({
        ...query,
        tasksCompleted: query.from === '2026-10-12' ? 2 : 0,
        pagesRead: query.from === '2026-10-12' ? 45 : 0,
        readingDays: query.from === '2026-10-12' ? 3 : 0,
      }),
    }));
    render(<CalendarPage today="2026-10-04" backendReady />);
    const summary = screen.getByRole('region', { name: 'Week summary' });
    expect(within(summary).getByText('Week of Sep 28 – Oct 4, 2026')).toBeInTheDocument();
    expect(await within(summary).findByText('No activity recorded')).toBeInTheDocument();

    await user.click(dayButton(/^Thursday, October 15, 2026/));

    expect(within(summary).getByText('Week of Oct 12 – Oct 18, 2026')).toBeInTheDocument();
    expect(await within(summary).findByText('3 tasks planned')).toBeInTheDocument();
    expect(within(summary).getByText('2 tasks completed')).toBeInTheDocument();
    expect(within(summary).getByText('45 pages read on 3 days')).toBeInTheDocument();
    expect(bridge.progress.get).toHaveBeenLastCalledWith({ from: '2026-10-12', to: '2026-10-19' });
  });

  it('shows a load failure as an error rather than an empty day', async () => {
    const { bridge } = installFakeBridge();
    bridge.calendar.getDay.mockResolvedValue({
      ok: false,
      error: { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });

    render(<CalendarPage today="2026-10-04" backendReady />);

    expect(await screen.findByText(/This day could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText('No tasks planned for this day.')).not.toBeInTheDocument();
  });
});

describe('CalendarPage adding tasks', () => {
  it('plans a new task on the selected date and refreshes the calendar', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.tasks.create.mockResolvedValue({ ok: true, data: task({ title: 'Book flights' }) });
    render(<CalendarPage today="2026-10-04" backendReady />);
    await user.click(dayButton(/^Thursday, October 15, 2026/));
    const readsBefore = bridge.calendar.getRange.mock.calls.length;

    await user.type(await openTaskForm(user), 'Book flights{Enter}');

    await waitFor(() => expect(screen.getByLabelText(/Add a task for this day/)).toHaveValue(''));
    expect(bridge.tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Book flights', plannedDate: '2026-10-15' }),
    );
    await waitFor(() => expect(bridge.calendar.getRange.mock.calls.length).toBeGreaterThan(readsBefore));
    expect(bridge.calendar.getDay).toHaveBeenLastCalledWith('2026-10-15');
  });

  it('keeps the typed title when saving fails', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.tasks.create.mockResolvedValue({
      ok: false,
      error: { status: 0, code: 'BACKEND_UNREACHABLE', message: 'The data service did not respond.' },
    });
    render(<CalendarPage today="2026-10-04" backendReady />);

    await user.type(await openTaskForm(user), 'Call the bank{Enter}');

    expect(await screen.findByText(/Not saved: The data service did not respond/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Add a task for this day/)).toHaveValue('Call the bank');
  });

  it('asks to save, discard, or cancel before leaving a day with an unsaved task', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.tasks.create.mockResolvedValue({ ok: true, data: task({ title: 'Draft' }) });
    render(<CalendarPage today="2026-10-04" backendReady />);
    const input = await openTaskForm(user);

    // Cancel: stay on the day and keep the draft.
    await user.type(input, 'Draft');
    await user.click(dayButton(/^Thursday, October 15, 2026/));
    const dialog = screen.getByRole('dialog', { name: 'Unsaved changes' });
    expect(panelDate()).toHaveTextContent('Sunday, October 4, 2026');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(panelDate()).toHaveTextContent('Sunday, October 4, 2026');
    expect(input).toHaveValue('Draft');

    // Today and arrow keys are guarded the same way.
    dayButton(/^Sunday, October 4, 2026/).focus();
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(panelDate()).toHaveTextContent('Sunday, October 4, 2026');

    // Save: the task is planned on the day it was typed for, then the day changes.
    await user.click(dayButton(/^Thursday, October 15, 2026/));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(panelDate()).toHaveTextContent('Thursday, October 15, 2026'));
    expect(bridge.tasks.create).toHaveBeenCalledTimes(1);
    expect(bridge.tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Draft', plannedDate: '2026-10-04' }),
    );
    // The new day starts with its task form closed and nothing carried over from the draft.
    expect(screen.queryByLabelText(/Add a task for this day/)).not.toBeInTheDocument();

    // Discard: the draft is dropped and the day changes without saving.
    await user.type(await openTaskForm(user), 'Second draft');
    await user.click(dayButton(/^Friday, October 16, 2026/));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }));
    expect(panelDate()).toHaveTextContent('Friday, October 16, 2026');
    expect(screen.queryByLabelText(/Add a task for this day/)).not.toBeInTheDocument();
    expect(bridge.tasks.create).toHaveBeenCalledTimes(1);
  });

  it('stays on the day and keeps the draft when saving from the dialog fails', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.tasks.create.mockResolvedValue({
      ok: false,
      error: { status: 0, code: 'BACKEND_UNREACHABLE', message: 'The data service did not respond.' },
    });
    render(<CalendarPage today="2026-10-04" backendReady />);

    await user.type(await openTaskForm(user), 'Fragile');
    await user.click(dayButton(/^Thursday, October 15, 2026/));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Not saved/)).toBeInTheDocument();
    expect(panelDate()).toHaveTextContent('Sunday, October 4, 2026');
    expect(screen.getByLabelText(/Add a task for this day/)).toHaveValue('Fragile');
  });
});
