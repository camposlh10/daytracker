import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './Button';
import styles from './MenuButton.module.css';

export interface MenuOption<T extends string> {
  id: T;
  label: string;
  /** A single key that does the same thing outside the menu, shown beside the label. */
  shortcut?: string;
}

interface MenuButtonProps<T extends string> {
  /** Visible button content; the accessible name must start with it. */
  children: ReactNode;
  /** The accessible name, when it says more than the visible text. */
  label?: string;
  options: MenuOption<T>[];
  /** For a choice menu: the option that is in effect, shown with a check mark. */
  checked?: T;
  variant?: 'primary' | 'secondary';
  /** Which edge of the button the menu lines up with. */
  align?: 'start' | 'end';
  /** Styles the button itself, without the usual button look or the ▾ caret. */
  triggerClassName?: string;
  onSelect: (id: T) => void;
}

/**
 * A button that opens a short menu below it. Arrow keys move between options,
 * Enter or Space picks one, and Escape or Tab closes the menu.
 */
export function MenuButton<T extends string>({
  children,
  label,
  options,
  checked,
  variant = 'secondary',
  align = 'end',
  triggerClassName,
  onSelect,
}: MenuButtonProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (open) {
      items.current[active]?.focus();
    }
  }, [open, active]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  const show = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  const checkedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === checked),
  );

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) {
      button.current?.focus();
    }
  };

  const pick = (id: T) => {
    close(true);
    onSelect(id);
  };

  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      show(event.key === 'ArrowDown' ? checkedIndex : options.length - 1);
    }
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = options.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: active === last ? 0 : active + 1,
      ArrowUp: active === 0 ? last : active - 1,
      Home: 0,
      End: last,
    };
    if (event.key in moves) {
      event.preventDefault();
      setActive(moves[event.key]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // A shortcut letter picks its option directly, as it does outside the menu.
      const match = options.find((option) => option.shortcut?.toLowerCase() === event.key.toLowerCase());
      if (match) {
        event.preventDefault();
        event.stopPropagation();
        pick(match.id);
      }
    }
  };

  const triggerProps = {
    ref: button,
    'aria-label': label,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => (open ? close(false) : show(checkedIndex)),
    onKeyDown: onButtonKey,
  };

  return (
    <div ref={root} className={styles.root}>
      {triggerClassName ? (
        <button type="button" className={triggerClassName} {...triggerProps}>
          {children}
        </button>
      ) : (
        <Button variant={variant} className={styles.trigger} {...triggerProps}>
          {children}
          <span className={styles.caret} aria-hidden="true">
            ▾
          </span>
        </Button>
      )}
      {open && (
        <div
          id={menuId}
          role="menu"
          className={`${styles.menu} ${align === 'start' ? styles.start : ''}`}
          onKeyDown={onMenuKey}
        >
          {options.map((option, index) => (
            <button
              key={option.id}
              ref={(element) => {
                items.current[index] = element;
              }}
              type="button"
              role={checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={checked === undefined ? undefined : option.id === checked}
              aria-keyshortcuts={option.shortcut}
              tabIndex={index === active ? 0 : -1}
              className={styles.item}
              onClick={() => pick(option.id)}
              onPointerMove={() => setActive(index)}
            >
              <span className={styles.check} aria-hidden="true">
                {option.id === checked ? '✓' : ''}
              </span>
              <span className={styles.label}>{option.label}</span>
              {option.shortcut && (
                <kbd className={styles.shortcut} aria-hidden="true">
                  {option.shortcut}
                </kbd>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
