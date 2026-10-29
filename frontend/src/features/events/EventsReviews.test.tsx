import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiResult, CalendarItem, DayDetails } from '../../api/bridge';
import { calendarEvent, dailyReview, emptyDay, installFakeBridge } from '../../test/fakeBridge';
import { CalendarPage } from '../calendar/CalendarPage';
import { EventDialog } from './EventDialog';

// Tests run with TZ=UTC, so this computer's timezone is UTC here.
const TODAY = '2026-10-04';

function dayWith(date: string, overrides: Partial<DayDetails>): ApiResult<DayDetails> {
  return { ok: true, data: { ...emptyDay(date), ...overrides } };
}

const panel = () => screen.getByRole('complementary', { name: 'Selected day' });
const panelDate = () => within(panel()).getByRole('heading', { level: 2 });
const dayButton = (name: RegExp) => screen.getByRole('button', { name });

describe('Appointments in the calendar', () => {
  it('shows an event that crosses midnight on both days, with its time first and a marker after', async () => {
    const { bridge } = installFakeBridge();
    const party: CalendarItem[] = [
      { type: 'EVENT', id: 'p', date: '2026-10-09', title: 'Party', allDay: false, startsAt: '2026-10-09T22:00:00Z', endsAt: '2026-10-10T02:00:00Z', continued: false, overlapsAnother: false },
      { type: 'EVENT', id: 'p', date: '2026-10-10', title: 'Party', allDay: false, startsAt: '2026-10-09T22:00:00Z', endsAt: '2026-10-10T02:00:00Z', continued: true, overlapsAnother: false },
    ];
    bridge.calendar.getRange.mockImplementation(async (query) => ({
      ok: true,
      data: { ...query, items: party.filter((item) => item.date >= query.from && item.date < query.to) },
    }));

    render(<CalendarPage today={TODAY} backendReady />);

    const friday = dayButton(/^Friday, October 9, 2026/).closest('[role="gridcell"]') as HTMLElement;
    const saturday = dayButton(/^Saturday, October 10, 2026/).closest('[role="gridcell"]') as HTMLElement;
    expect(await within(friday).findByText('Party')).toBeInTheDocument();
    expect(within(friday).getByLabelText('Starts at')).toHaveTextContent('10:00 PM');
    expect(within(saturday).getByText('Party')).toBeInTheDocument();
    expect(within(saturday).getByLabelText('Continues')).toHaveTextContent('↳');
  });

  it('lists the appointments of the selected day with their times and any overlap', async () => {
    const { bridge } = installFakeBridge();
    bridge.calendar.getDay.mockResolvedValue(
      dayWith(TODAY, {
        events: [
          calendarEvent({ title: 'Holiday', allDay: true, startsAt: null, endsAt: null, timezone: null, localStart: null, localEnd: null, startDate: '2026-10-04', endDateExclusive: '2026-10-05' }),
          calendarEvent({ title: 'Dentist', startsAt: '2026-10-04T09:00:00Z', endsAt: '2026-10-04T10:15:00Z', overlapsAnother: true }),
          calendarEvent({ title: 'Late show', startsAt: '2026-10-04T22:00:00Z', endsAt: '2026-10-05T01:00:00Z' }),
          calendarEvent({ title: 'Call Lisbon', timezone: 'Europe/Lisbon', startsAt: '2026-10-04T15:00:00Z', endsAt: '2026-10-04T15:30:00Z' }),
        ],
      }),
    );

    render(<CalendarPage today={TODAY} backendReady />);

    const items = within(await screen.findByRole('list', { name: 'Appointments for this day' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('HolidayAll day');
    expect(items[1]).toHaveTextContent('9:00 AM – 10:15 AM');
    expect(items[1]).toHaveTextContent('Overlaps another appointment');
    expect(items[2]).toHaveTextContent('Oct 4, 2026, 10:00 PM – Oct 5, 2026, 1:00 AM');
    expect(items[2]).not.toHaveTextContent('Overlaps');
    expect(items[3]).toHaveTextContent('3:00 PM – 3:30 PM (set in Europe/Lisbon)');
  });
});

describe('EventDialog', () => {
  function open(target: Parameters<typeof EventDialog>[0]['target']) {
    const fake = installFakeBridge();
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<EventDialog target={target} categories={[]} backendReady onClose={onClose} onSaved={onSaved} />);
    return { ...fake, onClose, onSaved, user: userEvent.setup() };
  }

  it('lasts an hour unless an end is set, without asking for a timezone', async () => {
    const { bridge, user, onClose } = open({ kind: 'create', date: '2026-10-09' });
    bridge.events.create.mockResolvedValue({ ok: true, data: calendarEvent() });

    expect(screen.queryByLabelText(/Timezone/)).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Set an end' })).not.toBeChecked();
    expect(screen.queryByLabelText('End time')).not.toBeInTheDocument();
    expect(screen.getByText('Otherwise it lasts an hour.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Title'), 'Late call');
    await user.clear(screen.getByLabelText('Start time'));
    await user.type(screen.getByLabelText('Start time'), '23:30');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The hour runs past midnight into the next day, in this computer's timezone.
    expect(bridge.events.create).toHaveBeenCalledWith(
      expect.objectContaining({ start: '2026-10-09T23:30', end: '2026-10-10T00:30', timezone: 'UTC' }),
    );
  });

  it('adds a description only when asked', async () => {
    const { bridge, user, onClose } = open({ kind: 'create', date: '2026-10-09' });
    bridge.events.create.mockResolvedValue({ ok: true, data: calendarEvent() });

    expect(screen.queryByLabelText('Description (optional)')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Title'), 'Dentist');
    await user.click(screen.getByRole('button', { name: '+ Add description' }));
    expect(screen.getByLabelText('Description (optional)')).toHaveFocus();
    await user.keyboard('Bring the forms');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bridge.events.create).toHaveBeenCalledWith(expect.objectContaining({ notes: 'Bring the forms' }));
  });

  it('creates a timed appointment across midnight with an end that is set', async () => {
    const { bridge, user, onClose } = open({ kind: 'create', date: '2026-10-09' });
    bridge.events.create.mockResolvedValue({ ok: true, data: calendarEvent() });

    await user.type(screen.getByLabelText('Title'), 'Party');
    await user.clear(screen.getByLabelText('Start time'));
    await user.type(screen.getByLabelText('Start time'), '22:00');
    await user.click(screen.getByRole('switch', { name: 'Set an end' }));
    // The end starts from the default hour.
    expect(screen.getByLabelText('End time')).toHaveValue('23:00');
    await user.clear(screen.getByLabelText('End date'));
    await user.type(screen.getByLabelText('End date'), '2026-10-10');
    await user.clear(screen.getByLabelText('End time'));
    await user.type(screen.getByLabelText('End time'), '02:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bridge.events.create).toHaveBeenCalledWith({
      id: expect.any(String),
      title: 'Party',
      notes: null,
      categoryId: null,
      allDay: false,
      start: '2026-10-09T22:00',
      end: '2026-10-10T02:00',
      timezone: 'UTC',
      repeat: null,
      repeatUntil: null,
      repeatDates: [],
      repeatWeekdays: [],
      links: [],
    });
  });

  it('refuses an appointment that ends before it starts, without sending it', async () => {
    const { bridge, user, onClose } = open({ kind: 'create', date: '2026-10-09' });

    await user.type(screen.getByLabelText('Title'), 'Backwards');
    await user.click(screen.getByRole('switch', { name: 'Set an end' }));
    await user.clear(screen.getByLabelText('End time'));
    await user.type(screen.getByLabelText('End time'), '08:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('The appointment must end after it starts.')).toBeInTheDocument();
    expect(bridge.events.create).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends an all-day appointment with an exclusive end date', async () => {
    const { bridge, user } = open({ kind: 'create', date: '2026-10-09' });
    bridge.events.create.mockResolvedValue({ ok: true, data: calendarEvent() });

    await user.type(screen.getByLabelText('Title'), 'Trip');
    await user.click(screen.getByLabelText('All day'));
    expect(screen.queryByLabelText('Start time')).not.toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Lasts more than one day' }));
    await user.clear(screen.getByLabelText('Last day'));
    await user.type(screen.getByLabelText('Last day'), '2026-10-11');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(bridge.events.create).toHaveBeenCalledWith(
        expect.objectContaining({ allDay: true, startDate: '2026-10-09', endDateExclusive: '2026-10-12' }),
      ),
    );
    const sent = bridge.events.create.mock.calls[0][0];
    expect(sent).not.toHaveProperty('start');
    expect(sent).not.toHaveProperty('timezone');
  });

  it('edits an appointment in its own timezone and with its loaded version', async () => {
    const lisbon = calendarEvent({
      title: 'Call Lisbon',
      timezone: 'Europe/Lisbon',
      localStart: '2026-10-09T16:00:00',
      localEnd: '2026-10-09T16:30:00',
      version: 3,
    });
    const { bridge, user } = open({ kind: 'edit', event: lisbon });
    bridge.events.update.mockResolvedValue({ ok: true, data: lisbon });

    expect(screen.getByLabelText('Start time')).toHaveValue('16:00');
    // Its half-hour end is not the default, so it is shown.
    expect(screen.getByRole('switch', { name: 'Set an end' })).toBeChecked();
    await user.clear(screen.getByLabelText('End time'));
    await user.type(screen.getByLabelText('End time'), '17:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(bridge.events.update).toHaveBeenCalledWith(
        lisbon.id,
        expect.objectContaining({ version: 3, start: '2026-10-09T16:00', end: '2026-10-09T17:00', timezone: 'Europe/Lisbon' }),
      ),
    );
  });

  it('shows an existing description, and keeps an hour-long appointment without an end', async () => {
    const { bridge, user } = open({
      kind: 'edit',
      event: calendarEvent({ notes: 'Room 4', localStart: '2026-10-09T09:00:00', localEnd: '2026-10-09T10:00:00', version: 2 }),
    });
    bridge.events.update.mockResolvedValue({ ok: true, data: calendarEvent() });

    expect(screen.getByLabelText('Description (optional)')).toHaveValue('Room 4');
    expect(screen.getByRole('switch', { name: 'Set an end' })).not.toBeChecked();
    // Turning the end on and off again is not a change.
    await user.click(screen.getByRole('switch', { name: 'Set an end' }));
    await user.click(screen.getByRole('switch', { name: 'Set an end' }));
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Start time'));
    await user.type(screen.getByLabelText('Start time'), '11:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bridge.events.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ start: '2026-10-09T11:00', end: '2026-10-09T12:00' }),
      ),
    );
  });

  it('shows the last day of an all-day appointment, not its exclusive end', () => {
    open({
      kind: 'edit',
      event: calendarEvent({ allDay: true, startsAt: null, endsAt: null, timezone: null, localStart: null, localEnd: null, startDate: '2026-10-09', endDateExclusive: '2026-10-12' }),
    });

    expect(screen.getByLabelText('All day')).toBeChecked();
    expect(screen.getByLabelText('First day')).toHaveValue('2026-10-09');
    expect(screen.getByLabelText('Last day')).toHaveValue('2026-10-11');
  });

  it('repeats every day, until a last day or without end', async () => {
    const { bridge, user, onClose } = open({ kind: 'create', date: '2026-10-09' });
    bridge.events.create.mockResolvedValue({ ok: true, data: calendarEvent() });

    await user.type(screen.getByLabelText('Title'), 'Stand-up');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'Every day');
    expect(screen.getByText('Leave empty to repeat every day.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Until (optional)'), '2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The last day cannot be before the first.');
    expect(bridge.events.create).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Until (optional)'));
    await user.type(screen.getByLabelText('Until (optional)'), '2026-10-31');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bridge.events.create).toHaveBeenCalledWith(
      expect.objectContaining({ start: '2026-10-09T09:00', repeat: 'DAILY', repeatUntil: '2026-10-31', repeatDates: [] }),
    );
  });

  it('repeats on chosen days of the week, starting with the start date\'s day', async () => {
    const { bridge, user, onClose } = open({ kind: 'create', date: '2026-10-09' });
    bridge.events.create.mockResolvedValue({ ok: true, data: calendarEvent() });

    await user.type(screen.getByLabelText('Title'), 'Gym');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'On days of the week');
    const days = screen.getByRole('group', { name: 'Days of the week' });
    // October 9, 2026 is a Friday; the week starts on Monday by default.
    expect(within(days).getAllByRole('button').map((day) => day.getAttribute('aria-label'))).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(within(days).getByRole('button', { name: 'Friday' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(days).getByRole('button', { name: 'Friday' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one day of the week.');

    await user.click(within(days).getByRole('button', { name: 'Wednesday' }));
    await user.click(within(days).getByRole('button', { name: 'Monday' }));
    await user.type(screen.getByLabelText('Until (optional)'), '2026-12-18');
    expect(screen.getByText('Leave empty to repeat every week.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bridge.events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        repeat: 'WEEKLY',
        repeatWeekdays: ['WEDNESDAY', 'MONDAY'],
        repeatUntil: '2026-12-18',
        repeatDates: [],
      }),
    );
  });

  it('repeats on dates chosen by pressing them, the first being the start', async () => {
    const { bridge, user, onClose } = open({ kind: 'create', date: '2026-10-09' });
    bridge.events.create.mockResolvedValue({ ok: true, data: calendarEvent() });

    await user.type(screen.getByLabelText('Title'), 'Physio');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'On dates I choose');
    expect(screen.queryByLabelText('Start date')).not.toBeInTheDocument();
    const picker = screen.getByRole('group', { name: 'Dates of the appointment' });
    // The form's date is chosen to begin with.
    expect(within(picker).getByRole('button', { name: 'Friday, October 9, 2026' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least two dates');

    await user.click(within(picker).getByRole('button', { name: 'Thursday, October 22, 2026' }));
    await user.click(within(picker).getByRole('button', { name: 'Monday, October 5, 2026' }));
    await user.click(within(picker).getByRole('button', { name: 'Next month' }));
    await user.click(within(picker).getByRole('button', { name: 'Tuesday, November 3, 2026' }));
    // Pressing a chosen date again drops it.
    await user.click(within(picker).getByRole('button', { name: 'Remove Thursday, October 22, 2026' }));
    expect(within(picker).getByRole('list', { name: 'Chosen dates' })).toHaveTextContent(/Oct 5.*Oct 9.*Nov 3/);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bridge.events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        start: '2026-10-05T09:00',
        end: '2026-10-05T10:00',
        repeat: 'DATES',
        repeatUntil: null,
        repeatDates: ['2026-10-05', '2026-10-09', '2026-11-03'],
      }),
    );
  });

  it('adds links, refusing anything that is not a web address', async () => {
    const { bridge, user, onClose } = open({ kind: 'create', date: '2026-10-09' });
    bridge.events.create.mockResolvedValue({ ok: true, data: calendarEvent() });

    await user.type(screen.getByLabelText('Title'), 'Call');
    expect(screen.queryByLabelText('Link 1')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Add link' }));
    expect(screen.getByLabelText('Link 1')).toHaveFocus();
    await user.keyboard('meet.example.com/abc');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Links must be web addresses that start with https:// or http://.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Link 1'));
    await user.type(screen.getByLabelText('Link 1'), 'https://meet.example.com/abc');
    await user.click(screen.getByRole('button', { name: '+ Add another link' }));
    await user.click(screen.getByRole('button', { name: '+ Add another link' }));
    await user.type(screen.getByLabelText('Link 3'), 'https://docs.example.org/agenda');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The empty row is left out.
    expect(bridge.events.create).toHaveBeenCalledWith(
      expect.objectContaining({ links: ['https://meet.example.com/abc', 'https://docs.example.org/agenda'] }),
    );
  });

  it('edits a repeating appointment as a whole, with its dates and links', () => {
    open({
      kind: 'edit',
      event: calendarEvent({
        localStart: '2026-10-06T14:00:00',
        localEnd: '2026-10-06T15:00:00',
        repeat: 'DATES',
        repeatUntil: '2026-10-20',
        repeatDates: ['2026-10-06', '2026-10-13', '2026-10-20'],
        links: ['https://clinic.example.com'],
      }),
    });

    expect(screen.getByText(/On 3 chosen dates\. Changes apply to every date it repeats on\./)).toBeInTheDocument();
    expect(screen.getByLabelText('Repeat')).toHaveValue('DATES');
    expect(screen.getByRole('list', { name: 'Chosen dates' })).toHaveTextContent(/Oct 6.*Oct 13.*Oct 20/);
    expect(screen.getByLabelText('Link 1')).toHaveValue('https://clinic.example.com');
  });

  it('deletes only after confirmation and treats an already deleted appointment as deleted', async () => {
    const dentist = calendarEvent({ title: 'Dentist', version: 2 });
    const { bridge, user, onClose, onSaved } = open({ kind: 'edit', event: dentist });
    bridge.events.delete.mockResolvedValue({
      ok: false,
      error: { status: 404, code: 'NOT_FOUND', message: 'Event not found.' },
    });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete this appointment?' });
    expect(bridge.events.delete).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Edit appointment' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bridge.events.delete).toHaveBeenCalledWith(dentist.id, 2);
    expect(onSaved).toHaveBeenCalled();
  });
});

/** Opens the daily review for the selected day from the Create menu. */
async function openReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '+ Create' }));
  await user.click(screen.getByRole('menuitem', { name: 'Daily review' }));
  return screen.findByRole('form', { name: 'Daily review' });
}

