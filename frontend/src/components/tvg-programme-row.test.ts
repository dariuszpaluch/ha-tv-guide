import { afterEach, expect, test, vi } from 'vitest';
import type { ChannelConfig } from '../config';
import { NOW, WAW, faktyTomorrow, sport, tEn, zycie } from '../test/fixtures';
import { TvgProgrammeRow } from './tvg-programme-row';

vi.mock('../utils/logo-tone', () => ({ measureLogo: vi.fn(() => 'mixed') }));

const polsat: ChannelConfig = { number: 3, name: 'Polsat', epg_id: 'Polsat' };

const mount = async (props: Partial<TvgProgrammeRow> = {}) => {
  const el = new TvgProgrammeRow();
  Object.assign(el, {
    channel: polsat,
    logo: undefined,
    programme: zycie,
    now: NOW,
    todayKey: '2026-10-19',
    t: tEn,
    locale: 'en-GB',
    timeZone: WAW,
    hour12: false,
    startHour: 5,
    darkMode: false,
    first: false,
    highlight: '',
    ...props,
  });
  document.body.append(el);
  await el.updateComplete;
  return el;
};

const $ = <T extends Element>(el: TvgProgrammeRow, selector: string) =>
  el.shadowRoot?.querySelector<T>(selector) ?? null;

/** Lit leaves comment markers in the HTML; the tests compare only the elements and the text. */
const withoutMarkers = (html = '') => html.replace(/<!--.*?-->/g, '');

afterEach(() => document.body.replaceChildren());

test('programme row fires tvg-open-programme with the id', async () => {
  const el = await mount();
  const onOpen = vi.fn();
  el.addEventListener('tvg-open-programme', (e) => onOpen(e.detail));
  $<HTMLButtonElement>(el, '.info')?.click();
  expect(onOpen).toHaveBeenCalledWith({ number: 3, programmeId: zycie.id });
});

test('left area fires tvg-switch', async () => {
  const el = await mount();
  const onSwitch = vi.fn();
  el.addEventListener('tvg-switch', (e) => onSwitch(e.detail));
  $<HTMLButtonElement>(el, '.zap')?.click();
  expect(onSwitch).toHaveBeenCalledWith({ number: 3 });
});

test('a programme on air shows the channel, the end time and the progress', async () => {
  const el = await mount();
  expect($(el, '.name')?.textContent).toBe('Życie na fali');
  expect($(el, '.now .title')?.textContent).toBe('Polsat');
  expect($(el, '.now .tnum')?.textContent).toBe('until 20:00');
  expect($(el, 'tvg-progress')).not.toBeNull();
  expect($(el, '.row')?.classList.contains('prog')).toBe(true);
});

test('a later programme today shows the time to its start and no progress', async () => {
  const el = await mount({ programme: sport });
  expect($(el, '.now .tnum')?.textContent).toBe('In 15 min');
  expect($(el, 'tvg-progress')).toBeNull();
});

test('a programme on another day shows the day and time', async () => {
  const el = await mount({ programme: faktyTomorrow });
  expect($(el, '.now .tnum')?.textContent).toBe('Tomorrow, 19:00');
});

test('highlight wraps the match in the original title', async () => {
  const el = await mount({ highlight: 'zycie' });
  expect(withoutMarkers($(el, '.name')?.innerHTML)).toContain('<mark>Życie</mark> na fali');
});

test('without a programme it renders nothing', async () => {
  const el = await mount({ programme: null });
  expect($(el, '.row')).toBeNull();
});

test('the first row is marked', async () => {
  const el = await mount({ first: true });
  expect($(el, '.row')?.classList.contains('first')).toBe(true);
});
