import { translator } from '../i18n';
import type { Channel, Programme } from '../types/api';

/** The moment of all card tests: Monday 2026-10-19, 19:20 in Warsaw. */
export const NOW = Date.parse('2026-10-19T19:20:00+02:00');
export const WAW = 'Europe/Warsaw';

export const tEn = translator('en');
export const tPl = translator('pl');

/** Programme with the empty defaults of the contract; each fixture sets what it needs. */
const programme = (fields: Pick<Programme, 'id' | 'channel_id' | 'start' | 'stop' | 'title'> & Partial<Programme>): Programme => ({
  subtitle: null,
  description: null,
  episode: null,
  categories: [],
  image: null,
  rating: null,
  star_rating: null,
  year: null,
  countries: [],
  ...fields,
});

export const fakty = programme({
  id: 'TVN|2026-10-19T17:00:00Z',
  channel_id: 'TVN',
  start: '2026-10-19T19:00:00+02:00',
  stop: '2026-10-19T19:35:00+02:00',
  title: 'Fakty',
  episode: 'E519',
  categories: ['program informacyjny'],
  // First 32 hex characters of the SHA-256 of https://img.example/fakty.jpg, as the integration computes them.
  image: '/api/tv_guide/image/dd9cb3588d14fe04dce5c03b91b74312',
  rating: '12',
});

export const sport = programme({
  id: 'TVN|2026-10-19T17:35:00Z',
  channel_id: 'TVN',
  start: '2026-10-19T19:35:00+02:00',
  stop: '2026-10-19T19:45:00+02:00',
  title: 'Sport',
});

export const faktyTomorrow = programme({
  id: 'TVN|2026-10-20T17:00:00Z',
  channel_id: 'TVN',
  start: '2026-10-20T19:00:00+02:00',
  stop: '2026-10-20T19:35:00+02:00',
  title: 'Fakty',
});

export const uwagaTomorrow = programme({
  id: 'TVN|2026-10-20T17:55:00Z',
  channel_id: 'TVN',
  start: '2026-10-20T19:55:00+02:00',
  stop: '2026-10-20T20:15:00+02:00',
  title: 'Uwaga',
});

export const faktyDay3 = programme({
  id: 'TVN|2026-10-21T17:00:00Z',
  channel_id: 'TVN',
  start: '2026-10-21T19:00:00+02:00',
  stop: '2026-10-21T19:35:00+02:00',
  title: 'Fakty',
});

export const zycie = programme({
  id: 'Polsat|2026-10-19T17:15:00Z',
  channel_id: 'Polsat',
  start: '2026-10-19T19:15:00+02:00',
  stop: '2026-10-19T20:00:00+02:00',
  title: 'Życie na fali',
  description: 'Opis & więcej',
  year: '2016',
  countries: ['Maroko', 'USA'],
  star_rating: '6/10',
});

export const mecz = programme({
  id: 'Polsat|2026-10-19T18:00:00Z',
  channel_id: 'Polsat',
  start: '2026-10-19T20:00:00+02:00',
  stop: '2026-10-19T22:00:00+02:00',
  title: 'Mecz (finał) *',
});

export const faktyPolsat = programme({
  id: 'Polsat|2026-10-20T05:00:00Z',
  channel_id: 'Polsat',
  start: '2026-10-20T07:00:00+02:00',
  stop: '2026-10-20T07:30:00+02:00',
  title: 'Fakty',
});

/** Starts before the clocks go back (+0200) and ends after (+0100). */
export const nocneKino = programme({
  id: 'Polsat|2026-10-25T00:30:00Z',
  channel_id: 'Polsat',
  start: '2026-10-25T02:30:00+02:00',
  stop: '2026-10-25T02:15:00+01:00',
  title: 'Nocne kino',
});

export const poKinie = programme({
  id: 'Polsat|2026-10-25T01:15:00Z',
  channel_id: 'Polsat',
  start: '2026-10-25T02:15:00+01:00',
  stop: '2026-10-25T03:00:00+01:00',
  title: 'Po kinie',
});

export const channels: Channel[] = [
  { id: 'Polsat', name: 'Polsat', icon: null },
  { id: 'TVN', name: 'TVN', icon: 'http://img.example/tvn.png' },
];
