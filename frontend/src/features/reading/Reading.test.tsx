import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiResult, DayDetails } from '../../api/bridge';
import { book, emptyDay, installFakeBridge, readingSession } from '../../test/fakeBridge';
import { CalendarPage } from '../calendar/CalendarPage';
import { ReadingPage } from './ReadingPage';
import { SessionDialog } from './SessionDialog';

const TODAY = '2026-10-04';

function dayWith(overrides: Partial<DayDetails>): ApiResult<DayDetails> {
  return { ok: true, data: { ...emptyDay(TODAY), ...overrides } };
}

describe('ReadingPage', () => {
  it('shows each book with its position, its effort, and a placeholder cover', async () => {
    const { bridge } = installFakeBridge();
    bridge.books.list.mockResolvedValue({
      ok: true,
      data: [
        book({ title: 'Dune', author: 'Frank Herbert', totalPages: 600, currentPage: 150, pagesReadTotal: 210 }),
        book({ title: 'Poems', author: null, status: 'TO_READ', totalPages: 80 }),
      ],
    });

    render(<ReadingPage today={TODAY} backendReady />);

    const cards = within(await screen.findByRole('list', { name: 'Books' })).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Frank Herbert · Reading');
    // Position and effort are separate numbers: 210 pages of effort, but on page 150.
    expect(cards[0]).toHaveTextContent('Page 150 of 600 (25%)');
    expect(cards[0]).toHaveTextContent('210 pages read in total');
    expect(within(cards[0]).getByRole('progressbar', { name: 'Position in Dune' })).toHaveAttribute('value', '150');
    expect(cards[1]).toHaveTextContent('To read');
    expect(cards[1]).toHaveTextContent('Page 0 of 80 (0%)');
  });

  it("shows today's pages against the target, capping the bar but not the number", async () => {
    const { bridge } = installFakeBridge();
    bridge.calendar.getDay.mockResolvedValue(
      dayWith({ pagesRead: 45, readingGoal: { targetPages: 30, effectiveDate: '2026-10-01' } }),
    );

    render(<ReadingPage today={TODAY} backendReady />);

    const todaySection = await screen.findByRole('region', { name: "Today's reading" });
    expect(await within(todaySection).findByText('45 of 30 pages today')).toBeInTheDocument();
    expect(within(todaySection).getByText(/150% of the daily target, set from Oct 1, 2026/)).toBeInTheDocument();
    const bar = within(todaySection).getByRole('progressbar');
    expect(bar).toHaveAttribute('value', '30');
    expect(bar).toHaveAttribute('max', '30');
  });

  it('starts empty with a useful message and no way to log reading without a book', async () => {
    installFakeBridge();

    render(<ReadingPage today={TODAY} backendReady />);

    expect(await screen.findByText('No books yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log reading' })).toBeDisabled();
    expect(await screen.findByText('0 of 30 pages today')).toBeInTheDocument();
    expect(screen.getByText(/the starting default/)).toBeInTheDocument();
  });

  it('adds a book after checking the page numbers', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.books.create.mockResolvedValue({ ok: true, data: book() });
    render(<ReadingPage today={TODAY} backendReady />);

    await user.click(screen.getByRole('button', { name: '+ Add book' }));
    const dialog = screen.getByRole('dialog', { name: 'Add book' });
    await user.type(within(dialog).getByLabelText('Title'), 'Middlemarch');
    await user.type(within(dialog).getByLabelText('Total pages'), '0');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter the number of pages, at least 1.')).toBeInTheDocument();
    expect(bridge.books.create).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText('Total pages'));
    await user.type(within(dialog).getByLabelText('Total pages'), '880');
    await user.clear(within(dialog).getByLabelText('Starting page'));
    await user.type(within(dialog).getByLabelText('Starting page'), '900');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('The starting page cannot be past the last page.')).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText('Starting page'));
    await user.type(within(dialog).getByLabelText('Starting page'), '40');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bridge.books.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Middlemarch', author: null, totalPages: 880, initialPage: 40, status: 'TO_READ' }),
    );
  });

  it('edits, finishes, and archives a book with its loaded version', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const dune = book({ title: 'Dune', version: 4 });
    bridge.books.list.mockResolvedValue({ ok: true, data: [dune] });
    bridge.books.update.mockResolvedValue({ ok: true, data: dune });
    render(<ReadingPage today={TODAY} backendReady />);

    await user.click(await screen.findByRole('button', { name: 'Edit Dune' }));
    await user.selectOptions(screen.getByLabelText('Status'), 'FINISHED');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bridge.books.update).toHaveBeenCalledWith(dune.id, { version: 4, status: 'FINISHED' }));

    await user.click(await screen.findByRole('button', { name: 'Edit Dune' }));
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(bridge.books.update).toHaveBeenLastCalledWith(dune.id, { version: 4, archived: true }));

    await user.selectOptions(screen.getByLabelText('Show'), 'archived');
    await waitFor(() => expect(bridge.books.list).toHaveBeenLastCalledWith(true));
  });

  it('keeps the form and explains when the total would cut off a recorded page', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const dune = book({ title: 'Dune', totalPages: 600 });
    bridge.books.list.mockResolvedValue({ ok: true, data: [dune] });
    bridge.books.update.mockResolvedValue({
      ok: false,
      error: {
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'The request contains invalid fields.',
        fieldErrors: [{ field: 'totalPages', message: 'A reading session already ends on page 350.' }],
      },
    });
    render(<ReadingPage today={TODAY} backendReady />);

    await user.click(await screen.findByRole('button', { name: 'Edit Dune' }));
    await user.clear(screen.getByLabelText('Total pages'));
    await user.type(screen.getByLabelText('Total pages'), '300');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findAllByText('A reading session already ends on page 350.')).not.toHaveLength(0);
    expect(screen.getByLabelText('Total pages')).toHaveValue('300');
  });

  it("lists a book's sessions and corrects or deletes one only after confirmation", async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const dune = book({ title: 'Dune', totalPages: 600 });
    const session = readingSession({
      bookId: dune.id,
      bookTitle: 'Dune',
      activityDate: '2026-10-02',
      pagesRead: 30,
      endingPage: 120,
      notes: 'On the train',
      version: 2,
    });
    bridge.books.list.mockResolvedValue({ ok: true, data: [dune] });
    bridge.readingSessions.list.mockResolvedValue({ ok: true, data: { items: [session], page: 0, size: 200, total: 1 } });
    bridge.readingSessions.update.mockResolvedValue({ ok: true, data: session });
    render(<ReadingPage today={TODAY} backendReady />);

    await user.click(await screen.findByRole('button', { name: 'Sessions of Dune' }));
    const list = await screen.findByRole('list', { name: 'Reading sessions' });
    expect(list).toHaveTextContent('Oct 2, 2026');
    expect(list).toHaveTextContent('30 pages, to page 120');
    expect(list).toHaveTextContent('On the train');
    expect(bridge.readingSessions.list).toHaveBeenCalledWith({ bookId: dune.id, size: 200 });

    // Correct the page count and move it to another day.
    await user.click(within(list).getByRole('button', { name: /^Edit session/ }));
    const editor = screen.getByRole('dialog', { name: 'Edit reading session' });
    await user.clear(within(editor).getByLabelText('Pages read'));
    await user.type(within(editor).getByLabelText('Pages read'), '45');
    await user.clear(within(editor).getByLabelText('Date'));
    await user.type(within(editor).getByLabelText('Date'), '2026-09-20');
    await user.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bridge.readingSessions.update).toHaveBeenCalledWith(session.id, {
        version: 2,
        activityDate: '2026-09-20',
        pagesRead: 45,
      }),
    );
    // Back at the session list.
    const again = await screen.findByRole('list', { name: 'Reading sessions' });

    await user.click(within(again).getByRole('button', { name: /^Delete session/ }));
    const confirm = screen.getByRole('dialog', { name: 'Delete this reading session?' });
    expect(bridge.readingSessions.delete).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(bridge.readingSessions.delete).not.toHaveBeenCalled();

    await user.click(within(await screen.findByRole('list', { name: 'Reading sessions' })).getByRole('button', { name: /^Delete session/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete this reading session?' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(bridge.readingSessions.delete).toHaveBeenCalledWith(session.id, 2));
  });

  it('changes the target from a chosen date and shows the history', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.readingGoals.list.mockResolvedValue({
      ok: true,
      data: [{ effectiveDate: '2026-09-01', targetPages: 25, updatedAt: '2026-09-01T10:00:00.000Z' }],
    });
    bridge.readingGoals.set.mockResolvedValue({
      ok: true,
      data: { effectiveDate: TODAY, targetPages: 40, updatedAt: '2026-10-04T10:00:00.000Z' },
    });
    render(<ReadingPage today={TODAY} backendReady />);

    await user.click(await screen.findByRole('button', { name: 'Change target' }));
    const dialog = screen.getByRole('dialog', { name: 'Daily reading target' });
    expect(within(dialog).getByLabelText('Pages per day')).toHaveValue('30');
    expect(within(dialog).getByLabelText('Starting from')).toHaveValue(TODAY);
    expect(within(dialog).getByText('25 pages a day from Sep 1, 2026')).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText('Pages per day'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('at least 1');
    expect(bridge.readingGoals.set).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Pages per day'), '40');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bridge.readingGoals.set).toHaveBeenCalledWith(TODAY, 40));
  });
});

