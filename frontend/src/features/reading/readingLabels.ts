import type { Book, BookStatus, ReadingSession } from '../../api/bridge';

export const BOOK_STATUS_LABELS: Record<BookStatus, string> = {
  TO_READ: 'To read',
  READING: 'Reading',
  FINISHED: 'Finished',
  ABANDONED: 'Abandoned',
};

export const BOOK_STATUSES: BookStatus[] = ['TO_READ', 'READING', 'FINISHED', 'ABANDONED'];

export function pages(count: number): string {
  return count === 1 ? '1 page' : `${count} pages`;
}

/** "Page 120 of 300 (40%)" */
export function positionLabel(book: Book): string {
  return `Page ${book.currentPage} of ${book.totalPages} (${Math.round((book.currentPage / book.totalPages) * 100)}%)`;
}

/** "20 pages, to page 140" */
export function sessionSummary(session: ReadingSession): string {
  return session.endingPage === null
    ? pages(session.pagesRead)
    : `${pages(session.pagesRead)}, to page ${session.endingPage}`;
}
