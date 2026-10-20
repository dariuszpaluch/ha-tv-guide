import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ChannelConfig } from '../../src/config';
import { NOW, WAW, fakty, faktyTomorrow, nocneKino, poKinie, sport, tEn, uwagaTomorrow } from '../fixtures';
import type { Programme } from '../../src/types/api';
import '../../src/components/tvg-channel-view';
import { viewStyles } from '../../src/components/view-parts';
import { scrollAnchor, type TvgChannelView } from '../../src/components/tvg-channel-view';

vi.mock('../../src/utils/logo-tone', () => ({ measureLogo: vi.fn(() => 'mixed') }));

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

test('today shows the whole day, with the ended programmes marked as past', async () => {
  const el = await mount();
  expect($$(el, '.slot .title').map((s) => s.textContent)).toEqual(['Rano', 'Wcześniej', 'Fakty', 'Sport']);
  expect($$(el, '.slot.past .title').map((s) => s.textContent)).toEqual(['Rano', 'Wcześniej']);
  expect($(el, '.text-btn')).toBeNull();
});

test('another day shows all its programmes', async () => {
  const el = await mount({
    programmes: [...today, faktyTomorrow, uwagaTomorrow],
    selectedDay: '2026-10-20',
  });
  expect($$(el, '.slot .title').map((s) => s.textContent)).toEqual(['Fakty', 'Uwaga']);
});

describe('scrollAnchor', () => {
  test('is the focused programme, on any day', () => {
    expect(scrollAnchor(today, sport.id, NOW, true)).toBe(3);
    expect(scrollAnchor(today, ended1.id, NOW, false)).toBe(0);
  });

  test('without a focused programme, on today, is the first programme that has not ended', () => {
    expect(scrollAnchor(today, '', NOW, true)).toBe(2);
    expect(scrollAnchor(today, 'not-on-this-day', NOW, true)).toBe(2);
  });

  test('is the top on another day without a focused programme, or when every programme has ended', () => {
    expect(scrollAnchor(today, '', NOW, false)).toBe(-1);
    expect(scrollAnchor([ended1, ended2], '', NOW, true)).toBe(-1);
  });
});

describe('scrolling the schedule', () => {
  const ROW_PX = 60;
  const CHIPS_PX = 40;
  const VIEW_PX = 260;

  // happy-dom has no layout: each slot is ROW_PX high and placed under the chips, by its index.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('slot') ? CHIPS_PX + [...(this.parentElement?.children ?? [])].indexOf(this) * ROW_PX : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('slot')) return ROW_PX;
      return this.localName === 'tvg-day-chips' ? CHIPS_PX : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEW_PX);
  });
  afterEach(() => vi.restoreAllMocks());

  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const scrollOf = (el: TvgChannelView) => $<HTMLElement>(el, '.scroll') as HTMLElement;
  const settle = async (el: TvgChannelView) => {
    await el.updateComplete;
    await frame();
    return scrollOf(el).scrollTop;
  };

  test('today opens with the programme before the one on now at the top', async () => {
    const el = await mount();
    // Wcześniej (index 1) is the top row, Fakty (on now) is under it.
    expect(await settle(el)).toBe(ROW_PX);
  });

  test('scrolls when the schedule arrives', async () => {
    const el = await mount({ programmes: [], loading: true });
    expect(await settle(el)).toBe(0);
    el.programmes = today;
    el.loading = false;
    expect(await settle(el)).toBe(ROW_PX);
  });

  test('a focused programme is the anchor, with the one before it at the top', async () => {
    const el = await mount({ focusId: sport.id });
    expect(await settle(el)).toBe(2 * ROW_PX);
  });

  test('another day opens at the top', async () => {
    const el = await mount();
    await settle(el);
    el.programmes = [...today, faktyTomorrow, uwagaTomorrow];
    el.selectedDay = '2026-10-20';
    expect(await settle(el)).toBe(0);
  });

  test('a new focus on a row the user can see does not move the list', async () => {
    const el = await mount();
    expect(await settle(el)).toBe(ROW_PX);
    // Fakty and Sport are both in view.
    el.focusId = sport.id;
    expect(await settle(el)).toBe(ROW_PX);
  });

  test('a new focus on a row out of view scrolls to it', async () => {
    const el = await mount();
    expect(await settle(el)).toBe(ROW_PX);
    el.focusId = ended1.id;
    expect(await settle(el)).toBe(0);
  });

  test('the minute refresh does not move the list', async () => {
    const el = await mount();
    await settle(el);
    scrollOf(el).scrollTop = 7;
    el.now = NOW + 60e3;
    expect(await settle(el)).toBe(7);
  });
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
  $$<HTMLButtonElement>(el, '.slot')[3]?.click();
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

