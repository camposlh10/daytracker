import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { book, installFakeBridge } from '../../test/fakeBridge';
import { BookCover } from './BookCover';
import { CoverDialog } from './CoverDialog';
import { ReadingPage } from './ReadingPage';

const dune = book({ title: 'Dune', totalPages: 600, currentPage: 150 });
const withCover = { ...dune, coverUpdatedAt: '2026-10-17T12:00:00.000Z' };

describe('BookCover', () => {
  it('shows the stored cover with the reading position along its bottom edge', () => {
    installFakeBridge();
    render(<BookCover book={withCover} size="large" showProgress progressLabel="Position in Dune" />);

    const image = screen.getByTestId('book-cover').querySelector('img')!;
    expect(image.getAttribute('src')).toBe(`dt-cover://book/${dune.id}?v=2026-10-17T12%3A00%3A00.000Z`);
    const bar = screen.getByRole('progressbar', { name: 'Position in Dune' });
    expect(bar).toHaveAttribute('value', '150');
    expect(bar).toHaveAttribute('max', '600');
  });

  it('falls back to the typographic placeholder without a cover or when the image fails', () => {
    installFakeBridge();
    const { rerender } = render(<BookCover book={dune} size="medium" />);
    expect(screen.getByTestId('book-cover')).toHaveTextContent('D');
    expect(screen.getByTestId('book-cover').querySelector('img')).toBeNull();

    rerender(<BookCover book={withCover} size="medium" />);
    fireEvent.error(screen.getByTestId('book-cover').querySelector('img')!);
    expect(screen.getByTestId('book-cover')).toHaveTextContent('D');

    // A newer cover is tried again.
    rerender(<BookCover book={{ ...withCover, coverUpdatedAt: '2026-10-18T09:00:00.000Z' }} size="medium" />);
    expect(screen.getByTestId('book-cover').querySelector('img')).not.toBeNull();
  });
});

describe('CoverDialog', () => {
  function open(target = dune) {
    const fake = installFakeBridge();
    const onClose = vi.fn();
    const onChanged = vi.fn();
    render(<CoverDialog book={target} backendReady onClose={onClose} onChanged={onChanged} />);
    return { ...fake, onClose, onChanged, user: userEvent.setup() };
  }

  it('searches only when asked, shows previews, and sets the chosen cover', async () => {
    const { bridge, user, onClose, onChanged } = open();
    bridge.books.findCovers.mockResolvedValue({
      ok: true,
      data: [
        { source: 'OPEN_LIBRARY', sourceId: '111', title: 'Dune', author: 'Frank Herbert', firstPublishYear: 1965 },
        { source: 'GOOGLE_BOOKS', sourceId: '9781491967171', title: 'Dune Messiah', author: null, firstPublishYear: null },
      ],
    });
    bridge.books.setCover.mockResolvedValue({ ok: true, data: withCover });
    expect(bridge.books.findCovers).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Search Open Library' }));

    const found = await screen.findByRole('list', { name: 'Covers found' });
    const choices = within(found).getAllByRole('button');
    expect(choices).toHaveLength(2);
    expect(choices[0]).toHaveAccessibleName('Use the cover of Dune, Frank Herbert, 1965');
    expect(choices[0].querySelector('img')!.getAttribute('src')).toBe('dt-cover://candidate/111');
    // A cover found by ISBN on Google Books says where it comes from.
    expect(choices[1].querySelector('img')!.getAttribute('src')).toBe('dt-cover://google/9781491967171');
    expect(choices[1]).toHaveTextContent('Google Books');
    expect(choices[0]).not.toHaveTextContent('Google Books');
    await user.click(choices[0]);

    expect(bridge.books.setCover).toHaveBeenCalledWith(dune.id, '111', 'OPEN_LIBRARY');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
  });

  it('explains when Open Library cannot be reached and offers the file instead', async () => {
    const { bridge, user, onClose } = open();
    bridge.books.findCovers.mockResolvedValue({
      ok: false,
      error: {
        status: 502,
        code: 'COVER_SOURCE_UNAVAILABLE',
        message: 'Open Library could not be reached. Check the internet connection, or choose an image file.',
      },
    });

    await user.click(screen.getByRole('button', { name: 'Search Open Library' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Open Library could not be reached');
    expect(screen.getByRole('button', { name: 'Choose an image file…' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says so when nothing is found', async () => {
    const { bridge, user } = open();
    bridge.books.findCovers.mockResolvedValue({ ok: true, data: [] });

    await user.click(screen.getByRole('button', { name: 'Search Open Library' }));

    expect(await screen.findByText(/No covers were found/)).toBeInTheDocument();
  });

  it('uses an image file, and closing the file picker without choosing is not an error', async () => {
    const { bridge, user, onClose, onChanged } = open();
    bridge.books.chooseCoverFile
      .mockResolvedValueOnce({ ok: false, error: { status: 0, code: 'CANCELLED', message: 'No file was chosen.' } })
      .mockResolvedValueOnce({ ok: true, data: withCover });

    await user.click(screen.getByRole('button', { name: 'Choose an image file…' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Choose an image file…' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bridge.books.chooseCoverFile).toHaveBeenCalledWith(dune.id);
    expect(onChanged).toHaveBeenCalled();
  });

  it('removes a cover', async () => {
    const { bridge, user, onClose } = open(withCover);

    await user.click(screen.getByRole('button', { name: 'Remove cover' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bridge.books.removeCover).toHaveBeenCalledWith(dune.id);
  });

  it('opens from the Reading page', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.books.list.mockResolvedValue({ ok: true, data: [withCover] });
    render(<ReadingPage today="2026-10-17" backendReady />);

    await user.click(await screen.findByRole('button', { name: 'Cover of Dune' }));

    expect(screen.getByRole('dialog', { name: 'Cover: Dune' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove cover' })).toBeInTheDocument();
  });
});
