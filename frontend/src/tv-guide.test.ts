import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { validateConfig } from './config';
import { tvDayRange } from './data/time';
import { NOW, WAW, channels, fakty, faktyDay3, faktyPolsat, faktyTomorrow, mecz, sport, uwagaTomorrow, zycie } from './test/fixtures';
import type { Programme } from './types/api';
import type { HomeAssistant } from './types/hass';
import './tv-guide';
import { registerCard, TvGuide } from './tv-guide';

vi.mock('./utils/logo-tone', () => ({ measureLogo: vi.fn(() => 'mixed') }));

const SCHEDULE: Programme[] = [fakty, sport, faktyTomorrow, uwagaTomorrow, faktyDay3, zycie, mecz, faktyPolsat];
const MINUTE = 60e3;
const SWITCH_FEEDBACK_MS = 1600;

const CONFIG = {
  type: 'custom:tv-guide',
  switch_action: { perform_action: 'script.cable_box_go_to_channel', data: { channel: '{number}' } },
  sections: [
    {
      title: 'Main',
      channels: [
        { number: 1, name: 'TVP 1 HD' },
        { number: 3, name: 'Polsat', epg_id: 'Polsat', logo: '/local/polsat.png' },
      ],
    },
    { title: 'News', channels: [{ number: 5, name: 'TVN', epg_id: 'TVN' }] },
  ],
};

/** A guide server that answers like the integration. Tests change `server.fail` and `server.info`. */
const makeServer = () => {
  const server = {
    fail: undefined as { code: string; message: string } | undefined,
    /** With `fail`: only this message type fails. Empty means all of them. */
    failType: undefined as string | undefined,
    /** Message types whose answers wait for `release`. */
    hold: new Set<string>(),
    held: [] as { message: Record<string, unknown>; resolve: (answer?: unknown) => void }[],
    info: { last_success: '2026-10-19T18:00:00+02:00', update_interval: 12 },
    search: { now: [fakty] as Programme[], later: [faktyPolsat] as Programme[] },
    airings: [] as Programme[],
    airingsBy: {} as Record<string, Programme[]>,
    now: { Polsat: zycie, TVN: fakty } as Record<string, Programme | null>,
    send: vi.fn(async (message: Record<string, unknown>): Promise<unknown> => {
      if (server.fail && (server.failType === undefined || server.failType === message.type)) throw server.fail;
      if (server.hold.has(message.type as string)) {
        const answer = await new Promise<unknown>((resolve) => server.held.push({ message, resolve }));
        if (answer !== undefined) return answer;
      }
      switch (message.type) {
        case 'tv_guide/info':
          return server.info;
        case 'tv_guide/channels':
          return channels;
        case 'tv_guide/now':
          return server.now;
        case 'tv_guide/schedule': {
          const start = Date.parse(message.start as string);
          const end = Date.parse(message.end as string);
          return SCHEDULE.filter(
            (p) => p.channel_id === message.channel_id && Date.parse(p.start) < end && Date.parse(p.stop) > start,
          );
        }
        case 'tv_guide/search':
          return message.when === 'now' ? server.search.now : server.search.later;
        case 'tv_guide/airings':
          return server.airingsBy[message.programme_id as string] ?? server.airings;
        default:
          throw new Error(`unexpected message ${String(message.type)}`);
      }
    }),
    /** The held request of a type that matches `where`; its answer is `answer`, or the normal one. */
    release: (type: string, where: (message: Record<string, unknown>) => boolean, answer?: unknown, newest = false) => {
      const matches = (entry: { message: Record<string, unknown> }) => entry.message.type === type && where(entry.message);
      const index = newest ? server.held.map(matches).lastIndexOf(true) : server.held.findIndex(matches);
      if (index < 0) throw new Error(`no held ${type} request`);
      server.held.splice(index, 1)[0]?.resolve(answer);
    },
    requests: (type: string) => server.send.mock.calls.map(([message]) => message).filter((message) => message.type === type),
  };
  return server;
};

