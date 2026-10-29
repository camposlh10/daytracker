import css from './tokens.css?raw';
import { accessibilityProblems } from '../test/a11y';

// The browser-free rules cannot measure colour, so the theme tokens are checked
// directly against WCAG 2.2: 4.5:1 for text, 3:1 for large text and for the
// parts of controls and focus indicators that must be seen.

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match) {
    throw new Error(`Token --${name} not found`);
  }
  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(token(foreground)), luminance(token(background))].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const SURFACES = ['color-app-bg', 'color-sidebar', 'color-surface', 'color-elevated'];

describe('theme contrast', () => {
  it.each(SURFACES)('primary text on %s is at least 4.5:1', (surface) => {
    expect(contrast('color-text', surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SURFACES)('secondary text on %s is at least 4.5:1', (surface) => {
    expect(contrast('color-text-secondary', surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['color-past', 'color-surface', 'color-sidebar'])('past-day text on %s is at least 4.5:1', (surface) => {
    expect(contrast('color-text-past', surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['color-primary', 'color-primary-hover'])('button text on %s is at least 4.5:1', (background) => {
    expect(contrast('color-on-primary', background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['color-danger', 'color-success', 'color-warning', 'color-reading', 'color-event', 'color-primary-hover'])(
    'status colour %s as text is at least 4.5:1 on every surface',
    (colour) => {
      for (const surface of SURFACES) {
        expect(contrast(colour, surface), `${colour} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(SURFACES)('the primary blue (borders, accents, focus ring; never text) is at least 3:1 on %s', (surface) => {
    expect(contrast('color-primary', surface)).toBeGreaterThanOrEqual(3);
  });

  it('the focus ring blue is at least 3:1 against the app background it is drawn next to', () => {
    expect(contrast('color-primary', 'color-app-bg')).toBeGreaterThanOrEqual(3);
  });

  it.each(['color-app-bg', 'color-surface'])('control borders are at least 3:1 against %s', (surface) => {
    // A text field's edge is what shows where it is, so it needs 3:1 (WCAG 1.4.11).
    expect(contrast('color-border-strong', surface)).toBeGreaterThanOrEqual(3);
  });
});

describe('the accessibility checker', () => {
  it('actually reports problems, so a clean result means something', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<input type="text"><img src="x.png"><button></button>';
    document.body.append(host);

    const problems = await accessibilityProblems(host);

    expect(problems.length).toBeGreaterThanOrEqual(3);
    host.remove();
  });
});