const closeReview = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));

describe('Daily review', () => {
  it('opens from the Create menu in a dialog, not in the day panel', async () => {
    const user = userEvent.setup();
    installFakeBridge();
    render(<CalendarPage today={TODAY} backendReady />);

    expect(await screen.findByRole('heading', { name: 'Reading' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Daily review' })).not.toBeInTheDocument();
    const review = await openReview(user);
    expect(screen.getByRole('dialog', { name: 'Daily review · Sunday, October 4, 2026' })).toContainElement(review);
    expect(within(review).getByText('Not written yet')).toBeInTheDocument();
    await closeReview(user);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Task' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Appointment' })).not.toBeInTheDocument();
    // A day without appointments has no Agenda section.
    expect(screen.queryByRole('heading', { name: 'Agenda' })).not.toBeInTheDocument();
  });

  it('saves the first review with no version and marks unsaved edits until then', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.reviews.save.mockResolvedValue({ ok: true, data: dailyReview({ wins: 'Shipped', version: 1 }) });
    render(<CalendarPage today={TODAY} backendReady />);
    const review = await openReview(user);
    expect(within(review).getByText('Not written yet')).toBeInTheDocument();
    expect(within(review).getByRole('button', { name: 'Save review' })).toBeDisabled();

    await user.type(within(review).getByLabelText('Wins'), 'Shipped');

    expect(within(review).getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(within(review).getByRole('button', { name: 'Save review' }));
    expect(bridge.reviews.save).toHaveBeenCalledWith(TODAY, {
      version: null,
      wins: 'Shipped',
      obstacles: '',
      tomorrowPriority: '',
    });
    await waitFor(() => expect(within(review).queryByText('Unsaved changes')).not.toBeInTheDocument());
    expect(within(review).getByLabelText('Wins')).toHaveValue('Shipped');
  });

  it('edits an existing review with its version', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const saved = dailyReview({ wins: 'Shipped', obstacles: 'Noise', version: 4 });
    bridge.calendar.getDay.mockResolvedValue(dayWith(TODAY, { review: saved }));
    bridge.reviews.save.mockResolvedValue({ ok: true, data: { ...saved, version: 5 } });
    render(<CalendarPage today={TODAY} backendReady />);
    await screen.findByRole('heading', { name: 'Reading' });
    const review = await openReview(user);
    await waitFor(() => expect(within(review).getByLabelText('Obstacles')).toHaveValue('Noise'));

    await user.type(within(review).getByLabelText("Tomorrow's priority"), 'Rest');
    await user.click(within(review).getByRole('button', { name: 'Save review' }));

    expect(bridge.reviews.save).toHaveBeenCalledWith(TODAY, {
      version: 4,
      wins: 'Shipped',
      obstacles: 'Noise',
      tomorrowPriority: 'Rest',
    });
  });

  it('asks before leaving the day with an unsaved review: cancel, discard, or save first', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.reviews.save.mockResolvedValue({ ok: true, data: dailyReview({ wins: 'Kept' }) });
    render(<CalendarPage today={TODAY} backendReady />);
    await user.type(within(await openReview(user)).getByLabelText('Wins'), 'Kept');
    // Closing the dialog keeps the text.
    await closeReview(user);

    // Cancel stays on the day with the text intact.
    await user.click(dayButton(/^Friday, October 2, 2026/));
    const dialog = screen.getByRole('dialog', { name: 'Unsaved changes' });
    expect(dialog).toHaveTextContent('daily review');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(panelDate()).toHaveTextContent('Sunday, October 4, 2026');
    expect(within(await openReview(user)).getByLabelText('Wins')).toHaveValue('Kept');
    await closeReview(user);

    // Save writes the review for the day it was typed on, then moves.
    await user.click(dayButton(/^Friday, October 2, 2026/));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(panelDate()).toHaveTextContent('Friday, October 2, 2026'));
    expect(bridge.reviews.save).toHaveBeenCalledWith(TODAY, expect.objectContaining({ wins: 'Kept' }));
    // The new day's review starts empty.
    expect(within(await openReview(user)).getByLabelText('Wins')).toHaveValue('');

    // Discard drops the text and moves without saving.
    await user.type(screen.getByLabelText('Obstacles'), 'Gone soon');
    await closeReview(user);
    await user.click(dayButton(/^Thursday, October 1, 2026/));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }));
    expect(panelDate()).toHaveTextContent('Thursday, October 1, 2026');
    expect(bridge.reviews.save).toHaveBeenCalledTimes(1);
  });

  it('stays on the day and keeps the text when saving fails, including a conflict', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.reviews.save.mockResolvedValue({
      ok: false,
      error: { status: 409, code: 'CONFLICT', message: 'The review was changed after it was loaded.' },
    });
    render(<CalendarPage today={TODAY} backendReady />);
    await user.type(within(await openReview(user)).getByLabelText('Wins'), 'Precious words');
    await closeReview(user);

    await user.click(dayButton(/^Friday, October 2, 2026/));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    // The review opens again, with why it was not saved.
    const review = await screen.findByRole('form', { name: 'Daily review' });
    expect(await within(review).findByRole('alert')).toHaveTextContent('changed elsewhere');
    expect(panelDate()).toHaveTextContent('Sunday, October 4, 2026');
    expect(within(review).getByLabelText('Wins')).toHaveValue('Precious words');
    expect(within(review).getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('cannot be written for a future day', async () => {
    const user = userEvent.setup();
    installFakeBridge();
    render(<CalendarPage today={TODAY} backendReady />);

    await user.click(dayButton(/^Monday, October 5, 2026/));

    // A future day has no review to write.
    await user.click(screen.getByRole('button', { name: '+ Create' }));
    await user.click(screen.getByRole('menuitem', { name: 'Daily review' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('A review can be written for today or an earlier day.');
    expect(screen.queryByRole('region', { name: 'Daily review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Wins' })).not.toBeInTheDocument();
  });

  it('asks before the window closes while a review is unsaved', async () => {
    const user = userEvent.setup();
    installFakeBridge();
    render(<CalendarPage today={TODAY} backendReady />);
    const review = await openReview(user);

    const clean = new Event('beforeunload', { cancelable: true });
    act(() => void window.dispatchEvent(clean));
    expect(clean.defaultPrevented).toBe(false);

    await user.type(within(review).getByLabelText('Wins'), 'Draft');
    const dirty = new Event('beforeunload', { cancelable: true });
    act(() => void window.dispatchEvent(dirty));
    expect(dirty.defaultPrevented).toBe(true);
  });
});
