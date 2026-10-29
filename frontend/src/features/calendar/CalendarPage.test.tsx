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
import { calendarEvent, emptyDay, installFakeBridge, progress, task } from '../../test/fakeBridge';
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


const title = () => screen.getByRole('heading', { level: 1 });
const panelDate = () => within(screen.getByRole('complementary', { name: 'Selected day' })).getByRole('heading', { level: 2 });
const dayButton = (name: RegExp) => screen.getByRole('button', { name });
const selectedCells = () => screen.getAllByRole('gridcell', { selected: true });

/** Picks a view from the view menu, as a mouse user would. */
async function chooseView(user: ReturnType<typeof userEvent.setup>, name: 'Day' | 'Week' | 'Month') {
  await user.click(screen.getByRole('button', { name: /change the calendar view/ }));
  await user.click(screen.getByRole('menuitemradio', { name }));
}

type EventItem = Extract<CalendarItem, { type: 'EVENT' }>;

function eventItem(date: string, title: string, startsAt: string, endsAt: string, overrides: Partial<EventItem> = {}): CalendarItem {
  return { type: 'EVENT', id: crypto.randomUUID(), date, title, allDay: false, startsAt, endsAt, continued: false, overlapsAnother: false, ...overrides };
}

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

    await chooseView(user, 'Week');
    expect(title()).toHaveTextContent('Sep 28 – Oct 4, 2026');
    expect(screen.getAllByRole('gridcell')).toHaveLength(7);
    expect(selectedCells()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(title()).toHaveTextContent('Oct 5 – Oct 11, 2026');
    expect(panelDate()).toHaveTextContent('Sunday, October 4, 2026');

    await chooseView(user, 'Month');
    expect(title()).toHaveTextContent('October 2026');
    expect(within(selectedCells()[0]).getByRole('button', { name: /October 4, 2026/ })).toBeInTheDocument();
  });

  it('shows a week that spans two years', async () => {
    const user = userEvent.setup();
    installFakeBridge();
    render(<CalendarPage today="2027-01-01" backendReady />);

    await chooseView(user, 'Week');

    expect(title()).toHaveTextContent('Dec 28, 2026 – Jan 3, 2027');
    expect(dayButton(/^Thursday, December 31, 2026/)).toBeInTheDocument();
    expect(dayButton(/^Friday, January 1, 2027, today/)).toBeInTheDocument();
  });

  it('shows one day, and moving a day there selects it', async () => {
    const user = userEvent.setup();
    installFakeBridge();
    render(<CalendarPage today="2026-10-04" backendReady />);

    await chooseView(user, 'Day');
    expect(title()).toHaveTextContent('Sunday, October 4, 2026');
    expect(screen.getAllByRole('gridcell')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /change the calendar view/ })).toHaveTextContent('Day');

    await user.click(screen.getByRole('button', { name: 'Next day' }));
    expect(title()).toHaveTextContent('Monday, October 5, 2026');
    expect(panelDate()).toHaveTextContent('Monday, October 5, 2026');

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(title()).toHaveTextContent('Sunday, October 4, 2026');
  });

  it('marks the view in effect in the menu and closes it with Escape', async () => {
    const user = userEvent.setup();
    installFakeBridge();
    render(<CalendarPage today="2026-10-04" backendReady />);

    const menuButton = screen.getByRole('button', { name: /change the calendar view/ });
    await user.click(menuButton);
    expect(screen.getByRole('menuitemradio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Month' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitemradio', { name: 'Week' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(menuButton).toHaveFocus();
    expect(title()).toHaveTextContent('October 2026');
  });

  it('switches views and moves with single-key shortcuts, but not while typing', async () => {
    const user = userEvent.setup();
    installFakeBridge();
    render(<CalendarPage today="2026-10-04" backendReady />);

    await user.keyboard('w');
    expect(title()).toHaveTextContent('Sep 28 – Oct 4, 2026');
    await user.keyboard('n');
    expect(title()).toHaveTextContent('Oct 5 – Oct 11, 2026');
    await user.keyboard('t');
    expect(title()).toHaveTextContent('Sep 28 – Oct 4, 2026');
    await user.keyboard('d');
    expect(title()).toHaveTextContent('Sunday, October 4, 2026');
    await user.keyboard('p');
    expect(title()).toHaveTextContent('Saturday, October 3, 2026');

    // Letters typed into a field stay in the field.
    await user.click(screen.getByRole('button', { name: '+ Create' }));
    await user.click(screen.getByRole('menuitem', { name: 'Task' }));
    await user.type(within(screen.getByRole('dialog')).getByLabelText('Title'), 'm');
    expect(title()).toHaveTextContent('Saturday, October 3, 2026');
  });

  it('turns the shortcuts off while another page is shown', async () => {
    const user = userEvent.setup();
    installFakeBridge();
    render(<CalendarPage today="2026-10-04" backendReady active={false} />);

    await user.keyboard('w');
    expect(title()).toHaveTextContent('October 2026');
  });

  it('draws timed appointments at their hours and lists untimed items above them', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.calendar.getRange.mockImplementation(
      rangeOf([
        eventItem('2026-10-04', 'Dentist', '2026-10-04T09:00:00Z', '2026-10-04T10:30:00Z'),
        eventItem('2026-10-04', 'Call', '2026-10-04T09:30:00Z', '2026-10-04T10:00:00Z', { overlapsAnother: true }),
        eventItem('2026-10-04', 'Holiday', '2026-10-04T00:00:00Z', '2026-10-05T00:00:00Z', { allDay: true }),
        item('2026-10-04', 'Water plants'),
      ]),
    );
    render(<CalendarPage today="2026-10-04" backendReady />);

    await chooseView(user, 'Day');
    const hours = screen.getByTestId('time-grid');
    const dentist = await within(hours).findByRole('button', { name: /^Dentist, 9:00 AM – 10:30 AM/ });
    const call = within(hours).getByRole('button', { name: /^Call, 9:30 AM – 10:00 AM, overlaps another/ });
    expect(dentist.style.top).toBe(`${9 * 48}px`);
    expect(dentist.style.height).toBe(`${1.5 * 48 - 2}px`);
    // The two overlapping appointments share the width side by side.
    expect(dentist.style.width).toBe('calc(50% - 6px)');
    expect(call.style.left).toBe('calc(50% + 2px)');

    const day = screen.getByRole('gridcell');
    expect(within(day).getByText('Water plants')).toBeInTheDocument();
    expect(within(day).getByText('Holiday')).toBeInTheDocument();
    expect(within(hours).queryByText('Water plants')).not.toBeInTheDocument();
    expect(within(hours).queryByText('Holiday')).not.toBeInTheDocument();
  });

  it('starts a new appointment at the clicked half hour of a day', async () => {
    const user = userEvent.setup();
    installFakeBridge();
    render(<CalendarPage today="2026-10-04" backendReady />);
    await chooseView(user, 'Week');

    const tuesday = screen.getByTestId('time-grid').querySelector<HTMLElement>('[data-column="2026-09-29"]')!;
    tuesday.getBoundingClientRect = () => ({ top: 100, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
    // 14.6 hours down: the appointment starts at 14:30 and lasts an hour.
    await user.pointer({ keys: '[MouseLeft]', target: tuesday, coords: { clientY: 100 + 14.6 * 48 } });

    const dialog = await screen.findByRole('dialog', { name: 'New appointment' });
    expect(within(dialog).getByLabelText('Start date')).toHaveValue('2026-09-29');
    expect(within(dialog).getByLabelText('Start time')).toHaveValue('14:30');
    expect(within(dialog).getByLabelText('End time')).toHaveValue('15:30');
    expect(panelDate()).toHaveTextContent('Tuesday, September 29, 2026');
  });

  it('opens an appointment from the time grid', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const dentist = calendarEvent({ title: 'Dentist', startsAt: '2026-10-04T09:00:00Z', endsAt: '2026-10-04T10:00:00Z', localStart: '2026-10-04T09:00:00', localEnd: '2026-10-04T10:00:00' });
    bridge.calendar.getRange.mockImplementation(
      rangeOf([eventItem('2026-10-04', 'Dentist', dentist.startsAt!, dentist.endsAt!, { id: dentist.id })]),
    );
    bridge.events.list.mockResolvedValue({ ok: true, data: [dentist] });
    render(<CalendarPage today="2026-10-04" backendReady />);
    await chooseView(user, 'Day');

    await user.click(await within(screen.getByTestId('time-grid')).findByRole('button', { name: /^Dentist/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Edit appointment' });
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Dentist');
    expect(bridge.events.list).toHaveBeenCalledWith({ from: '2026-10-04', to: '2026-10-05' });
  });

  it('zooms the hours with Ctrl + plus and minus, remembers it, and resets with Ctrl + 0', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.calendar.getRange.mockImplementation(
      rangeOf([eventItem('2026-10-04', 'Dentist', '2026-10-04T09:00:00Z', '2026-10-04T10:00:00Z')]),
    );
    const { unmount } = render(<CalendarPage today="2026-10-04" backendReady />);
    await chooseView(user, 'Day');
    const dentist = () => within(screen.getByTestId('time-grid')).getByRole('button', { name: /^Dentist/ });
    expect((await within(screen.getByTestId('time-grid')).findByRole('button', { name: /^Dentist/ })).style.top).toBe('432px');

    await user.keyboard('{Control>}={/Control}');
    expect(dentist().style.top).toBe(`${9 * 64}px`);
    await user.keyboard('{Control>}={/Control}');
    expect(dentist().style.top).toBe(`${9 * 80}px`);
    await user.keyboard('{Control>}-{/Control}');
    expect(dentist().style.top).toBe(`${9 * 64}px`);

    // The buttons do the same, and the zoom is kept for next time.
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(dentist().style.top).toBe(`${9 * 40}px`);
    unmount();
    render(<CalendarPage today="2026-10-04" backendReady />);
    await chooseView(user, 'Day');
    expect((await within(screen.getByTestId('time-grid')).findByRole('button', { name: /^Dentist/ })).style.top).toBe(`${9 * 40}px`);

    await user.keyboard('{Control>}0{/Control}');
    expect(dentist().style.top).toBe('432px');
  });

  it('zooms out no further than the smallest size', async () => {
    const user = userEvent.setup();
    installFakeBridge();
    render(<CalendarPage today="2026-10-04" backendReady />);
    await chooseView(user, 'Day');

    for (let step = 0; step < 12; step += 1) {
      await user.keyboard('{Control>}-{/Control}');
    }
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
  });

  it('creates an appointment or a task from the Create menu', async () => {
    const user = userEvent.setup();
    installFakeBridge();
    render(<CalendarPage today="2026-10-04" backendReady />);

    await user.click(screen.getByRole('button', { name: '+ Create' }));
    await user.click(screen.getByRole('menuitem', { name: 'Appointment' }));
    const dialog = await screen.findByRole('dialog', { name: 'New appointment' });
    expect(within(dialog).getByLabelText('Start time')).toHaveValue('09:00');
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
    // An empty day has no Tasks section at all; tasks are added from the Create menu.
    expect(await screen.findByRole('heading', { name: 'Reading' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tasks' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Add a task for this day/)).not.toBeInTheDocument();
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
