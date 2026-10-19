import { afterEach, expect, test, vi } from 'vitest';
import type { ChannelConfig } from '../config';
import { NOW, WAW, fakty, faktyTomorrow, sport, tEn, uwagaTomorrow } from '../test/fixtures';
import type { Programme } from '../types/api';
import './tvg-channel-view';
import { viewStyles } from './view-parts';
import type { TvgChannelView } from './tvg-channel-view';

vi.mock('../utils/logo-tone', () => ({ measureLogo: vi.fn(() => 'mixed') }));

const tvn: ChannelConfig = { number: 5, name: 'TVN', epg_id: 'TVN' };

const earlier = (id: string, start: string, stop: string): Programme => ({ ...sport, id, start, stop, title: id });
const ended1 = earlier('Rano', '2026-10-19T17:00:00+02:00', '2026-10-19T18:00:00+02:00');
const ended2 = earlier('Wcześniej', '2026-10-19T18:00:00+02:00', '2026-10-19T19:00:00+02:00');
const today = [ended1, ended2, fakty, sport];

const mount = async (props: Partial<TvgChannelView> = {}) => {
  const el = document.createElement('tvg-channel-view') as TvgChannelView;
  Object.assign(el, {
    channel: tvn,
    logo: undefined,
    programmes: today,
    days: ['2026-10-19', '2026-10-20'],
    selectedDay: '2026-10-19',
    todayKey: '2026-10-19',
    showEarlier: false,
    now: NOW,
    t: tEn,
    locale: 'en-GB',
    timeZone: WAW,
    hour12: false,
    startHour: 5,
    darkMode: false,
    loading: false,
    ...props,
  });
  document.body.append(el);
  await el.updateComplete;
  return el;
};

const $ = <T extends Element>(el: TvgChannelView, selector: string) => el.shadowRoot?.querySelector<T>(selector) ?? null;
const $$ = <T extends Element>(el: TvgChannelView, selector: string) => [...(el.shadowRoot?.querySelectorAll<T>(selector) ?? [])];

afterEach(() => document.body.replaceChildren());

test('today hides ended programmes behind "Show N earlier"', async () => {
  const el = await mount();
  expect($$(el, '.slot').map((s) => s.querySelector('.title')?.textContent)).toEqual(['Fakty', 'Sport']);
  expect($(el, '.earlier')?.textContent?.trim()).toBe('Show 2 earlier');
});

test('a click on "Show N earlier" fires tvg-show-earlier', async () => {
  const el = await mount();
  const onEarlier = vi.fn();
  el.addEventListener('tvg-show-earlier', onEarlier);
  $<HTMLButtonElement>(el, '.earlier')?.click();
  expect(onEarlier).toHaveBeenCalledOnce();
});

test('with showEarlier the ended programmes show and the button is gone', async () => {
  const el = await mount({ showEarlier: true });
  expect($$(el, '.slot')).toHaveLength(4);
  expect($(el, '.slot.past')).not.toBeNull();
  expect($(el, '.earlier')).toBeNull();
});

test('another day shows all its programmes and no "earlier" button', async () => {
  const el = await mount({
    programmes: [...today, faktyTomorrow, uwagaTomorrow],
    selectedDay: '2026-10-20',
  });
  expect($$(el, '.slot .title').map((s) => s.textContent)).toEqual(['Fakty', 'Uwaga']);
  expect($(el, '.earlier')).toBeNull();
});

test('the live programme has the bigger poster, a description and a progress bar', async () => {
  const el = await mount({ programmes: [{ ...fakty, description: 'Wiadomości dnia' }, sport] });
  const live = $(el, '.slot.live');
  expect(live?.querySelector('tvg-progress')).not.toBeNull();
  expect(live?.querySelector('.snip')?.textContent).toBe('Wiadomości dnia');
  expect($$(el, '.slot:not(.live) tvg-progress')).toHaveLength(0);
});

test('the poster is lazy, uses the thumb size, and a failed one becomes the placeholder', async () => {
  const el = await mount();
  const img = $<HTMLImageElement>(el, '.slot.live img');
  expect(img?.getAttribute('loading')).toBe('lazy');
  expect(img?.getAttribute('src')).toBe(`${fakty.image}/thumb`);
  img?.dispatchEvent(new Event('error'));
  await el.updateComplete;
  expect($(el, '.slot.live img')).toBeNull();
  expect($(el, '.slot.live .thumb.none svg')).not.toBeNull();
});

test('a programme without a poster shows the placeholder', async () => {
  const el = await mount();
  expect($(el, '.slot:not(.live) .thumb.none svg')).not.toBeNull();
});

test('a click on a programme fires tvg-open-programme', async () => {
  const el = await mount();
  const onOpen = vi.fn();
  el.addEventListener('tvg-open-programme', (e) => onOpen(e.detail));
  $$<HTMLButtonElement>(el, '.slot')[1]?.click();
  expect(onOpen).toHaveBeenCalledWith({ number: 5, programmeId: sport.id });
});

test('the day chips get the labels and a chip click fires tvg-day', async () => {
  const el = await mount();
  const chips = $(el, 'tvg-day-chips');
  expect(chips).not.toBeNull();
  const onDay = vi.fn();
  el.addEventListener('tvg-day', (e) => onDay(e.detail));
  chips?.shadowRoot?.querySelectorAll<HTMLButtonElement>('button')[1]?.click();
  expect(onDay).toHaveBeenCalledWith({ key: '2026-10-20' });
  expect(chips?.shadowRoot?.textContent).toContain('Tomorrow');
});

test('without programmes it says there is no guide', async () => {
  const el = await mount({ programmes: [], days: [] });
  expect($(el, '.no-guide')?.textContent).toBe('No programme guide for this channel.');
  expect($(el, 'tvg-day-chips')).toBeNull();
});

test('while loading it shows a loading row instead of the "no guide" text', async () => {
  const el = await mount({ programmes: [], days: [], loading: true });
  expect($(el, '.loading')?.textContent?.trim()).toBe('Loading…');
  expect($(el, '.no-guide')).toBeNull();
});

test('has exactly one header, with touch-action none, and the close button fires tvg-close', async () => {
  const el = await mount();
  expect($$(el, 'header')).toHaveLength(1);
  const onClose = vi.fn();
  el.addEventListener('tvg-close', onClose);
  $<HTMLButtonElement>(el, 'header [data-close]')?.click();
  expect(onClose).toHaveBeenCalledOnce();
});

test('the header cannot be scrolled or selected, so the sheet can drag it', () => {
  const css = viewStyles.map((style) => style.cssText).join('');
  expect(css).toMatch(/header\s*{[^}]*touch-action:\s*none;[^}]*user-select:\s*none/);
});

test('the header shows the channel name and number', async () => {
  const el = await mount();
  expect($(el, 'header .ch')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('TVN · 5');
});

test('the switch button fires tvg-switch with the number', async () => {
  const el = await mount();
  const onSwitch = vi.fn();
  el.addEventListener('tvg-switch', (e) => onSwitch(e.detail));
  $<HTMLButtonElement>(el, '.actions .btn')?.click();
  expect(onSwitch).toHaveBeenCalledWith({ number: 5 });
});
