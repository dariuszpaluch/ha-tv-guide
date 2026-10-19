import { afterEach, expect, test, vi } from 'vitest';
import type { ChannelConfig } from '../config';
import { NOW, WAW, fakty, faktyDay3, faktyPolsat, faktyTomorrow, tEn, uwagaTomorrow, zycie } from '../test/fixtures';
import type { Programme } from '../types/api';
import './tvg-programme-view';
import type { TvgProgrammeView } from './tvg-programme-view';

vi.mock('../utils/logo-tone', () => ({ measureLogo: vi.fn(() => 'mixed') }));

const tvn: ChannelConfig = { number: 5, name: 'TVN', epg_id: 'TVN' };
const polsat: ChannelConfig = { number: 3, name: 'Polsat', epg_id: 'Polsat' };
const channelsById = new Map([
  ['TVN', { config: tvn }],
  ['Polsat', { config: polsat, logo: 'http://img.example/polsat.png' }],
]);

const mount = async (props: Partial<TvgProgrammeView> = {}) => {
  const el = document.createElement('tvg-programme-view') as TvgProgrammeView;
  Object.assign(el, {
    channel: tvn,
    logo: undefined,
    programme: fakty,
    airings: [],
    channelsById,
    now: NOW,
    todayKey: '2026-10-19',
    t: tEn,
    locale: 'en-GB',
    timeZone: WAW,
    hour12: false,
    startHour: 5,
    darkMode: false,
    ...props,
  });
  document.body.append(el);
  await el.updateComplete;
  return el;
};

const $ = <T extends Element>(el: TvgProgrammeView, selector: string) => el.shadowRoot?.querySelector<T>(selector) ?? null;
const $$ = <T extends Element>(el: TvgProgrammeView, selector: string) => [...(el.shadowRoot?.querySelectorAll<T>(selector) ?? [])];
const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();
const groupTitles = (el: TvgProgrammeView) => $$(el, '.grp').map(text);
const rowsOf = (el: TvgProgrammeView) => $$(el, '.air').map((row) => text(row));

afterEach(() => document.body.replaceChildren());

test('shows the chips: category, age, year, countries and star rating', async () => {
  const el = await mount({ programme: { ...zycie, categories: ['dokument'], rating: '12' }, channel: polsat });
  expect($$(el, '.meta span').map(text)).toEqual(['dokument', '12+', '2016', 'Maroko, USA', '★ 6/10']);
  expect(text($(el, '.meta .age'))).toBe('12+');
});

test('an age rating that is not a plain number is shown as the source gives it', async () => {
  for (const rating of ['PG-13', 'TV-14', 'FSK 12', '16+']) {
    const el = await mount({ programme: { ...zycie, rating }, channel: polsat });
    expect(text($(el, '.meta .age'))).toBe(rating);
    el.remove();
  }
});

test('shows no chips when the programme has no details', async () => {
  const el = await mount({ programme: uwagaTomorrow });
  expect($(el, '.meta')).toBeNull();
});

test('shows title, subtitle with episode and description', async () => {
  const el = await mount({ programme: { ...fakty, subtitle: 'Wydanie główne', description: 'Opis' } });
  expect(text($(el, 'h3'))).toBe('Fakty');
  expect(text($(el, '.sub'))).toBe('Wydanie główne, E519');
  expect(text($(el, '.desc'))).toBe('Opis');
});

test('a programme on air shows its time range, the time left and the progress', async () => {
  const el = await mount();
  expect(text($(el, '.timing b'))).toBe('19:00 - 19:35');
  expect(text($(el, '.timing > span'))).toBe('15 min left');
  expect($(el, 'tvg-progress')).not.toBeNull();
});

test('a programme on another day shows the day once', async () => {
  const el = await mount({ programme: uwagaTomorrow });
  expect(text($(el, '.timing'))).toBe('Tomorrow, 19:55 - 20:15');
  expect($(el, 'tvg-progress')).toBeNull();
});

test('the poster uses the large size and is lazy; a failed poster becomes the placeholder', async () => {
  const el = await mount();
  const img = $<HTMLImageElement>(el, '.poster img');
  expect(img?.getAttribute('src')).toBe(`${fakty.image}/large`);
  expect(img?.getAttribute('loading')).toBe('lazy');
  img?.dispatchEvent(new Event('error'));
  await el.updateComplete;
  expect($(el, '.poster img')).toBeNull();
  expect($(el, '.poster.none svg')).not.toBeNull();
});

test('a programme without a poster shows no poster area', async () => {
  const el = await mount({ programme: uwagaTomorrow });
  expect($(el, '.poster')).toBeNull();
});

