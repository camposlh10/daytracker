import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskListQuery } from '../../api/bridge';
import { category, installFakeBridge, page, task } from '../../test/fakeBridge';
import { TasksPage } from './TasksPage';

function lastQuery(bridge: ReturnType<typeof installFakeBridge>['bridge']): TaskListQuery {
  const calls = bridge.tasks.list.mock.calls as unknown as [TaskListQuery][];
  return calls[calls.length - 1][0];
}

describe('TasksPage', () => {
  it('lists tasks with their details and an honest empty state', async () => {
    const { bridge } = installFakeBridge();
    const work = category({ name: 'Work' });
    bridge.tasks.list.mockResolvedValue(
      page([
        task({ title: 'Prepare slides', categoryId: work.id, priority: 'HIGH', plannedDate: '2026-10-05', deadlineDate: '2026-10-09' }),
        task({ title: 'Someday', status: 'DONE', completedAt: '2026-10-04T12:00:00.000Z' }),
      ]),
    );

    const { unmount } = render(<TasksPage categories={[work]} backendReady />);

    const list = await screen.findByRole('list', { name: 'Tasks' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Work');
    expect(rows[0]).toHaveTextContent('Pending · High priority · Planned Oct 5, 2026 · Due Oct 9, 2026');
    expect(rows[1]).toHaveTextContent('Done · Medium priority · Unscheduled');
    expect(screen.getByText('1–2 of 2')).toBeInTheDocument();
    unmount();

    bridge.tasks.list.mockResolvedValue(page([]));
    render(<TasksPage categories={[]} backendReady />);
    expect(await screen.findByText('No tasks yet')).toBeInTheDocument();
  });

  it('turns the filters into a query', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const work = category({ name: 'Work' });
    render(<TasksPage categories={[work]} backendReady />);
    await screen.findByText('No tasks yet');
    expect(lastQuery(bridge)).toEqual({ page: 0, size: 50 });

    await user.selectOptions(screen.getByLabelText('Status'), 'IN_PROGRESS');
    await user.selectOptions(screen.getByLabelText('Priority'), 'HIGH');
    await user.selectOptions(screen.getByLabelText('Category'), work.id);
    await user.type(screen.getByLabelText('Planned on'), '2026-10-05');
    await user.type(screen.getByLabelText('Search'), 'slides');

    await waitFor(() =>
      expect(lastQuery(bridge)).toEqual({
        page: 0,
        size: 50,
        q: 'slides',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        categoryId: work.id,
        plannedFrom: '2026-10-05',
        plannedTo: '2026-10-06',
      }),
    );
    expect(await screen.findByText('No tasks match these filters')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(lastQuery(bridge)).toEqual({ page: 0, size: 50 }));
  });

  it('shows the unscheduled list and the archive, where a task can be restored', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const archived = task({ title: 'Old idea', archivedAt: '2026-10-01T10:00:00.000Z', version: 2 });
    render(<TasksPage categories={[]} backendReady />);
    await screen.findByText('No tasks yet');

    await user.selectOptions(screen.getByLabelText('Show'), 'unscheduled');
    await waitFor(() => expect(lastQuery(bridge)).toEqual({ page: 0, size: 50, scheduled: false }));

    bridge.tasks.list.mockResolvedValue(page([archived]));
    await user.selectOptions(screen.getByLabelText('Show'), 'archived');
    await waitFor(() => expect(lastQuery(bridge)).toEqual({ page: 0, size: 50, archived: true }));

    expect(await screen.findByRole('button', { name: 'Mark “Old idea” as done' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(bridge.tasks.update).toHaveBeenCalledWith(archived.id, { version: 2, archived: false });
  });

  it('completes a task from the list and reloads it', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const open = task({ title: 'Finish me', version: 7 });
    bridge.tasks.list.mockResolvedValue(page([open]));
    const onDataChanged = vi.fn();
    render(<TasksPage categories={[]} backendReady onDataChanged={onDataChanged} />);
    const readsBefore = (await screen.findByText('Finish me')) && bridge.tasks.list.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Mark “Finish me” as done' }));

    expect(bridge.tasks.update).toHaveBeenCalledWith(open.id, { version: 7, status: 'DONE' });
    await waitFor(() => expect(bridge.tasks.list.mock.calls.length).toBeGreaterThan(readsBefore));
    expect(onDataChanged).toHaveBeenCalled();
  });

  it('creates an unscheduled task from the page', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.tasks.create.mockResolvedValue({ ok: true, data: task({ title: 'Idea' }) });
    render(<TasksPage categories={[]} backendReady />);

    await user.click(screen.getByRole('button', { name: '+ New task' }));
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    await user.type(within(dialog).getByLabelText('Title'), 'Idea');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bridge.tasks.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Idea', plannedDate: null }));
  });

  it('adds, renames, and archives categories', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    const home = category({ name: 'Home', version: 3 });
    bridge.categories.create.mockResolvedValue({ ok: true, data: category({ name: 'Health' }) });
    bridge.categories.update.mockResolvedValue({ ok: true, data: home });
    const onDataChanged = vi.fn();
    render(<TasksPage categories={[home]} backendReady onDataChanged={onDataChanged} />);

    await user.click(screen.getByRole('button', { name: 'Categories' }));
    const dialog = screen.getByRole('dialog', { name: 'Categories' });
    await user.type(within(dialog).getByLabelText('New category'), 'Health');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(bridge.categories.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Health', color: '#668be8' }),
      ),
    );
    expect(onDataChanged).toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Name of Home'), ' and garden');
    await user.click(within(dialog).getByRole('button', { name: 'Save Home' }));
    await waitFor(() =>
      expect(bridge.categories.update).toHaveBeenCalledWith(home.id, { version: 3, name: 'Home and garden' }),
    );

    await user.click(within(dialog).getByRole('button', { name: 'Archive Home' }));
    await waitFor(() =>
      expect(bridge.categories.update).toHaveBeenLastCalledWith(home.id, { version: 3, archived: true }),
    );
  });

  it('shows a rejected category change without closing the dialog', async () => {
    const user = userEvent.setup();
    const { bridge } = installFakeBridge();
    bridge.categories.create.mockResolvedValue({
      ok: false,
      error: { status: 409, code: 'CONFLICT', message: 'A category with this name already exists.' },
    });
    render(<TasksPage categories={[]} backendReady />);

    await user.click(screen.getByRole('button', { name: 'Categories' }));
    await user.type(screen.getByLabelText('New category'), 'Work');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('A category with this name already exists.')).toBeInTheDocument();
    expect(screen.getByLabelText('New category')).toHaveValue('Work');
  });
});
