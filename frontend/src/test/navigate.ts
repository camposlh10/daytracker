import { screen } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';

type User = ReturnType<typeof userEvent.setup>;

/** Opens a screen from the title bar's ⋯ menu. */
export async function goTo(user: User, name: string): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Menu' }));
  await user.click(screen.getByRole('menuitemradio', { name }));
}

/** The screen the ⋯ menu marks as open; the menu is closed again afterwards. */
export async function currentScreen(user: User): Promise<string | null> {
  await user.click(screen.getByRole('button', { name: 'Menu' }));
  const checked = screen.getAllByRole('menuitemradio').find((item) => item.getAttribute('aria-checked') === 'true');
  await user.keyboard('{Escape}');
  return checked ? menuItemName(checked) : null;
}

/** A menu item's text without its check mark. */
export function menuItemName(item: HTMLElement): string {
  return (item.textContent ?? '').replace('✓', '').trim();
}
