import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { accessibilityProblems } from './test/a11y';
import { book, category, emptyDay, installFakeBridge, page, task } from './test/fakeBridge';

/** Fills the fake backend with a little of everything, so every screen has content. */
function populated() {
  const fake = installFakeBridge({ status: 'ready' });
  const work = category({ name: 'Work' });
  const dune = book({ title: 'Dune', author: 'Frank Herbert', totalPages: 600, currentPage: 120, pagesReadTotal: 120 });
  const todo = task({ title: 'Write the report', plannedDate: '2026-10-04', categoryId: work.id, priority: 'HIGH' });
  fake.bridge.categories.list.mockResolvedValue({ ok: true, data: [work] });
  fake.bridge.books.list.mockResolvedValue({ ok: true, data: [dune] });
  fake.bridge.tasks.list.mockResolvedValue(page([todo, task({ title: 'Already done', status: 'DONE', completedAt: '2026-10-03T12:00:00Z' })]));
  fake.bridge.calendar.getDay.mockImplementation(async (date: string) => ({
    ok: true,
    data: { ...emptyDay(date), tasks: [todo], pagesRead: 20 },
  }));
  return fake;
}

async function expectAccessible() {
  expect(await accessibilityProblems(document.body)).toEqual([]);
}

describe('Accessibility (automated rules)', () => {
  it.each([
    ['Calendar', 'Calendar'],
    ['Tasks', 'Tasks'],
    ['Reading', 'Reading'],
    ['Progress', 'Progress'],
    ['Settings', 'Settings'],
  ])('the %s screen has no violations', async (_name, nav) => {
    populated();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('grid');
    await user.click(screen.getByRole('button', { name: nav }));
    await screen.findByRole('heading', { level: 1 });
    await new Promise((resolve) => setTimeout(resolve, 100));

    await expectAccessible();
  });

  it('the calendar with its add forms open has no violations', async () => {
    populated();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: '+ Appointment' }));
    await user.click(await screen.findByRole('button', { name: '+ Review' }));

    await expectAccessible();
  });

  it('the week view has no violations', async () => {
    populated();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /change the calendar view/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Week' }));

    await expectAccessible();
  });

  it('the day view and the open view menu have no violations', async () => {
    populated();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /change the calendar view/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Day' }));
    await user.click(screen.getByRole('button', { name: /change the calendar view/ }));
    await screen.findByRole('menu');

    await expectAccessible();
  });

  it.each([['Add book', 'Reading', '+ Add book'], ['Daily reading target', 'Settings', 'Change target']])(
    'the %s dialog has no violations',
    async (_name, nav, opener) => {
      populated();
      const user = userEvent.setup();
      render(<App />);
      await user.click(await screen.findByRole('button', { name: nav }));
      await user.click(await screen.findByRole('button', { name: opener }));
      await screen.findByRole('dialog');

      await expectAccessible();
    },
  );

  it('the task editor dialog has no violations', async () => {
    populated();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Tasks' }));
    await user.click(await screen.findByRole('button', { name: '+ New task' }));
    await screen.findByRole('dialog', { name: 'New task' });

    await expectAccessible();
  });

  it('the categories dialog has no violations', async () => {
    populated();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Tasks' }));
    await user.click(await screen.findByRole('button', { name: 'Categories' }));
    await screen.findByRole('dialog', { name: 'Categories' });

    await expectAccessible();
  });
});