test('more airings: the same channel group and the other channels group', async () => {
  const el = await mount({ airings: [faktyTomorrow, faktyDay3, faktyPolsat] });
  expect(text($(el, '.airings h4'))).toBe('More airings');
  expect(groupTitles(el)).toEqual(['On TVN', 'On other channels']);
  const [first, second, third] = rowsOf(el);
  expect(first).toBe('Tomorrow 19:00');
  expect(second).toBe('Wed 21 19:00');
  expect(third).toBe('Tomorrow 07:00 Polsat');
  expect($$(el, '.air')[2]?.querySelector('tvg-logo')).not.toBeNull();
  expect($$(el, '.air')[0]?.querySelector('tvg-logo')).toBeNull();
});

test('a tap on an airing of another channel fires tvg-open-programme with that channel', async () => {
  const el = await mount({ airings: [faktyTomorrow, faktyPolsat] });
  const onOpen = vi.fn();
  el.addEventListener('tvg-open-programme', (e) => onOpen(e.detail));
  $$<HTMLButtonElement>(el, '.air')[1]?.click();
  expect(onOpen).toHaveBeenCalledWith({ number: 3, programmeId: faktyPolsat.id });
});

test('a tap on an airing of the same channel uses the channel number of the view', async () => {
  const el = await mount({ airings: [faktyTomorrow] });
  const onOpen = vi.fn();
  el.addEventListener('tvg-open-programme', (e) => onOpen(e.detail));
  $$<HTMLButtonElement>(el, '.air')[0]?.click();
  expect(onOpen).toHaveBeenCalledWith({ number: 5, programmeId: faktyTomorrow.id });
});

test('an airing on a channel that is not in the card is skipped', async () => {
  const stranger: Programme = { ...faktyPolsat, id: 'Other|1', channel_id: 'Other' };
  const el = await mount({ airings: [stranger] });
  expect($(el, '.airings')).toBeNull();
});

test('empty airings hide the section', async () => {
  const el = await mount({ airings: [] });
  expect($(el, '.airings')).toBeNull();
});

test('while airings load it shows a loading row', async () => {
  const el = await mount({ airings: null });
  expect(text($(el, '.airings h4'))).toBe('More airings');
  expect(text($(el, '.airings .loading'))).toBe('Loading…');
});

const series = (n: number): Programme[] =>
  Array.from({ length: n }, (_, i) => ({ ...faktyTomorrow, id: `TVN|series-${i}`, start: `2026-10-${20 + i}T19:00:00+02:00` }));

test('a group with 5 airings shows 3 rows and "Show all (5)"; a click shows all 5', async () => {
  const el = await mount({ airings: series(5) });
  expect($$(el, '.air')).toHaveLength(3);
  const more = $<HTMLButtonElement>(el, '.airings .text-btn');
  expect(text(more)).toBe('Show all (5)');
  more?.click();
  await el.updateComplete;
  expect($$(el, '.air')).toHaveLength(5);
  expect($(el, '.airings .text-btn')).toBeNull();
});

test('a group with 3 airings has no "Show all" button', async () => {
  const el = await mount({ airings: series(3) });
  expect($(el, '.airings .text-btn')).toBeNull();
});

test('"Show all" resets when the programme changes', async () => {
  const el = await mount({ airings: series(5) });
  $<HTMLButtonElement>(el, '.airings .text-btn')?.click();
  await el.updateComplete;
  expect($$(el, '.air')).toHaveLength(5);
  el.programme = uwagaTomorrow;
  el.airings = series(5);
  await el.updateComplete;
  expect($$(el, '.air')).toHaveLength(3);
});

test('has exactly one header; back and close buttons fire their events', async () => {
  const el = await mount();
  expect($$(el, 'header')).toHaveLength(1);
  const onBack = vi.fn();
  const onClose = vi.fn();
  el.addEventListener('tvg-back', onBack);
  el.addEventListener('tvg-close', onClose);
  $<HTMLButtonElement>(el, 'header [data-back]')?.click();
  $<HTMLButtonElement>(el, 'header [data-close]')?.click();
  expect(onBack).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});

test('the switch button fires tvg-switch with the channel number', async () => {
  const el = await mount();
  const onSwitch = vi.fn();
  el.addEventListener('tvg-switch', (e) => onSwitch(e.detail));
  $<HTMLButtonElement>(el, '.actions .btn')?.click();
  expect(onSwitch).toHaveBeenCalledWith({ number: 5 });
});

test('a live programme that started before the day start shows no day label and the time left', async () => {
  const early: Programme = {
    ...uwagaTomorrow,
    id: 'TVN|early',
    start: '2026-10-19T04:30:00+02:00',
    stop: '2026-10-19T05:30:00+02:00',
  };
  const el = await mount({ programme: early, now: Date.parse('2026-10-19T05:10:00+02:00') });
  expect(text($(el, '.timing b'))).toBe('04:30 - 05:30');
  expect(text($(el, '.timing > span'))).toBe('20 min left');
  expect($(el, 'tvg-progress')).not.toBeNull();
});
