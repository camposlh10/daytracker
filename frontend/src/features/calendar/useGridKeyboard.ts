import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { addDays, addMonths, startOfWeek, type IsoDate, type WeekStart } from '../../lib/dates';

/**
 * Arrow-key navigation between day buttons (elements with a data-date attribute)
 * inside a calendar grid. Arrows move by a day or a week, Home/End go to the ends
 * of the week, and Page Up/Down move by `pageStep`. Focus follows the selection.
 */
export function useGridKeyboard(
  container: RefObject<HTMLElement | null>,
  selected: IsoDate,
  weekStart: WeekStart,
  pageStep: 'month' | 'week',
  onSelect: (date: IsoDate) => boolean,
) {
  // The date whose button should receive focus once it is the rendered selection.
  const focusTarget = useRef<IsoDate | null>(null);

  useEffect(() => {
    if (focusTarget.current === selected) {
      focusTarget.current = null;
      container.current?.querySelector<HTMLElement>(`[data-date="${selected}"]`)?.focus();
    }
  });

  return (event: KeyboardEvent<HTMLElement>) => {
    const date = (event.target as HTMLElement).dataset?.date;
    if (!date || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const page = (direction: 1 | -1) =>
      pageStep === 'month' ? addMonths(date, direction) : addDays(date, 7 * direction);
    let next: IsoDate;
    switch (event.key) {
      case 'ArrowLeft':
        next = addDays(date, -1);
        break;
      case 'ArrowRight':
        next = addDays(date, 1);
        break;
      case 'ArrowUp':
        next = addDays(date, -7);
        break;
      case 'ArrowDown':
        next = addDays(date, 7);
        break;
      case 'Home':
        next = startOfWeek(date, weekStart);
        break;
      case 'End':
        next = addDays(startOfWeek(date, weekStart), 6);
        break;
      case 'PageUp':
        next = page(-1);
        break;
      case 'PageDown':
        next = page(1);
        break;
      default:
        return;
    }
    event.preventDefault();
    // Focus moves only if the selection was applied (it may wait on unsaved edits).
    focusTarget.current = onSelect(next) ? next : null;
  };
}