test('a load error is shown instead of the "no guide" text', async () => {
  const el = await mount({ programmes: [], days: [], error: 'Cannot load the guide.' });
  expect($(el, '.no-guide')?.textContent).toBe('Cannot load the guide.');
  expect(el.shadowRoot?.textContent).not.toContain('No programme guide for this channel.');
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

describe('programmes across the TV-day start', () => {
  const AT_0510 = Date.parse('2026-10-19T05:10:00+02:00');
  const earlyNews = earlier('Poranek', '2026-10-19T04:30:00+02:00', '2026-10-19T05:30:00+02:00');
  const night = earlier('Noc', '2026-10-19T03:00:00+02:00', '2026-10-19T04:30:00+02:00');
  const morning = earlier('Rano', '2026-10-19T05:30:00+02:00', '2026-10-19T06:30:00+02:00');

  test('a programme that started before the day start and still runs is the live row of today', async () => {
    const el = await mount({ programmes: [night, earlyNews, morning], now: AT_0510 });
    expect($$(el, '.slot .title').map((s) => s.textContent)).toEqual(['Poranek', 'Rano']);
    expect($(el, '.slot.live .title')?.textContent).toBe('Poranek');
  });

  test('a programme that ended after the day start is listed as past', async () => {
    const ended = earlier('Skończony', '2026-10-19T05:00:00+02:00', '2026-10-19T05:05:00+02:00');
    const el = await mount({ programmes: [ended, earlyNews, morning], now: AT_0510 });
    expect($$(el, '.slot .title').map((s) => s.textContent)).toEqual(['Skończony', 'Poranek', 'Rano']);
    expect($$(el, '.slot.past .title').map((s) => s.textContent)).toEqual(['Skończony']);
  });

  test('the same programme is also listed on the previous day', async () => {
    const el = await mount({ programmes: [night, earlyNews, morning], now: AT_0510, selectedDay: '2026-10-18' });
    expect($$(el, '.slot .title').map((s) => s.textContent)).toEqual(['Noc', 'Poranek']);
  });

  test('the 25-hour day of the clock change lists every programme once', async () => {
    const after = earlier('Po zmianie', '2026-10-25T10:00:00+01:00', '2026-10-25T11:00:00+01:00');
    const programmes = [nocneKino, poKinie, after];
    const dayOne = await mount({ programmes, selectedDay: '2026-10-24', days: ['2026-10-24', '2026-10-25'] });
    expect($$(dayOne, '.slot .title').map((s) => s.textContent)).toEqual(['Nocne kino', 'Po kinie']);
    const dayTwo = await mount({ programmes, selectedDay: '2026-10-25', days: ['2026-10-24', '2026-10-25'] });
    expect($$(dayTwo, '.slot .title').map((s) => s.textContent)).toEqual(['Po zmianie']);
  });
});

test('a programme with a reminder has a small bell under its time', async () => {
  const info = earlier('TVN|2026-10-19T17:50:00Z', '2026-10-19T19:50:00+02:00', '2026-10-19T20:00:00+02:00');
  const el = await mount({ programmes: [fakty, sport, info], remindedIds: new Set([info.id]) });
  const [faktySlot, sportSlot, infoSlot] = $$(el, '.slot');
  expect(infoSlot?.querySelector('.rem svg.i')).not.toBeNull();
  expect(infoSlot?.querySelector('.rem')?.getAttribute('aria-label')).toBe('Reminder set');
  expect(faktySlot?.querySelector('.rem')).toBeNull();
  expect(sportSlot?.querySelector('.rem')).toBeNull();
});
