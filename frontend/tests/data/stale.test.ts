import { expect, test } from 'vitest';
import { NOW, WAW } from '../fixtures';
import { formatLastSuccess, isStale } from '../../src/data/stale';

const HOUR = 3600e3;
const info = (hoursAgo: number, interval = 12) => ({
  last_success: new Date(NOW - hoursAgo * HOUR).toISOString(),
  update_interval: interval,
});

test('a guide is stale after two update intervals', () => {
  expect(isStale(info(23.9), NOW)).toBe(false);
  expect(isStale(info(24), NOW)).toBe(false);
  expect(isStale(info(24.1), NOW)).toBe(true);
});

test('the limit follows the update interval', () => {
  expect(isStale(info(10, 4), NOW)).toBe(true);
  expect(isStale(info(10, 6), NOW)).toBe(false);
});

test('an unreadable date is not stale', () => {
  expect(isStale({ last_success: 'never', update_interval: 12 }, NOW)).toBe(false);
});

test('formatLastSuccess shows the day and the time in the card time zone', () => {
  const when = { last_success: '2026-10-17T12:30:00+02:00', update_interval: 12 };
  expect(formatLastSuccess(when, 'en-GB', WAW, false)).toBe('17 Oct, 12:30');
  expect(formatLastSuccess(when, 'en-GB', WAW, true)).toMatch(/^17 Oct, 12:30 pm$/i);
});