const makeHass = (server = makeServer(), locale: Partial<HomeAssistant['locale']> = {}) => {
  const callService = vi.fn(async () => undefined);
  const hass: HomeAssistant = {
    connection: { sendMessagePromise: server.send as HomeAssistant['connection']['sendMessagePromise'] },
    callService,
    locale: { language: 'en', time_format: 'language', time_zone: 'server', ...locale },
    config: { time_zone: WAW },
    themes: { darkMode: false },
  };
  return { hass, server, callService };
};

/** Lets the pending requests finish and the card render. */
const settle = async (el: TvGuide) => {
  for (let round = 0; round < 3; round++) await vi.advanceTimersByTimeAsync(0);
  await el.updateComplete;
};

const mount = async (setup = makeHass(), config: unknown = CONFIG) => {
  const el = document.createElement('tv-guide') as TvGuide;
  el.setConfig(config);
  el.hass = setup.hass;
  document.body.append(el);
  await settle(el);
  return { el, ...setup };
};

const $ = <T extends Element>(root: ParentNode | null | undefined, selector: string) => root?.querySelector<T>(selector) ?? null;
const $$ = <T extends Element>(root: ParentNode | null | undefined, selector: string) => [...(root?.querySelectorAll<T>(selector) ?? [])];
const rows = (el: TvGuide) => $$<HTMLElement & { channel: { number: number }; programme: Programme | null; logo?: string }>(el.shadowRoot, 'tvg-channel-row');
const rowOf = (el: TvGuide, number: number) => rows(el).find((row) => row.channel.number === number);
const text = (el: TvGuide) => el.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? '';
const isoRange = (key: string) => {
  const { start, end } = tvDayRange(key, WAW, 5);
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
};

