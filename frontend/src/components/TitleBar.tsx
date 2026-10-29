import type { ReactNode } from 'react';
import { MenuButton, type MenuOption } from './MenuButton';
import styles from './TitleBar.module.css';

interface TitleBarProps<T extends string> {
  /** Only the draggable bar, for the start-up screens. */
  minimal?: boolean;
  /** Every screen, for the ⋯ menu, and the one that is open. */
  screens?: MenuOption<T>[];
  current?: T;
  onNavigate?: (screen: T) => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onBack?: () => void;
  onForward?: () => void;
  displayName?: string | null;
  onProfile?: () => void;
}

const icon = (children: ReactNode, size = 18) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

/**
 * The window's own title bar, like Spotify's: a ⋯ menu with every screen, back and
 * forward on the left, the profile on the right. Windows draws the minimise,
 * maximise and close buttons over its right end; the rest of the bar moves the window.
 */
export function TitleBar<T extends string>({
  minimal = false,
  screens = [],
  current,
  onNavigate,
  canGoBack = false,
  canGoForward = false,
  onBack,
  onForward,
  displayName,
  onProfile,
}: TitleBarProps<T>) {
  if (minimal) {
    return (
      <header className={styles.bar}>
        <span className={styles.brand}>Day Tracker</span>
      </header>
    );
  }

  const initial = displayName?.trim().charAt(0).toUpperCase() || '?';

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <MenuButton
          label="Menu"
          options={screens}
          checked={current}
          align="start"
          triggerClassName={styles.more}
          onSelect={(screen) => onNavigate?.(screen)}
        >
          {icon(
            <>
              <circle cx="5" cy="12" r="1.6" fill="currentColor" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" />
              <circle cx="19" cy="12" r="1.6" fill="currentColor" />
            </>,
            22,
          )}
        </MenuButton>
        <button
          type="button"
          className={styles.arrow}
          aria-label="Back"
          aria-keyshortcuts="Alt+ArrowLeft"
          title="Back"
          disabled={!canGoBack}
          onClick={onBack}
        >
          {icon(<path d="M15 18l-6-6 6-6" />)}
        </button>
        <button
          type="button"
          className={styles.arrow}
          aria-label="Forward"
          aria-keyshortcuts="Alt+ArrowRight"
          title="Forward"
          disabled={!canGoForward}
          onClick={onForward}
        >
          {icon(<path d="M9 18l6-6-6-6" />)}
        </button>
      </div>

      <div className={styles.right}>
        <button
          type="button"
          className={styles.avatar}
          aria-label={`Profile and settings${displayName ? ` for ${displayName}` : ''}`}
          title="Settings"
          onClick={onProfile}
        >
          <span aria-hidden="true">{initial}</span>
        </button>
      </div>
    </header>
  );
}
