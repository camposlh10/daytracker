import { greetingAt } from './useGreeting';

describe('greetingAt', () => {
  it.each([
    [0, 'Good night'],
    [4 * 60 + 59, 'Good night'],
    [5 * 60, 'Good morning'],
    [11 * 60 + 59, 'Good morning'],
    [12 * 60, 'Good afternoon'],
    [17 * 60 + 59, 'Good afternoon'],
    [18 * 60, 'Good night'],
    [23 * 60 + 59, 'Good night'],
  ])('at minute %i of the day says %s', (minutes, greeting) => {
    expect(greetingAt(minutes)).toBe(greeting);
  });
});
