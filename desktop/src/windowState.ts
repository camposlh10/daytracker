import { screen, type BrowserWindow, type Rectangle } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Where the window opens: where the user last left it, or on first start about as
 * large as Spotify's desktop app opens (most of the screen, centred).
 */
export interface WindowPlacement {
  bounds: Partial<Rectangle> & { width: number; height: number };
  maximized: boolean;
}

// Spotify opens at roughly five sixths of the screen's width and nine tenths of its height.
const DEFAULT_WIDTH_SHARE = 0.835;
const DEFAULT_HEIGHT_SHARE = 0.87;

export function loadPlacement(file: string, minWidth: number, minHeight: number): WindowPlacement {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { bounds?: Rectangle; maximized?: unknown };
    const bounds = saved.bounds;
    if (
      bounds &&
      [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isInteger) &&
      bounds.width >= minWidth &&
      bounds.height >= minHeight &&
      isVisible(bounds)
    ) {
      return { bounds, maximized: saved.maximized === true };
    }
  } catch {
    // No saved placement yet, or an unreadable one: use the default.
  }
  const area = screen.getPrimaryDisplay().workArea;
  return {
    bounds: {
      width: Math.min(area.width, Math.max(minWidth, Math.round(area.width * DEFAULT_WIDTH_SHARE))),
      height: Math.min(area.height, Math.max(minHeight, Math.round(area.height * DEFAULT_HEIGHT_SHARE))),
    },
    maximized: false,
  };
}

/** Remembers the window's size and place when it closes. */
export function rememberPlacement(window: BrowserWindow, file: string): void {
  window.on('close', () => {
    try {
      writeFileSync(file, JSON.stringify({ bounds: window.getNormalBounds(), maximized: window.isMaximized() }));
    } catch {
      // Not worth bothering the user about; the next start uses the default.
    }
  });
}

/** True when enough of the window's title bar is on a screen to grab it. */
function isVisible(bounds: Rectangle): boolean {
  const titleBar = { x: bounds.x, y: bounds.y, width: bounds.width, height: 40 };
  return screen.getAllDisplays().some(({ workArea }) => {
    const width = Math.min(titleBar.x + titleBar.width, workArea.x + workArea.width) - Math.max(titleBar.x, workArea.x);
    const height = Math.min(titleBar.y + titleBar.height, workArea.y + workArea.height) - Math.max(titleBar.y, workArea.y);
    return width >= 100 && height >= 20;
  });
}
