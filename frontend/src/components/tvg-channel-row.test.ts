import { afterEach, expect, test, vi } from 'vitest';
import type { ChannelConfig } from '../config';
import { NOW, WAW, fakty, tEn, tPl } from '../test/fixtures';
import { TvgChannelRow } from './tvg-channel-row';

vi.mock('../utils/logo-tone', () => ({ measureLogo: vi.fn(() => 'mixed') }));

const tvp: ChannelConfig = { number: 1, name: 'TVP 1 HD' };
const tvn: ChannelConfig = { number: 5, name: 'TVN', epg_id: 'TVN' };

const mount = async (props: Partial<TvgChannelRow> = {}) => {
  const el = new TvgChannelRow();
  Object.assign(el, {
    channel: tvn,
    logo: undefined,
    programme: fakty,
    now: NOW,
    t: tEn,
    locale: 'en-GB',
    timeZone: WAW,
    hour12: false,
    darkMode: false,
    active: false,
    switching: false,
    first: false,
    highlight: '',
    ...props,
  });
  document.body.append(el);
  await el.updateComplete;
  return el;
};

const $ = <T extends Element>(el: TvgChannelRow, selector: string) => el.shadowRoot?.querySelector<T>(selector) ?? null;

/** Lit leaves comment markers in the HTML; the tests compare only the elements and the text. */
const withoutMarkers = (html = '') => html.replace(/<!--.*?-->/g, '');

afterEach(() => document.body.replaceChildren());

test('left area fires tvg-switch, right area fires tvg-open-channel', async () => {
  const el = await mount();
  const onSwitch = vi.fn();
  const onOpen = vi.fn();
  el.addEventListener('tvg-switch', (e) => onSwitch(e.detail));
  el.addEventListener('tvg-open-channel', (e) => onOpen(e.detail));

  $<HTMLButtonElement>(el, '.zap')?.click();
  expect(onSwitch).toHaveBeenCalledWith({ number: 5 });
  expect(onOpen).not.toHaveBeenCalled();

  $<HTMLButtonElement>(el, '.info')?.click();
  expect(onOpen).toHaveBeenCalledWith({ number: 5 });
  expect(onSwitch).toHaveBeenCalledTimes(1);
});

test('channel row shows the programme, its end time and the progress', async () => {
  const el = await mount();
  expect($(el, '.name')?.textContent).toBe('TVN');
  expect($(el, '.now .title')?.textContent).toBe('Fakty');
  expect($(el, '.now .tnum')?.textContent).toBe('19:35');
  expect($(el, 'tvg-progress')).not.toBeNull();
});

test('channel row without programme shows No guide', async () => {
  const el = await mount({ programme: null });
  expect($(el, '.now .title')?.textContent).toBe('No guide');
  expect($(el, 'tvg-progress')).toBeNull();
});

test('texts are translated', async () => {
  const el = await mount({ programme: null, t: tPl });
  expect($(el, '.now .title')?.textContent).toBe('Brak programu');
});

test('12-hour clock', async () => {
  const el = await mount({ hour12: true });
  expect($(el, '.now .tnum')?.textContent).toBe('7:35 pm');
});

test('highlight wraps the match in mark', async () => {
  const el = await mount({ channel: tvp, highlight: 'tvp' });
  const mark = $(el, '.name mark');
  expect(mark?.textContent).toBe('TVP');
  expect(withoutMarkers($(el, '.name')?.innerHTML)).toContain('<mark>TVP</mark> 1 HD');
});

test('no match or empty highlight gives plain text', async () => {
  const el = await mount({ channel: tvp, highlight: 'xyz' });
  expect($(el, '.name mark')).toBeNull();
  expect($(el, '.name')?.textContent).toBe('TVP 1 HD');
});

test('state classes: active, first and switching', async () => {
  const el = await mount({ active: true, first: true, switching: true });
  expect($(el, '.row')?.classList.contains('active')).toBe(true);
  expect($(el, '.row')?.classList.contains('first')).toBe(true);
  expect($(el, '.zap')?.classList.contains('switching')).toBe(true);
});

test('the channel number is shown and the buttons have labels', async () => {
  const el = await mount();
  expect($(el, '.number')?.textContent).toBe('5');
  expect($(el, '.zap')?.getAttribute('aria-label')).toBe('Switch to 5');
  expect($(el, '.info')?.getAttribute('aria-label')).toBe('Details for TVN');
});

test('the logo is passed to tvg-logo with the config tile', async () => {
  const el = await mount({
    channel: { ...tvn, logo_tile: 'dark' },
    logo: 'http://img.example/tvn.png',
    darkMode: true,
  });
  const logo = $<HTMLElement & { src?: string; tile?: string; darkMode: boolean }>(el, 'tvg-logo');
  expect(logo?.src).toBe('http://img.example/tvn.png');
  expect(logo?.tile).toBe('dark');
  expect(logo?.darkMode).toBe(true);
});