/** Types in the search box the way a user does. */
const typeQuery = async (el: TvGuide, query: string) => {
  const input = $<HTMLInputElement>($(el.shadowRoot, 'tvg-search-box')?.shadowRoot, 'input');
  if (!input) throw new Error('no search input');
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await settle(el);
  return input;
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

test('renders sections and rows from now', async () => {
  const { el } = await mount();
  expect($$(el.shadowRoot, '.section').map((s) => s.textContent?.trim())).toEqual(['Main', 'News']);
  expect(rows(el).map((row) => row.channel.number)).toEqual([1, 3, 5]);
  expect(rowOf(el, 5)?.programme?.title).toBe('Fakty');
  expect(rowOf(el, 3)?.programme?.title).toBe('Życie na fali');
  expect(rowOf(el, 1)?.programme).toBeNull();
});

test('a row uses the guide icon, and the config logo when there is one', async () => {
  const { el } = await mount();
  expect(rowOf(el, 5)?.logo).toBe('http://img.example/tvn.png');
  expect(rowOf(el, 3)?.logo).toBe('/local/polsat.png');
  expect(rowOf(el, 1)?.logo).toBeUndefined();
});

test('asks for the channels once and for now every 60 seconds', async () => {
  const { el, server } = await mount();
  expect(server.requests('tv_guide/channels')).toHaveLength(1);
  expect(server.requests('tv_guide/now')).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(60 * 1000);
  await settle(el);
  expect(server.requests('tv_guide/channels')).toHaveLength(1);
  expect(server.requests('tv_guide/now')).toHaveLength(2);
});

test('sets the list height from the config', async () => {
  const { el } = await mount(makeHass(), { ...CONFIG, height: '420px' });
  expect($<HTMLElement>(el.shadowRoot, '.frame')?.style.height).toBe('420px');
});

test('tvg-switch calls the switch action and marks the row for 1.6 seconds', async () => {
  const { el, callService } = await mount();
  $<HTMLElement>(rowOf(el, 3)?.shadowRoot, '.zap')?.click();
  await settle(el);
  expect(callService).toHaveBeenCalledWith('script', 'cable_box_go_to_channel', { channel: 3 });
  expect($(rowOf(el, 3)?.shadowRoot, '.zap.switching')).not.toBeNull();
  expect(text(el)).toContain('Switching to 3 Polsat');

  await vi.advanceTimersByTimeAsync(SWITCH_FEEDBACK_MS);
  await el.updateComplete;
  expect($(rowOf(el, 3)?.shadowRoot, '.zap.switching')).toBeNull();
  expect(text(el)).not.toContain('Switching to');
});

test('a failed switch sends a hass-notification', async () => {
  const setup = makeHass();
  setup.callService.mockRejectedValueOnce(new Error('offline'));
  const { el } = await mount(setup);
  const onNotification = vi.fn();
  el.addEventListener('hass-notification', (event) => onNotification((event as CustomEvent).detail));
  $<HTMLElement>(rowOf(el, 3)?.shadowRoot, '.zap')?.click();
  await settle(el);
  expect(onNotification).toHaveBeenCalledWith({ message: 'Cannot switch to Polsat: offline' });
});

test('opening a channel sends one schedule request, from the start of today to 14 days ahead', async () => {
  const { el, server } = await mount();
  $<HTMLElement>(rowOf(el, 5)?.shadowRoot, '.info')?.click();
  await settle(el);

  const start = tvDayRange('2026-10-19', WAW, 5).start;
  expect(server.requests('tv_guide/schedule')).toEqual([
    {
      type: 'tv_guide/schedule',
      channel_id: 'TVN',
      start: new Date(start).toISOString(),
      end: new Date(start + 14 * 24 * 3600e3).toISOString(),
    },
  ]);
  const view = $<HTMLElement & { programmes: Programme[]; selectedDay: string; days: string[] }>(el.shadowRoot, 'tvg-channel-view');
  expect(view?.selectedDay).toBe('2026-10-19');
  expect(view?.programmes.map((p) => p.id)).toEqual([fakty.id, sport.id, faktyTomorrow.id, uwagaTomorrow.id, faktyDay3.id]);
  expect(view?.days).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
  expect($<HTMLElement & { open: boolean }>(el.shadowRoot, 'tvg-sheet')?.open).toBe(true);
});

test('a day chip changes the day without a new request', async () => {
  const { el, server } = await mount();
  $<HTMLElement>(rowOf(el, 5)?.shadowRoot, '.info')?.click();
  await settle(el);
  const view = $<HTMLElement & { selectedDay: string }>(el.shadowRoot, 'tvg-channel-view');
  const tomorrow = $$<HTMLButtonElement>($(view?.shadowRoot, 'tvg-day-chips')?.shadowRoot, 'button')[1];
  tomorrow?.click();
  await settle(el);

  expect(view?.selectedDay).toBe('2026-10-20');
  expect(server.requests('tv_guide/schedule')).toHaveLength(1);
});

test('a failed schedule shows the load error, not the "no guide" text', async () => {
  const setup = makeHass();
  const { el, server } = await mount(setup);
  server.fail = { code: 'not_loaded', message: 'not loaded' };
  server.failType = 'tv_guide/schedule';
  $<HTMLElement>(rowOf(el, 5)?.shadowRoot, '.info')?.click();
  await settle(el);
  const view = $(el.shadowRoot, 'tvg-channel-view');
  expect($(view?.shadowRoot, '.no-guide')?.textContent).toBe('The guide is not loaded yet.');

  server.fail = { code: 'boom', message: 'boom' };
  $<HTMLElement>(view?.shadowRoot, '[data-close]')?.click();
  $<HTMLElement>(rowOf(el, 3)?.shadowRoot, '.info')?.click();
  await settle(el);
  expect($($(el.shadowRoot, 'tvg-channel-view')?.shadowRoot, '.no-guide')?.textContent).toBe('Cannot load the guide. Trying again soon.');
});

test('a channel whose guide id the integration does not keep says it is not selected', async () => {
  const config = {
    ...CONFIG,
    sections: [{ channels: [{ number: 7, name: 'TVP 2', epg_id: 'TVP 2' }, { number: 5, name: 'TVN', epg_id: 'TVN' }] }],
  };
  const { el } = await mount(makeHass(), config);
  const row = rowOf(el, 7);
  expect($(row?.shadowRoot, '.now .title')?.textContent).toBe('Not selected in the integration');
  expect($(rowOf(el, 5)?.shadowRoot, '.now .title')?.textContent).toBe('Fakty');

  $<HTMLElement>(row?.shadowRoot, '.info')?.click();
  await settle(el);
  expect($($(el.shadowRoot, 'tvg-channel-view')?.shadowRoot, '.no-guide')?.textContent).toBe(
    'This channel is not selected in the TV guide integration. Select it in the integration options.',
  );
});

test('the older schedule answer is dropped when another channel was opened meanwhile', async () => {
  const { el, server } = await mount();
  server.hold.add('tv_guide/schedule');
  $<HTMLElement>(rowOf(el, 5)?.shadowRoot, '.info')?.click();
  await settle(el);
  $<HTMLElement>($(el.shadowRoot, 'tvg-channel-view')?.shadowRoot, '[data-close]')?.click();
  $<HTMLElement>(rowOf(el, 3)?.shadowRoot, '.info')?.click();
  await settle(el);

  server.release('tv_guide/schedule', (m) => m.channel_id === 'Polsat');
  await settle(el);
  server.release('tv_guide/schedule', (m) => m.channel_id === 'TVN');
  await settle(el);

  const view = $<HTMLElement & { programmes: Programme[]; channel: { number: number }; loading: boolean }>(el.shadowRoot, 'tvg-channel-view');
  expect(view?.channel.number).toBe(3);
  expect(view?.programmes.map((p) => p.channel_id)).toEqual(['Polsat', 'Polsat', 'Polsat']);
  expect(view?.loading).toBe(false);
});

test('the older schedule answer is dropped when it arrives last', async () => {
  const { el, server } = await mount();
  server.hold.add('tv_guide/schedule');
  $<HTMLElement>(rowOf(el, 5)?.shadowRoot, '.info')?.click();
  await settle(el);
  $<HTMLElement>($(el.shadowRoot, 'tvg-channel-view')?.shadowRoot, '[data-close]')?.click();
  $<HTMLElement>(rowOf(el, 3)?.shadowRoot, '.info')?.click();
  await settle(el);

  server.release('tv_guide/schedule', (m) => m.channel_id === 'TVN');
  await settle(el);
  const view = $<HTMLElement & { programmes: Programme[]; loading: boolean }>(el.shadowRoot, 'tvg-channel-view');
  expect(view?.programmes).toEqual([]);
  expect(view?.loading).toBe(true);
});

test('a channel without a guide id opens without asking the server', async () => {
  const { el, server } = await mount();
  $<HTMLElement>(rowOf(el, 1)?.shadowRoot, '.info')?.click();
  await settle(el);
  expect(server.requests('tv_guide/schedule')).toHaveLength(0);
  expect($<HTMLElement & { loading: boolean }>(el.shadowRoot, 'tvg-channel-view')?.loading).toBe(false);
});

test('opening a programme requests its airings with the channels of the card', async () => {
  const { el, server } = await mount();
  $<HTMLElement>(rowOf(el, 5)?.shadowRoot, '.info')?.click();
  await settle(el);
  const view = $(el.shadowRoot, 'tvg-channel-view');
  $<HTMLElement>(view?.shadowRoot, '.slot')?.click();
  await settle(el);

  expect(server.requests('tv_guide/airings')).toEqual([
    { type: 'tv_guide/airings', programme_id: fakty.id, channel_ids: ['Polsat', 'TVN'] },
  ]);
  const programmeView = $<HTMLElement & { programme: Programme; airings: Programme[] | null }>(el.shadowRoot, 'tvg-programme-view');
  expect(programmeView?.programme.id).toBe(fakty.id);
  expect(programmeView?.airings).toEqual([]);
  expect($<HTMLElement & { showProgramme: boolean }>(el.shadowRoot, 'tvg-sheet')?.showProgramme).toBe(true);
});

test('back shows the schedule again and close closes the sheet', async () => {
  const { el } = await mount();
  $<HTMLElement>(rowOf(el, 5)?.shadowRoot, '.info')?.click();
  await settle(el);
  $<HTMLElement>($(el.shadowRoot, 'tvg-channel-view')?.shadowRoot, '.slot')?.click();
  await settle(el);
  const sheet = $<HTMLElement & { open: boolean; showProgramme: boolean }>(el.shadowRoot, 'tvg-sheet');

  $<HTMLElement>($(el.shadowRoot, 'tvg-programme-view')?.shadowRoot, '[data-back]')?.click();
  await settle(el);
  expect(sheet?.showProgramme).toBe(false);
  expect(sheet?.open).toBe(true);

  $<HTMLElement>($(el.shadowRoot, 'tvg-channel-view')?.shadowRoot, '[data-close]')?.click();
  await settle(el);
  expect(sheet?.open).toBe(false);
});

test('a programme from search opens its channel on its day with the programme view', async () => {
  const { el, server } = await mount();
  await typeQuery(el, 'fakty');
  const row = $$<HTMLElement & { programme: Programme | null }>(el.shadowRoot, 'tvg-programme-row').find((r) => r.programme?.id === faktyPolsat.id);
  $<HTMLElement>(row?.shadowRoot, '.info')?.click();
  await settle(el);

  expect(server.requests('tv_guide/schedule')).toEqual([
    expect.objectContaining({ channel_id: 'Polsat', start: isoRange('2026-10-19').start }),
  ]);
  const view = $<HTMLElement & { selectedDay: string; channel: { number: number } }>(el.shadowRoot, 'tvg-channel-view');
  expect(view?.channel.number).toBe(3);
  expect(view?.selectedDay).toBe('2026-10-20');
  expect($<HTMLElement & { programme: Programme }>(el.shadowRoot, 'tvg-programme-view')?.programme.id).toBe(faktyPolsat.id);
  expect($<HTMLElement & { showProgramme: boolean }>(el.shadowRoot, 'tvg-sheet')?.showProgramme).toBe(true);
});

test('a programme from the airings opens the channel and the day of that airing', async () => {
  const setup = makeHass();
  setup.server.airings = [faktyPolsat];
  const { el, server } = await mount(setup);
  $<HTMLElement>(rowOf(el, 5)?.shadowRoot, '.info')?.click();
  await settle(el);
  $<HTMLElement>($(el.shadowRoot, 'tvg-channel-view')?.shadowRoot, '.slot')?.click();
  await settle(el);
  const air = $<HTMLElement>($(el.shadowRoot, 'tvg-programme-view')?.shadowRoot, '.air');
  air?.click();
  await settle(el);

  const view = $<HTMLElement & { selectedDay: string; channel: { number: number } }>(el.shadowRoot, 'tvg-channel-view');
  expect(view?.channel.number).toBe(3);
  expect(view?.selectedDay).toBe('2026-10-20');
  expect($<HTMLElement & { programme: Programme }>(el.shadowRoot, 'tvg-programme-view')?.programme.id).toBe(faktyPolsat.id);
  expect(server.requests('tv_guide/airings')).toContainEqual({
    type: 'tv_guide/airings',
    programme_id: faktyPolsat.id,
    channel_ids: ['Polsat', 'TVN'],
  });
});

test('an airing on the same channel but another day switches the selected day without a request', async () => {
  const setup = makeHass();
  setup.server.airings = [faktyTomorrow];
  const { el, server } = await mount(setup);
  $<HTMLElement>(rowOf(el, 5)?.shadowRoot, '.info')?.click();
  await settle(el);
  $<HTMLElement>($(el.shadowRoot, 'tvg-channel-view')?.shadowRoot, '.slot')?.click();
  await settle(el);
  $<HTMLElement>($(el.shadowRoot, 'tvg-programme-view')?.shadowRoot, '.air')?.click();
  await settle(el);

  const view = $<HTMLElement & { selectedDay: string }>(el.shadowRoot, 'tvg-channel-view');
  expect(view?.selectedDay).toBe('2026-10-20');
  expect($<HTMLElement & { programme: Programme }>(el.shadowRoot, 'tvg-programme-view')?.programme.id).toBe(faktyTomorrow.id);
  expect(server.requests('tv_guide/schedule')).toHaveLength(1);
});

test('the older airings answer is dropped after a quick programme switch', async () => {
  const setup = makeHass();
  setup.server.airingsBy = { [fakty.id]: [faktyDay3], [sport.id]: [uwagaTomorrow] };
  const { el, server } = await mount(setup);
  $<HTMLElement>(rowOf(el, 5)?.shadowRoot, '.info')?.click();
  await settle(el);
  server.hold.add('tv_guide/airings');
  const slots = () => $$<HTMLElement>($(el.shadowRoot, 'tvg-channel-view')?.shadowRoot, '.slot');
  slots()[0]?.click();
  await settle(el);
  $<HTMLElement>($(el.shadowRoot, 'tvg-programme-view')?.shadowRoot, '[data-back]')?.click();
  await settle(el);
  slots()[1]?.click();
  await settle(el);

  server.release('tv_guide/airings', (m) => m.programme_id === sport.id);
  await settle(el);
  server.release('tv_guide/airings', (m) => m.programme_id === fakty.id);
  await settle(el);

  const programmeView = $<HTMLElement & { programme: Programme; airings: Programme[] | null }>(el.shadowRoot, 'tvg-programme-view');
  expect(programmeView?.programme.id).toBe(sport.id);
  expect(programmeView?.airings).toEqual([uwagaTomorrow]);
});

test('the older refresh cannot overwrite a newer one', async () => {
  const { el, server } = await mount();
  server.hold.add('tv_guide/now');
  await vi.advanceTimersByTimeAsync(MINUTE);
  await vi.advanceTimersByTimeAsync(MINUTE);
  await settle(el);

  server.release('tv_guide/now', () => true, { Polsat: zycie, TVN: sport }, true);
  await settle(el);
  server.release('tv_guide/now', () => true, { Polsat: zycie, TVN: fakty });
  await settle(el);
  expect(rowOf(el, 5)?.programme?.title).toBe('Sport');
});

test('a failing info request does not block the programmes on now', async () => {
  const setup = makeHass();
  setup.server.fail = { code: 'boom', message: 'boom' };
  setup.server.failType = 'tv_guide/info';
  const { server } = await mount(setup);
  expect(server.requests('tv_guide/now')).toHaveLength(1);
});

test('a new connection does not refresh while the card is disconnected', async () => {
  const first = makeHass();
  const { el } = await mount(first);
  el.remove();
  const second = makeHass();
  el.hass = { ...first.hass, connection: second.hass.connection };
  await vi.advanceTimersByTimeAsync(0);
  expect(second.server.send).not.toHaveBeenCalled();

  document.body.append(el);
  await settle(el);
  expect(second.server.requests('tv_guide/now')).toHaveLength(1);
});

test('a failed search step says so instead of "no match"', async () => {
  const { el, server } = await mount();
  server.fail = { code: 'boom', message: 'boom' };
  server.failType = 'tv_guide/search';
  await typeQuery(el, 'zzz');
  expect(text(el)).toContain('Cannot load the guide. Trying again soon.');
  expect(text(el)).not.toContain('No channel or programme matches');
});

test('Enter in the search box switches to the first result', async () => {
  const { el, callService } = await mount();
  const input = await typeQuery(el, 'tvn');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
  await settle(el);
  expect(callService).toHaveBeenCalledWith('script', 'cable_box_go_to_channel', { channel: 5 });
});

test('a blank query shows the normal list and a query without matches says so', async () => {
  const setup = makeHass();
  setup.server.search = { now: [], later: [] };
  const { el } = await mount(setup);
  await typeQuery(el, 'zzz');
  expect(text(el)).toContain('No channel or programme matches "zzz".');
  await typeQuery(el, '');
  expect(rows(el)).toHaveLength(3);
});

test('shows a stale guide hint', async () => {
  const setup = makeHass();
  setup.server.info = { last_success: '2026-10-17T12:30:00+02:00', update_interval: 12 };
  const { el } = await mount(setup);
  expect($(el.shadowRoot, '.stale')?.textContent?.trim()).toBe('Guide from 17 Oct, 12:30');
});

test('shows no hint for a fresh guide', async () => {
  const { el } = await mount();
  expect($(el.shadowRoot, '.stale')).toBeNull();
});

test('with time_format 12 the rows show 12-hour times', async () => {
  const { el } = await mount(makeHass(makeServer(), { time_format: '12' }));
  expect(rowOf(el, 5)?.shadowRoot?.textContent).toMatch(/7:35\s*pm/i);
});

test('with the default time_format the rows show 24-hour times', async () => {
  const { el } = await mount();
  expect(rowOf(el, 5)?.shadowRoot?.textContent).toContain('19:35');
});

test('shows not loaded message for not_loaded', async () => {
  const setup = makeHass();
  setup.server.fail = { code: 'not_loaded', message: 'not loaded' };
  const { el } = await mount(setup);
  expect($(el.shadowRoot, '.empty')?.textContent?.trim()).toBe('The guide is not loaded yet.');
  expect(rows(el)).toHaveLength(0);
});

test('shows the not set up message for not_found', async () => {
  const setup = makeHass();
  setup.server.fail = { code: 'not_found', message: 'no entry' };
  const { el } = await mount(setup);
  expect($(el.shadowRoot, '.empty')?.textContent?.trim()).toBe('Add the TV guide integration first.');
});

test('shows a general message for any other error', async () => {
  const setup = makeHass();
  setup.server.fail = { code: 'boom', message: 'boom' };
  const { el } = await mount(setup);
  expect($(el.shadowRoot, '.empty')?.textContent?.trim()).toBe('Cannot load the guide. Trying again soon.');
});

test('recovers on the next tick when the integration finishes loading', async () => {
  const setup = makeHass();
  setup.server.fail = { code: 'not_loaded', message: 'not loaded' };
  const { el } = await mount(setup);
  setup.server.fail = undefined;
  await vi.advanceTimersByTimeAsync(MINUTE);
  await settle(el);
  expect($(el.shadowRoot, '.empty')).toBeNull();
  expect(rowOf(el, 5)?.programme?.title).toBe('Fakty');
  expect(rowOf(el, 5)?.logo).toBe('http://img.example/tvn.png');
});

test('a new hass.connection is used from then on', async () => {
  const first = makeHass();
  const { el } = await mount(first);
  const second = makeHass();
  el.hass = { ...first.hass, connection: second.hass.connection };
  await settle(el);
  expect(second.server.requests('tv_guide/now')).toHaveLength(1);
  const callsBefore = first.server.send.mock.calls.length;
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(first.server.send.mock.calls.length).toBe(callsBefore);
  expect(second.server.requests('tv_guide/now')).toHaveLength(2);
});

test('the same connection in a new hass object sends nothing', async () => {
  const setup = makeHass();
  const { el } = await mount(setup);
  const calls = setup.server.send.mock.calls.length;
  el.hass = { ...setup.hass };
  await settle(el);
  expect(setup.server.send.mock.calls.length).toBe(calls);
});

test('the refresh timer runs only while the card is connected', async () => {
  const { el, server } = await mount();
  el.remove();
  await vi.advanceTimersByTimeAsync(3 * MINUTE);
  expect(server.requests('tv_guide/now')).toHaveLength(1);

  document.body.append(el);
  await settle(el);
  expect(server.requests('tv_guide/now')).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(server.requests('tv_guide/now')).toHaveLength(3);
});

test('setConfig throws the config error', () => {
  const el = document.createElement('tv-guide') as TvGuide;
  expect(() => el.setConfig({ type: 'custom:tv-guide', sections: [] })).toThrow(/switch_action/);
});

test('empty sections give an empty list', async () => {
  const { el, server } = await mount(makeHass(), { ...CONFIG, sections: [] });
  expect(rows(el)).toHaveLength(0);
  expect($(el.shadowRoot, '.empty')).toBeNull();
  expect(server.requests('tv_guide/now')).toHaveLength(0);
});

test('getCardSize is 9', () => {
  expect((document.createElement('tv-guide') as TvGuide).getCardSize()).toBe(9);
});

test('the card is registered once in window.customCards', () => {
  registerCard();
  const cards = (window as unknown as { customCards: { type: string; name: string; description: string }[] }).customCards;
  const entries = cards.filter((card) => card.type === 'tv-guide');
  expect(entries).toHaveLength(1);
  expect(entries[0]?.name).toBe('TV guide');
  expect(entries[0]?.description).not.toBe('');
});

test('getStubConfig gives a valid config for the card picker', () => {
  const stub = TvGuide.getStubConfig();
  expect(() => validateConfig(stub)).not.toThrow();
  expect(stub.sections).toHaveLength(1);
  expect(stub.sections[0]?.channels).toHaveLength(1);
});
