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

  it('creates a timed appointment across midnight in the chosen timezone', async () => {
    const { bridge, user, onClose } = open({ kind: 'create', date: '2026-10-09' });
    bridge.events.create.mockResolvedValue({ ok: true, data: calendarEvent() });

    await user.type(screen.getByLabelText('Title'), 'Party');
    await user.clear(screen.getByLabelText('Start time'));
    await user.type(screen.getByLabelText('Start time'), '22:00');
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
    });
  });

  it('refuses an appointment that ends before it starts, without sending it', async () => {
    const { bridge, user, onClose } = open({ kind: 'create', date: '2026-10-09' });

    await user.type(screen.getByLabelText('Title'), 'Backwards');
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
    expect(screen.getByLabelText('Timezone of these times')).toHaveValue('Europe/Lisbon');
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

  it('shows the last day of an all-day appointment, not its exclusive end', () => {
    open({
      kind: 'edit',
      event: calendarEvent({ allDay: true, startsAt: null, endsAt: null, timezone: null, localStart: null, localEnd: null, startDate: '2026-10-09', endDateExclusive: '2026-10-12' }),
    });

    expect(screen.getByLabelText('All day')).toBeChecked();
    expect(screen.getByLabelText('First day')).toHaveValue('2026-10-09');
    expect(screen.getByLabelText('Last day')).toHaveValue('2026-10-11');
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

/** The review form is hidden until a review exists or "+ Review" is pressed. */
async function openReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '+ Review' }));
  return screen.getByRole('form', { name: 'Daily review' });
}

describe('Daily review', () => {
  it('is not shown on an empty day, only a button to start one', async () => {
    installFakeBridge();
    render(<CalendarPage today={TODAY} backendReady />);

    expect(await screen.findByRole('button', { name: '+ Review' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Daily review' })).not.toBeInTheDocument();
    expect(screen.queryByText('Not written yet')).not.toBeInTheDocument();
    // The same goes for the other empty sections.
    expect(screen.getByRole('button', { name: '+ Appointment' })).toBeInTheDocument();
    expect(screen.queryByText('No appointments.')).not.toBeInTheDocument();
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
    const review = await screen.findByRole('form', { name: 'Daily review' });
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
    const review = await openReview(user);
    await user.type(within(review).getByLabelText('Wins'), 'Kept');

    // Cancel stays on the day with the text intact.
    await user.click(dayButton(/^Friday, October 2, 2026/));
    const dialog = screen.getByRole('dialog', { name: 'Unsaved changes' });
    expect(dialog).toHaveTextContent('the daily review');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(panelDate()).toHaveTextContent('Sunday, October 4, 2026');
    expect(within(review).getByLabelText('Wins')).toHaveValue('Kept');

    // Save writes the review for the day it was typed on, then moves.
    await user.click(dayButton(/^Friday, October 2, 2026/));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(panelDate()).toHaveTextContent('Friday, October 2, 2026'));
    expect(bridge.reviews.save).toHaveBeenCalledWith(TODAY, expect.objectContaining({ wins: 'Kept' }));
    // The new day starts with no review form open.
    expect(screen.queryByRole('form', { name: 'Daily review' })).not.toBeInTheDocument();

    // Discard drops the text and moves without saving.
    await openReview(user);
    await user.type(screen.getByLabelText('Obstacles'), 'Gone soon');
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
    const review = await openReview(user);
    await user.type(within(review).getByLabelText('Wins'), 'Precious words');

    await user.click(dayButton(/^Friday, October 2, 2026/));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

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

    // A future day offers other additions, but no review.
    expect(await screen.findByRole('button', { name: '+ Task' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Review' })).not.toBeInTheDocument();
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
