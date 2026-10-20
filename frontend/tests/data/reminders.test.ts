import { expect, test } from 'vitest';
import { canRemind, REMINDER_LEAD_MS } from '../../src/data/reminders';
import { fakty, nocneKino, NOW, sport } from '../fixtures';

test('reminder lead time is exactly 5 minutes', () => {
  expect(REMINDER_LEAD_MS).toBe(5 * 60_000);
});

test('canRemind is false within 5 minutes of the start', () => {
  expect(canRemind(sport, NOW)).toBe(true);
  expect(canRemind(sport, Date.parse('2026-10-19T19:29:59+02:00'))).toBe(true);
  expect(canRemind(sport, Date.parse('2026-10-19T19:30:00+02:00'))).toBe(false);
  expect(canRemind(sport, Date.parse('2026-10-19T19:30:01+02:00'))).toBe(false);
  expect(canRemind(sport, Date.parse(sport.start))).toBe(false);
  expect(canRemind(fakty, NOW)).toBe(false);
});

test('canRemind uses the source offset when the clocks change', () => {
  expect(canRemind(nocneKino, Date.parse('2026-10-25T00:24:59Z'))).toBe(true);
  expect(canRemind(nocneKino, Date.parse('2026-10-25T00:25:00Z'))).toBe(false);
});
