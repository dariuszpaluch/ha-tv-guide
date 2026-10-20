import { expect, test } from 'vitest';
import type { ChannelConfig } from '../../src/config';
import { notSelected } from '../../src/data/selection';

const tvn: ChannelConfig = { number: 5, name: 'TVN', epg_id: 'TVN' };
const tvp: ChannelConfig = { number: 1, name: 'TVP 1 HD', epg_id: 'TVP 1' };
const local: ChannelConfig = { number: 9, name: 'Local' };
const kept = new Set(['TVN', 'Polsat']);

test('a channel whose guide id the integration does not keep is not selected', () => {
  expect(notSelected(tvp, kept)).toBe(true);
  expect(notSelected(tvn, kept)).toBe(false);
});

test('a channel without a guide id is never "not selected": it simply has no guide', () => {
  expect(notSelected(local, kept)).toBe(false);
});

test('before the channels of the integration are loaded, nothing is "not selected"', () => {
  expect(notSelected(tvp, undefined)).toBe(false);
});
