import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { addDays, todayIso } from './lib/dates';
import { installFakeBridge, task } from './test/fakeBridge';

// Keyboard-only use of the main workflows: no pointer events anywhere in this file.

describe('keyboard-only use', () => {
  it('moves through the calendar with the arrow keys and adds a task to the chosen day', async () => {
    const { bridge } = installFakeBridge({ status: 'ready' });
    bridge.tasks.create.mockImplementation(async (input) => ({ ok: true, data: task({ ...input }) }));
    const user = userEvent.setup();
    render(<App />);
    const grid = await screen.findByRole('grid');
    const today = todayIso();

    // Into the grid by Tab, then to the next day.
    const tomorrow = addDays(today, 1);
    // The grid has one tab stop (the selected day); the arrow keys move within it.
    const stops = Array.from(grid.querySelectorAll<HTMLElement>('[data-date]')).filter((day) => day.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0].dataset.date).toBe(today);
    stops[0].focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(grid.querySelector(`[data-date="${tomorrow}"]`)).toHaveFocus());
    expect(grid.querySelector(`[data-date="${tomorrow}"]`)).toHaveAttribute('tabindex', '0');

    // Open the Create menu from the keyboard, choose Task, type, and save with Enter.
    screen.getByRole('button', { name: '+ Create' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Appointment' })).toHaveFocus());
    await user.keyboard('{ArrowDown}{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    expect(within(dialog).getByLabelText('Title')).toHaveFocus();
    await user.keyboard('Pay the bills');
    within(dialog).getByRole('button', { name: 'Save' }).focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(bridge.tasks.create).toHaveBeenCalledTimes(1));
    expect(bridge.tasks.create.mock.calls[0][0]).toMatchObject({ title: 'Pay the bills', plannedDate: tomorrow });
  });

  it('reaches every screen from the navigation with Tab and Enter', async () => {
    installFakeBridge({ status: 'ready' });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('grid');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const first = within(nav).getAllByRole('button')[0];
    first.focus();

    for (const name of ['Tasks', 'Reading', 'Progress', 'Music', 'Settings']) {
      await user.tab();
      expect(within(nav).getByRole('button', { name })).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(await screen.findByRole('heading', { level: 1, name })).toBeInTheDocument();
    }
  });

  it('opens a dialog, keeps Tab inside it, closes it with Escape, and puts focus back', async () => {
    installFakeBridge({ status: 'ready' });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('grid');
    screen.getByRole('button', { name: 'Tasks' }).focus();
    await user.keyboard('{Enter}');
    const opener = await screen.findByRole('button', { name: '+ New task' });
    opener.focus();

    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let presses = 0; presses < 25; presses += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let presses = 0; presses < 25; presses += 1) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('saves a settings change from the keyboard', async () => {
    const { bridge } = installFakeBridge({ status: 'ready' });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('grid');
    screen.getByRole('button', { name: 'Settings' }).focus();
    await user.keyboard('{Enter}');
    const name = await screen.findByLabelText('Display name');
    name.focus();

    await user.keyboard('Ana{Enter}');

    await waitFor(() => expect(bridge.settings.update).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Ana' })));
  });
});
