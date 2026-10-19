import { describe, expect, test, vi } from 'vitest';
import type { TvGuideConfig } from '../config';
import { fakty, mecz, zycie } from '../test/fixtures';
import type { Programme } from '../types/api';
import { GuideError } from './guide-client';
import { firstResult, matchChannels, SearchRunner, type SearchResults } from './search';

const polsat = { number: 3, name: 'Polsat', epg_id: 'Polsat' };
const tvn = { number: 4, name: 'TVN', epg_id: 'TVN' };
const tvp1 = { number: 1, name: 'TVP 1 HD', epg_id: 'TVP 1' };
const zycieChannel = { number: 12, name: 'Życie TV' };

const config: TvGuideConfig = {
  type: 'custom:tv-guide',
  switch_action: { perform_action: 'script.go' },
  tv_day_starts_at: 5,
  height: '600px',
  sections: [{ channels: [tvp1, polsat] }, { channels: [tvn, zycieChannel] }],
};

type Search = ConstructorParameters<typeof SearchRunner>[0];

/** A promise that the test resolves or rejects by hand. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Lets pending promise callbacks run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const setup = (search: Search) => {
  const updates: SearchResults[] = [];
  const runner = new SearchRunner(search, (results) => updates.push(results));
  return { runner, updates, last: () => updates[updates.length - 1] };
};

describe('matchChannels', () => {
  const all = [tvp1, polsat, tvn, zycieChannel];

  test('matches a number prefix', () => {
    expect(matchChannels(all, '1')).toEqual([tvp1, zycieChannel]);
  });

  test('matches a name part, ignoring case and diacritics', () => {
    expect(matchChannels(all, 'ZYCIE')).toEqual([zycieChannel]);
    expect(matchChannels(all, 'olsa')).toEqual([polsat]);
  });

  test('does not match a number in the middle', () => {
    expect(matchChannels(all, '2')).toEqual([]);
  });

  test('treats special characters as plain text', () => {
    expect(matchChannels(all, '(')).toEqual([]);
    expect(matchChannels(all, '*')).toEqual([]);
  });

  test('returns no channels for a blank query', () => {
    expect(matchChannels(all, '')).toEqual([]);
    expect(matchChannels(all, '   ')).toEqual([]);
  });
});

describe('SearchRunner', () => {
  test('channels first, then now and later as they arrive', async () => {
    const now = deferred<Programme[]>();
    const later = deferred<Programme[]>();
    const search = vi.fn<Search>((_query, _ids, when) => (when === 'now' ? now.promise : later.promise));
    const { runner, updates } = setup(search);

    runner.run('Polsat', config);
    expect(updates).toEqual([{ query: 'polsat', channels: [polsat], now: null, later: null }]);

    now.resolve([zycie]);
    await flush();
    expect(updates[1]).toEqual({ query: 'polsat', channels: [polsat], now: [zycie], later: null });

    later.resolve([mecz]);
    await flush();
    expect(updates[2]).toEqual({ query: 'polsat', channels: [polsat], now: [zycie], later: [mecz] });
    expect(updates).toHaveLength(3);
  });

  test('later can arrive before now', async () => {
    const now = deferred<Programme[]>();
    const later = deferred<Programme[]>();
    const { runner, last } = setup((_q, _ids, when) => (when === 'now' ? now.promise : later.promise));

    runner.run('fakty', config);
    later.resolve([fakty]);
    await flush();
    expect(last()).toMatchObject({ now: null, later: [fakty] });
    now.resolve([]);
    await flush();
    expect(last()).toMatchObject({ now: [], later: [fakty] });
  });

  test('asks the server for both steps with the config channels and the later limit', () => {
    const search = vi.fn<Search>(() => new Promise(() => {}));
    const { runner } = setup(search);

    runner.run('  Życie ', config);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledWith('zycie', ['TVP 1', 'Polsat', 'TVN'], 'now');
    expect(search).toHaveBeenCalledWith('zycie', ['TVP 1', 'Polsat', 'TVN'], 'later', 40);
  });

  test('does not call the server below 2 characters', () => {
    const search = vi.fn<Search>();
    const { runner, updates } = setup(search);

    runner.run('t', config);
    expect(search).not.toHaveBeenCalled();
    expect(updates).toEqual([{ query: 't', channels: [tvp1, polsat, tvn, zycieChannel], now: [], later: [] }]);
  });

  test('a blank query clears the results without calling the server', () => {
    const search = vi.fn<Search>();
    const { runner, last } = setup(search);

    runner.run('   ', config);
    expect(search).not.toHaveBeenCalled();
    expect(last()).toEqual({ query: '', channels: [], now: [], later: [] });
  });

  test('ignores answers of a cancelled run', async () => {
    const old = { now: deferred<Programme[]>(), later: deferred<Programme[]>() };
    const fresh = { now: deferred<Programme[]>(), later: deferred<Programme[]>() };
    const search = vi.fn<Search>((query, _ids, when) => (query === 'mec' ? old : fresh)[when].promise);
    const { runner, updates, last } = setup(search);

    runner.run('mec', config);
    runner.run('mecz', config);
    fresh.now.resolve([mecz]);
    fresh.later.resolve([]);
    await flush();
    const count = updates.length;

    old.now.resolve([zycie]);
    old.later.reject(new GuideError('not_loaded', 'x'));
    await flush();
    expect(updates).toHaveLength(count);
    expect(last()).toEqual({ query: 'mecz', channels: [], now: [mecz], later: [] });
  });

  test('cancel stops all later updates', async () => {
    const now = deferred<Programme[]>();
    const { runner, updates } = setup(() => now.promise);

    runner.run('fakty', config);
    runner.cancel();
    now.resolve([fakty]);
    await flush();
    expect(updates).toHaveLength(1);
  });

  test('server error sets error and empty lists', async () => {
    const { runner, last } = setup(() => Promise.reject(new GuideError('not_loaded', 'not loaded')));

    runner.run('fakty', config);
    await flush();
    expect(last()).toEqual({ query: 'fakty', channels: [], now: [], later: [], error: 'not_loaded' });
  });

  test('an error of one step keeps the other step', async () => {
    const { runner, last } = setup((_q, _ids, when) =>
      when === 'now' ? Promise.resolve([fakty]) : Promise.reject(new Error('boom')),
    );

    runner.run('fakty', config);
    await flush();
    expect(last()).toEqual({ query: 'fakty', channels: [], now: [fakty], later: [], error: 'unknown' });
  });
});

describe('firstResult', () => {
  const results = (fields: Partial<SearchResults>): SearchResults => ({
    query: 'x',
    channels: [],
    now: [],
    later: [],
    ...fields,
  });

  test('prefers channels, then now, then later', () => {
    expect(firstResult(results({ channels: [tvn], now: [zycie], later: [mecz] }), config)).toBe(tvn);
    expect(firstResult(results({ now: [zycie], later: [fakty] }), config)).toBe(polsat);
    expect(firstResult(results({ now: null, later: [fakty] }), config)).toBe(tvn);
  });

  test('returns nothing without results or when the channel is not in the config', () => {
    expect(firstResult(results({}), config)).toBeUndefined();
    expect(firstResult(results({ now: null, later: null }), config)).toBeUndefined();
    expect(firstResult(results({ now: [{ ...fakty, channel_id: 'Other' }] }), config)).toBeUndefined();
  });
});
