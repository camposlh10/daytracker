import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { category, installFakeBridge, task } from '../../test/fakeBridge';
import { TaskDialog } from './TaskDialog';

function setup(target: Parameters<typeof TaskDialog>[0]['target'], categories = [category()]) {
  const fake = installFakeBridge();
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<TaskDialog target={target} categories={categories} backendReady onClose={onClose} onSaved={onSaved} />);
  return { ...fake, onClose, onSaved, user: userEvent.setup() };
}

describe('TaskDialog', () => {
  it('sends only the fields that changed, with the version it loaded', async () => {
    const work = category({ name: 'Work' });
    const existing = task({
      title: 'Taxes',
      description: 'Receipts',
      plannedDate: '2026-10-10',
      deadlineDate: '2026-10-31',
      version: 4,
    });
    const { bridge, user, onClose, onSaved } = setup({ kind: 'edit', task: existing }, [work]);

    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'File taxes');
    await user.selectOptions(screen.getByLabelText('Category'), work.id);
    await user.selectOptions(screen.getByLabelText('Status'), 'IN_PROGRESS');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bridge.tasks.update).toHaveBeenCalledWith(existing.id, {
      version: 4,
      title: 'File taxes',
      categoryId: work.id,
      status: 'IN_PROGRESS',
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('clears the planned date with an explicit null and leaves the deadline alone', async () => {
    const existing = task({ plannedDate: '2026-10-10', deadlineDate: '2026-10-31' });
    const { bridge, user } = setup({ kind: 'edit', task: existing });

    await user.clear(screen.getByLabelText(/Planned date/));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(bridge.tasks.update).toHaveBeenCalledWith(existing.id, { version: 1, plannedDate: null }),
    );
  });

  it('closes without saving when nothing was changed', async () => {
    const { bridge, user, onClose, onSaved } = setup({ kind: 'edit', task: task() });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClose).toHaveBeenCalled();
    expect(bridge.tasks.update).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('requires a title before saving', async () => {
    const { bridge, user, onClose } = setup({ kind: 'create', plannedDate: null });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('A title is required.')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
    expect(bridge.tasks.create).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the form open with its input when saving fails', async () => {
    const { bridge, user, onClose } = setup({ kind: 'edit', task: task({ title: 'Original' }) });
    bridge.tasks.update.mockResolvedValue({
      ok: false,
      error: {
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'The request contains invalid fields.',
        fieldErrors: [{ field: 'title', message: 'The title is limited to 200 characters.' }],
      },
    });

    await user.type(screen.getByLabelText('Title'), ' and more');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findAllByText('The title is limited to 200 characters.')).not.toHaveLength(0);
    expect(screen.getByLabelText('Title')).toHaveValue('Original and more');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not overwrite a newer version: it offers to reload instead', async () => {
    const existing = task({ title: 'Mine', version: 2 });
    const { bridge, user, onClose } = setup({ kind: 'edit', task: existing });
    bridge.tasks.update.mockResolvedValue({
      ok: false,
      error: { status: 409, code: 'CONFLICT', message: 'The task was changed after it was loaded.' },
    });
    bridge.tasks.get.mockResolvedValue({ ok: true, data: { ...existing, title: 'Theirs', version: 3 } });

    await user.type(screen.getByLabelText('Title'), ' edit');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/your changes were not saved/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Mine edit');

    await user.click(screen.getByRole('button', { name: 'Reload latest' }));

    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Theirs'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // The next save uses the reloaded version.
    bridge.tasks.update.mockResolvedValue({ ok: true, data: { ...existing, version: 4 } });
    await user.type(screen.getByLabelText('Title'), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bridge.tasks.update).toHaveBeenLastCalledWith(existing.id, { version: 3, title: 'Theirs!' }),
    );
  });

  it('does not discard typed changes on Escape', async () => {
    const { user, onClose } = setup({ kind: 'edit', task: task({ title: 'Keep me' }) });

    await user.type(screen.getByLabelText('Title'), ' safe');
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Title')).toHaveValue('Keep me safe');

    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('archives and restores', async () => {
    const active = task({ version: 5 });
    const first = setup({ kind: 'edit', task: active });
    await first.user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() =>
      expect(first.bridge.tasks.update).toHaveBeenCalledWith(active.id, { version: 5, archived: true }),
    );
  });

  it('offers Restore for an archived task and keeps its archived category selectable', async () => {
    const old = category({ name: 'Old project', archivedAt: '2026-09-01T00:00:00.000Z' });
    const archived = task({ archivedAt: '2026-10-01T10:00:00.000Z', categoryId: old.id, version: 2 });
    const { bridge, user } = setup({ kind: 'edit', task: archived }, [old, category({ name: 'Current' })]);

    expect(screen.getByLabelText('Category')).toHaveValue(old.id);
    expect(screen.getByRole('option', { name: 'Old project (archived)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() =>
      expect(bridge.tasks.update).toHaveBeenCalledWith(archived.id, { version: 2, archived: false }),
    );
  });

  it('hides archived categories from a new task and shows the history of an existing one', async () => {
    const fake = installFakeBridge();
    fake.bridge.tasks.getActivity.mockResolvedValue({
      ok: true,
      data: [
        { action: 'CREATED', previousStatus: null, newStatus: 'PENDING', previousPlannedDate: null, newPlannedDate: null, occurredAt: '2026-10-01T10:00:00.000Z' },
        { action: 'RESCHEDULED', previousStatus: null, newStatus: null, previousPlannedDate: '2026-10-02', newPlannedDate: '2026-10-05', occurredAt: '2026-10-03T10:00:00.000Z' },
        { action: 'COMPLETED', previousStatus: 'PENDING', newStatus: 'DONE', previousPlannedDate: null, newPlannedDate: null, occurredAt: '2026-10-05T10:00:00.000Z' },
      ],
    });
    const categories = [category({ name: 'Gone', archivedAt: '2026-09-01T00:00:00.000Z' }), category({ name: 'Here' })];
    const { unmount } = render(
      <TaskDialog target={{ kind: 'create', plannedDate: null }} categories={categories} backendReady onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(screen.getByRole('option', { name: 'Here' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Gone/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
    unmount();

    render(
      <TaskDialog target={{ kind: 'edit', task: task() }} categories={categories} backendReady onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    const history = await screen.findByRole('region', { name: 'History' });
    const entries = await within(history).findAllByRole('listitem');
    expect(entries.map((entry) => entry.querySelector('span')?.textContent)).toEqual([
      'Created',
      'Planned date changed from Oct 2, 2026 to Oct 5, 2026',
      'Completed',
    ]);
  });
});
