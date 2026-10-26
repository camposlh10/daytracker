import axe from 'axe-core';

/**
 * Runs the axe accessibility rules on a rendered element and returns a readable
 * list of problems (empty when there are none). Rules that need real layout or
 * a whole page cannot run in jsdom: colour contrast is checked separately against
 * the theme tokens (see contrast.test.ts), and "region" only makes sense for a
 * complete document.
 */
export async function accessibilityProblems(element: Element): Promise<string[]> {
  const results = await axe.run(element, {
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: false },
    },
  });
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} — ${violation.nodes
        .slice(0, 3)
        .map((node) => node.html.slice(0, 120))
        .join(' | ')}`,
  );
}
