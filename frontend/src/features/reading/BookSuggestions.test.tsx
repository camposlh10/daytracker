import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiResult, BookSuggestion } from '../../api/bridge';
import { book, installFakeBridge } from '../../test/fakeBridge';
import { BookDialog } from './BookDialog';

const HAIL_MARY: BookSuggestion = {
  title: 'Project Hail Mary',
  author: 'Andy Weir',
  publisher: null,
  firstPublishYear: 2021,
  totalPages: 496,
  coverSource: 'OPEN_LIBRARY',
  coverId: '11200092',
};
const SUMMARY: BookSuggestion = {
  title: 'Summary of Project Hail Mary',
  author: null,
  publisher: null,
  firstPublishYear: null,
  totalPages: null,
  coverSource: null,
  coverId: null,
};

function found(items: BookSuggestion[]): ApiResult<BookSuggestion[]> {
  return { ok: true, data: items };
}

function open(target: Parameters<typeof BookDialog>[0]['book'] = null) {
  const fake = installFakeBridge();
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<BookDialog book={target} backendReady onClose={onClose} onSaved={onSaved} />);
  return { ...fake, onClose, onSaved, user: userEvent.setup() };
}

describe('Book title suggestions', () => {
  it('suggests books after a pause in typing, with their details and covers', async () => {
    const { bridge, user } = open();
    bridge.books.suggest.mockResolvedValue(found([HAIL_MARY, SUMMARY]));

    await user.type(screen.getByRole('combobox', { name: 'Title' }), 'project hail');

    const list = await screen.findByRole('listbox', { name: 'Suggested books' });
    // One request for the whole word, not one per letter.
    expect(bridge.books.suggest).toHaveBeenCalledTimes(1);
    expect(bridge.books.suggest).toHaveBeenCalledWith('project hail', false);
    const options = within(list).getAllByRole('option');
    expect(options[0]).toHaveTextContent('Project Hail Mary');
    expect(options[0]).toHaveTextContent('Andy Weir · 2021 · about 496 pages');
    expect(options[0].querySelector('img')!.getAttribute('src')).toBe('dt-cover://candidate/11200092');
    expect(options[1].querySelector('img')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Title' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('fills the form from a clicked suggestion and adds its cover after saving', async () => {
    const { bridge, user, onClose } = open();
    bridge.books.suggest.mockResolvedValue(found([HAIL_MARY]));
    bridge.books.create.mockImplementation(async (input) => ({ ok: true, data: book({ id: input.id }) }));
    bridge.books.setCover.mockResolvedValue({ ok: true, data: book() });

    await user.type(screen.getByLabelText('Title'), 'hail mary');
    await user.click(await screen.findByRole('option', { name: /Project Hail Mary/ }));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Project Hail Mary');
    expect(screen.getByLabelText('Author')).toHaveValue('Andy Weir');
    expect(screen.getByLabelText('Total pages')).toHaveValue('496');
    expect(screen.getByLabelText('Use this cover from Open Library')).toBeChecked();
    // Picking does not start another search.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(bridge.books.suggest).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const createdId = bridge.books.create.mock.calls[0][0].id;
    expect(bridge.books.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Project Hail Mary', author: 'Andy Weir', totalPages: 496 }),
    );
    expect(bridge.books.setCover).toHaveBeenCalledWith(createdId, '11200092', 'OPEN_LIBRARY');
  });

  it('can be driven with the keyboard, and Escape closes only the list', async () => {
    const { bridge, user, onClose } = open();
    bridge.books.suggest.mockResolvedValue(found([SUMMARY, HAIL_MARY]));
    const title = screen.getByLabelText('Title');

    await user.type(title, 'project hail');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(title).toHaveAttribute('aria-activedescendant', 'book-suggestion-1');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');

    expect(title).toHaveValue('Project Hail Mary');
    expect(bridge.books.create).not.toHaveBeenCalled();

    await user.type(title, ' x');
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Add book' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves out the cover when unticked, or when the title is changed afterwards', async () => {
    const { bridge, user, onClose } = open();
    bridge.books.suggest.mockResolvedValue(found([HAIL_MARY]));
    bridge.books.create.mockImplementation(async (input) => ({ ok: true, data: book({ id: input.id }) }));

    await user.type(screen.getByLabelText('Title'), 'hail mary');
    await user.click(await screen.findByRole('option', { name: /Project Hail Mary/ }));
    await user.click(screen.getByLabelText('Use this cover from Open Library'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bridge.books.setCover).not.toHaveBeenCalled();
  });

  it('forgets the picked cover when the title is typed over', async () => {
    const { bridge, user } = open();
    bridge.books.suggest.mockResolvedValue(found([HAIL_MARY]));

    await user.type(screen.getByLabelText('Title'), 'hail mary');
    await user.click(await screen.findByRole('option', { name: /Project Hail Mary/ }));
    await user.type(screen.getByLabelText('Title'), ' (annotated)');

    expect(screen.queryByLabelText('Use this cover from Open Library')).not.toBeInTheDocument();
  });

  it('does not search for fewer than three letters, and explains when suggestions are unavailable', async () => {
    const { bridge, user } = open();
    bridge.books.suggest.mockResolvedValue({
      ok: false,
      error: { status: 502, code: 'COVER_SOURCE_UNAVAILABLE', message: 'Open Library could not be reached.' },
    });

    await user.type(screen.getByLabelText('Title'), 'du');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(bridge.books.suggest).not.toHaveBeenCalled();
    expect(screen.getByText(/Type 3 or more letters/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Title'), 'ne');
    expect(await screen.findByText(/Suggestions are unavailable right now/)).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows only the answer for the latest text', async () => {
    const { bridge, user } = open();
    let finishOld: (result: ApiResult<BookSuggestion[]>) => void = () => undefined;
    bridge.books.suggest
      .mockImplementationOnce(() => new Promise((resolve) => (finishOld = resolve)))
      .mockResolvedValue(found([HAIL_MARY]));

    await user.type(screen.getByLabelText('Title'), 'dune');
    await waitFor(() => expect(bridge.books.suggest).toHaveBeenCalledWith('dune', false));
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'hail mary');
    expect(await screen.findByRole('option', { name: /Project Hail Mary/ })).toBeInTheDocument();

    finishOld(found([{ ...SUMMARY, title: 'Dune' }]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('option', { name: /^D/ })).not.toBeInTheDocument();
  });

  it('narrows to tech books on request, shows the publisher, and remembers the choice', async () => {
    window.localStorage.clear();
    const { bridge, user } = open();
    const learningGo: BookSuggestion = {
      title: 'Learning Go',
      author: 'Jon Bodner',
      publisher: "O'Reilly",
      firstPublishYear: 2021,
      totalPages: 374,
      coverSource: 'OPEN_LIBRARY',
      coverId: '111',
    };
    bridge.books.suggest.mockImplementation(async (_query: string, techOnly?: boolean) =>
      found(techOnly ? [learningGo] : [{ ...SUMMARY, title: 'Never Let Me Go' }]),
    );

    await user.type(screen.getByLabelText('Title'), 'learning go');
    expect(await screen.findByRole('option', { name: /Never Let Me Go/ })).toBeInTheDocument();

    await user.click(screen.getByLabelText('Tech books only'));

    const option = await screen.findByRole('option', { name: /Learning Go/ });
    expect(option).toHaveTextContent("Jon Bodner · O'Reilly · 2021 · about 374 pages");
    expect(bridge.books.suggest).toHaveBeenLastCalledWith('learning go', true);
    expect(window.localStorage.getItem('daytracker.bookSuggestions.techOnly')).toBe('true');
  });

  it('starts with the remembered tech-books choice', async () => {
    window.localStorage.setItem('daytracker.bookSuggestions.techOnly', 'true');
    const { bridge, user } = open();
    bridge.books.suggest.mockResolvedValue(found([]));

    expect(screen.getByLabelText('Tech books only')).toBeChecked();
    await user.type(screen.getByLabelText('Title'), 'kubernetes');
    await waitFor(() => expect(bridge.books.suggest).toHaveBeenCalledWith('kubernetes', true));
    window.localStorage.clear();
  });

  it('offers a Google Books cover for a book Open Library has no cover for, without asking Google while typing', async () => {
    const { bridge, user, onClose } = open();
    const realWorld: BookSuggestion = {
      title: 'Real-World Software Development',
      author: 'Raoul-Gabriel Urma',
      publisher: "O'Reilly",
      firstPublishYear: 2019,
      totalPages: 289,
      coverSource: 'GOOGLE_BOOKS',
      coverId: '9781491967171',
    };
    bridge.books.suggest.mockResolvedValue(found([realWorld]));
    bridge.books.create.mockImplementation(async (input) => ({ ok: true, data: book({ id: input.id }) }));
    bridge.books.setCover.mockResolvedValue({ ok: true, data: book() });

    await user.type(screen.getByLabelText('Title'), 'real-world software');
    const option = await screen.findByRole('option', { name: /Real-World Software Development/ });
    expect(option.querySelector('img')).toBeNull();
    await user.click(option);

    const choice = screen.getByLabelText('Use this cover from Google Books');
    expect(choice.closest('label')!.querySelector('img')!.getAttribute('src')).toBe('dt-cover://google/9781491967171');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bridge.books.setCover).toHaveBeenCalledWith(
      bridge.books.create.mock.calls[0][0].id,
      '9781491967171',
      'GOOGLE_BOOKS',
    );
  });

  it('does not suggest anything when editing an existing book', async () => {
    const { bridge, user } = open(book({ title: 'Dune' }));

    await user.type(screen.getByLabelText('Title'), ' Messiah');
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(bridge.books.suggest).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Title')).not.toHaveAttribute('role');
  });
});
