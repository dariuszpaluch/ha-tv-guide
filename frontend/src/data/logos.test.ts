import { expect, test } from 'vitest';
import type { ChannelConfig, TvGuideConfig } from '../config';
import { channels } from '../test/fixtures';
import { channelEntries, guideIcons, logoOf } from './logos';

const tvn: ChannelConfig = { number: 5, name: 'TVN', epg_id: 'TVN' };
const polsat: ChannelConfig = { number: 3, name: 'Polsat', epg_id: 'Polsat', logo: '/local/polsat.png' };
const tvp: ChannelConfig = { number: 1, name: 'TVP 1' };

const config: TvGuideConfig = {
  type: 'custom:tv-guide',
  switch_action: { perform_action: 'script.go' },
  tv_day_starts_at: 5,
  height: '600px',
  sections: [{ channels: [tvp, polsat] }, { channels: [tvn] }],
};

test('guideIcons keeps only channels that have an icon', () => {
  expect(guideIcons(channels)).toEqual(new Map([['TVN', 'http://img.example/tvn.png']]));
});

test('logoOf prefers the config logo over the guide icon', () => {
  const icons = new Map([
    ['TVN', 'http://img.example/tvn.png'],
    ['Polsat', 'http://img.example/polsat.png'],
  ]);
  expect(logoOf(polsat, icons)).toBe('/local/polsat.png');
  expect(logoOf(tvn, icons)).toBe('http://img.example/tvn.png');
});

test('logoOf is undefined without a config logo, an epg_id or an icon', () => {
  expect(logoOf(tvp, new Map([['TVN', 'x']]))).toBeUndefined();
  expect(logoOf(tvn, new Map())).toBeUndefined();
});

test('channelEntries maps guide ids to the config channel and its logo', () => {
  const entries = channelEntries(config, new Map([['TVN', 'http://img.example/tvn.png']]));
  expect([...entries.keys()]).toEqual(['Polsat', 'TVN']);
  expect(entries.get('Polsat')).toEqual({ config: polsat, logo: '/local/polsat.png' });
  expect(entries.get('TVN')).toEqual({ config: tvn, logo: 'http://img.example/tvn.png' });
});

test('channelEntries keeps the first channel when a guide id is used twice', () => {
  const twice: TvGuideConfig = { ...config, sections: [{ channels: [tvn, { ...tvn, number: 105, name: 'TVN HD' }] }] };
  expect(channelEntries(twice, new Map()).get('TVN')?.config).toBe(tvn);
});