describe('SessionDialog', () => {
  function open(books = [book({ title: 'Dune', totalPages: 600, currentPage: 150 })]) {
    const fake = installFakeBridge();
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <SessionDialog
        target={{ kind: 'create', date: '2026-10-03' }}
        books={books}
        today={TODAY}
        backendReady
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    return { ...fake, books, onClose, onSaved, user: userEvent.setup() };
  }

  it('records effort and position as separate values on the given date', async () => {
    const { bridge, books, user, onClose } = open();
    bridge.readingSessions.create.mockResolvedValue({ ok: true, data: readingSession() });

    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-03');
    expect(screen.getByLabelText(/Ended on page/)).toHaveAccessibleDescription('Now on page 150 of 600');
    await user.type(screen.getByLabelText('Pages read'), '40');
    await user.type(screen.getByLabelText(/Ended on page/), '120');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // A re-read: 40 pages of effort ending on page 120, behind the previous position of 150.
    expect(bridge.readingSessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: books[0].id,
        activityDate: '2026-10-03',
        pagesRead: 40,
        endingPage: 120,
        notes: null,
      }),
    );
  });

  it('leaves the position out when no ending page is given', async () => {
    const { bridge, user } = open();
    bridge.readingSessions.create.mockResolvedValue({ ok: true, data: readingSession() });

    await user.type(screen.getByLabelText('Pages read'), '12');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(bridge.readingSessions.create).toHaveBeenCalledWith(expect.objectContaining({ pagesRead: 12, endingPage: null })),
    );
  });

  it('rejects future dates, missing pages, and pages past the end before sending anything', async () => {
    const { bridge, user, onClose } = open();

    await user.clear(screen.getByLabelText('Date'));
    await user.type(screen.getByLabelText('Date'), '2026-10-05');
    await user.type(screen.getByLabelText(/Ended on page/), '601');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Reading cannot be recorded for a future date.')).toBeInTheDocument();
    expect(screen.getByText('Enter how many pages you read, at least 1.')).toBeInTheDocument();
    expect(screen.getByText('This book has 600 pages.')).toBeInTheDocument();
    expect(bridge.readingSessions.create).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the form when saving fails and reuses the id on retry so pages are not counted twice', async () => {
    const { bridge, user, onClose } = open();
    bridge.readingSessions.create.mockResolvedValue({
      ok: false,
      error: { status: 0, code: 'BACKEND_UNREACHABLE', message: 'The data service did not respond.' },
    });

    await user.type(screen.getByLabelText('Pages read'), '20');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The data service did not respond.')).toBeInTheDocument();
    expect(screen.getByLabelText('Pages read')).toHaveValue('20');
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bridge.readingSessions.create).toHaveBeenCalledTimes(2));
    const [first, second] = bridge.readingSessions.create.mock.calls.map(([input]) => input.id);
    expect(second).toBe(first);
  });

  it('suggests finishing the book when the last page is reached, and only marks it on request', async () => {
    const dune = book({ title: 'Dune', totalPages: 600, version: 7 });
    const { bridge, user, onClose } = open([dune]);
    bridge.readingSessions.create.mockResolvedValue({ ok: true, data: readingSession() });
    bridge.books.update.mockResolvedValue({ ok: true, data: { ...dune, status: 'FINISHED' } });

    await user.type(screen.getByLabelText('Pages read'), '25');
    await user.type(screen.getByLabelText(/Ended on page/), '600');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const prompt = await screen.findByRole('dialog', { name: 'Finished the book?' });
    expect(prompt).toHaveTextContent('Your reading was saved.');
    expect(bridge.books.update).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(prompt).getByRole('button', { name: 'Mark as finished' }));
    await waitFor(() => expect(bridge.books.update).toHaveBeenCalledWith(dune.id, { version: 7, status: 'FINISHED' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does not mark the book when the suggestion is declined', async () => {
    const { bridge, user, onClose } = open();
    bridge.readingSessions.create.mockResolvedValue({ ok: true, data: readingSession() });

    await user.type(screen.getByLabelText('Pages read'), '25');
    await user.type(screen.getByLabelText(/Ended on page/), '600');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(bridge.books.update).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Reading in the calendar', () => {
  it('shows reading on the calendar and in the selected day, with the day against its own target', async () => {
    const { bridge } = installFakeBridge();
    const session = readingSession({ bookTitle: 'Dune', pagesRead: 24, endingPage: 140 });
    bridge.books.list.mockResolvedValue({ ok: true, data: [book({ title: 'Dune' })] });
    bridge.calendar.getRange.mockImplementation(async (query) => ({
      ok: true,
      data: {
        ...query,
        items: [
          {
            type: 'READING',
            id: 'reading-2026-10-04-b1',
            date: TODAY,
            title: 'Dune',
            pagesRead: 24,
            bookId: 'b1',
            coverUpdatedAt: '2026-10-17T12:00:00.000Z',
          },
          {
            type: 'READING',
            id: 'reading-2026-10-04-b2',
            date: TODAY,
            title: 'Selected Essays',
            pagesRead: 14,
            bookId: 'b2',
            coverUpdatedAt: null,
          },
        ],
      },
    }));
    bridge.calendar.getDay.mockResolvedValue(
      dayWith({ readingSessions: [session], pagesRead: 24, readingGoal: { targetPages: 40, effectiveDate: '2026-10-01' } }),
    );

    render(<CalendarPage today={TODAY} backendReady />);

    // Each book read that day shows its own cover and name in the calendar cell.
    const cell = screen.getByRole('button', { name: /^Sunday, October 4, 2026/ }).closest('[role="gridcell"]') as HTMLElement;
    expect(await within(cell).findByText('Dune')).toBeInTheDocument();
    expect(cell.querySelector('img')!.getAttribute('src')).toBe('dt-cover://book/b1?v=2026-10-17T12%3A00%3A00.000Z');
    // A book without a cover shows the first letter of its title instead.
    expect(within(cell).getByText('Selected Essays')).toBeInTheDocument();
    expect(within(cell).getByText('S')).toBeInTheDocument();
    expect(within(cell).getByText(/24 pages read/)).toBeInTheDocument();
    expect(within(cell).getByText('Dune').closest('[title]')).toHaveAttribute('title', 'Dune: 24 pages read');
    const reading = screen.getByRole('region', { name: 'Reading' });
    const sessions = await within(reading).findByRole('list', { name: 'Reading sessions for this day' });
    expect(reading).toHaveTextContent('Read 24 / 40 pages');
    expect(sessions).toHaveTextContent('Dune');
    expect(sessions).toHaveTextContent('24 pages, to page 140');
    // Reading is not a task: it does not count as planned.
    const summary = screen.getByRole('region', { name: 'Week summary' });
    expect(within(summary).queryByText(/1 task planned/)).not.toBeInTheDocument();
  });

  it('logs reading on the selected day and reloads it', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const dune = book({ title: 'Dune' });
    bridge.books.list.mockResolvedValue({ ok: true, data: [dune] });
    bridge.readingSessions.create.mockResolvedValue({ ok: true, data: readingSession() });
    render(<CalendarPage today={TODAY} backendReady />);
    await user.click(screen.getByRole('button', { name: /^Thursday, October 1, 2026/ }));

    await user.click(await screen.findByRole('button', { name: 'Log reading' }));
    const dialog = screen.getByRole('dialog', { name: 'Log reading' });
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-10-01');
    await user.type(within(dialog).getByLabelText('Pages read'), '18');
    const readsBefore = bridge.calendar.getDay.mock.calls.length;
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bridge.readingSessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: dune.id, activityDate: '2026-10-01', pagesRead: 18 }),
    );
    await waitFor(() => expect(bridge.calendar.getDay.mock.calls.length).toBeGreaterThan(readsBefore));
  });

  it('shows the book being read, and moves between several like a carousel', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const dune = book({ title: 'Dune', author: 'Frank Herbert', totalPages: 600, currentPage: 150 });
    const emma = book({ title: 'Emma', author: 'Jane Austen', totalPages: 400, currentPage: 40 });
    const done = book({ title: 'Finished one', status: 'FINISHED' });
    const shelved = book({ title: 'Shelved', archivedAt: '2026-10-02T10:00:00.000Z' });
    bridge.books.list.mockResolvedValue({ ok: true, data: [done, dune, shelved, emma] });
    bridge.readingSessions.create.mockResolvedValue({ ok: true, data: readingSession() });
    render(<CalendarPage today={TODAY} backendReady />);

    const carousel = await screen.findByRole('region', { name: 'Currently reading' });
    await within(carousel).findByText('Dune');
    expect(carousel).toHaveTextContent('Frank Herbert');
    expect(carousel).toHaveTextContent('150 of 600 pages');
    expect(within(carousel).getByTestId('book-cover')).toBeInTheDocument();
    expect(within(carousel).getByRole('group', { name: '1 of 2' })).toBeInTheDocument();

    await user.click(within(carousel).getByRole('button', { name: 'Next book' }));
    expect(carousel).toHaveTextContent('Emma');
    expect(carousel).toHaveTextContent('Jane Austen');
    expect(carousel).not.toHaveTextContent('Dune');
    // It wraps around, and the arrow keys move too.
    await user.click(within(carousel).getByRole('button', { name: 'Next book' }));
    expect(carousel).toHaveTextContent('Dune');
    within(carousel).getByRole('button', { name: 'Previous book' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(carousel).toHaveTextContent('Emma');
    expect(carousel).not.toHaveTextContent(/Finished one|Shelved/);

    // Choosing another day keeps the book on show.
    await user.click(screen.getByRole('button', { name: /^Saturday, October 3, 2026/ }));
    await user.click(screen.getByRole('button', { name: /^Sunday, October 4, 2026/ }));
    expect(await screen.findByRole('region', { name: 'Currently reading' })).toHaveTextContent('Emma');

    // Logging reading starts with the book on show.
    await user.click(screen.getByRole('button', { name: 'Log reading' }));
    await user.type(within(screen.getByRole('dialog', { name: 'Log reading' })).getByLabelText('Pages read'), '5');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bridge.readingSessions.create).toHaveBeenCalledWith(expect.objectContaining({ bookId: emma.id })),
    );
  });

  it('shows one book without arrows, and says when none is being read', async () => {
    const { bridge } = installFakeBridge();
    bridge.books.list.mockResolvedValue({ ok: true, data: [book({ title: 'Dune' })] });
    const { unmount } = render(<CalendarPage today={TODAY} backendReady />);
    const carousel = await screen.findByRole('region', { name: 'Currently reading' });
    await within(carousel).findByText('Dune');
    expect(within(carousel).queryByRole('button')).not.toBeInTheDocument();
    unmount();

    bridge.books.list.mockResolvedValue({ ok: true, data: [book({ title: 'Done', status: 'FINISHED' })] });
    render(<CalendarPage today={TODAY} backendReady />);
    expect(await screen.findByText('Not reading a book right now.')).toBeInTheDocument();
  });

  it('does not offer to log reading for a future day or without a book', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    render(<CalendarPage today={TODAY} backendReady />);

    expect(await screen.findByText('Add a book on the Reading page first.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log reading' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Currently reading' })).not.toBeInTheDocument();

    bridge.books.list.mockResolvedValue({ ok: true, data: [book()] });
    await user.click(screen.getByRole('button', { name: /^Thursday, October 15, 2026/ }));
    expect(await screen.findByText('Reading cannot be logged for a future date.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log reading' })).not.toBeInTheDocument();
  });

  it('deletes a session from the selected day after confirmation', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const session = readingSession({ bookTitle: 'Dune', pagesRead: 24, version: 3 });
    bridge.calendar.getDay.mockResolvedValue(dayWith({ readingSessions: [session], pagesRead: 24 }));
    render(<CalendarPage today={TODAY} backendReady />);

    await user.click(await screen.findByRole('button', { name: 'Delete reading of Dune, 24 pages' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete this reading session?' });
    expect(confirm).toHaveTextContent('24 pages of “Dune” will be removed');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(bridge.readingSessions.delete).toHaveBeenCalledWith(session.id, 3));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
