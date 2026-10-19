import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GuideClient, GuideError } from './guide-client';
import { channels, fakty, NOW } from '../test/fixtures';

type Message = Record<string, unknown>;

const SECOND = 1000;

/** A fake connection that records every message and answers with `reply`. */
const fakeConnection = (reply: (message: Message) => unknown = () => []) => {
  const sent: Message[] = [];
  const sendMessagePromise = vi.fn((message: Message) => {
    sent.push(message);
    return Promise.resolve(reply(message));
  });
  return { connection: { sendMessagePromise } as never, sent };
};

describe('GuideClient', () => {
  let time: number;
  const clock = () => time;

  beforeEach(() => {
    time = NOW;
  });

  test('sends the contract message with entry_id', async () => {
    const { connection, sent } = fakeConnection(() => ({}));
    await new GuideClient(connection, 'e1', clock).now(['TVN']);
    expect(sent).toEqual([{ type: 'tv_guide/now', channel_ids: ['TVN'], entry_id: 'e1' }]);
  });

  test('omits entry_id when not set', async () => {
    const { connection, sent } = fakeConnection(() => ({}));
    await new GuideClient(connection, undefined, clock).now(['TVN']);
    expect(sent).toEqual([{ type: 'tv_guide/now', channel_ids: ['TVN'] }]);
    expect(sent[0]).not.toHaveProperty('entry_id');
  });

  test('info sends tv_guide/info and returns the answer', async () => {
    const info = { last_success: '2026-10-19T04:00:00+02:00', update_interval: 12 };
    const { connection, sent } = fakeConnection(() => info);
    await expect(new GuideClient(connection, undefined, clock).info()).resolves.toEqual(info);
    expect(sent).toEqual([{ type: 'tv_guide/info' }]);
  });

  test('channels are cached for the session', async () => {
    const { connection, sent } = fakeConnection(() => channels);
    const client = new GuideClient(connection, undefined, clock);
    await expect(client.channels()).resolves.toEqual(channels);
    time += 24 * 3600 * SECOND;
    await client.channels();
    expect(sent).toEqual([{ type: 'tv_guide/channels' }]);
  });

  test('now is cached for 60 s and force skips the cache', async () => {
    const { connection, sent } = fakeConnection(() => ({}));
    const client = new GuideClient(connection, undefined, clock);
    await client.now(['TVN']);
    time = NOW + 59 * SECOND;
    await client.now(['TVN']);
    expect(sent).toHaveLength(1);
    time = NOW + 61 * SECOND;
    await client.now(['TVN']);
    expect(sent).toHaveLength(2);
    await client.now(['TVN'], { force: true });
    expect(sent).toHaveLength(3);
  });

  test('now cache key ignores the order of channel ids', async () => {
    const { connection, sent } = fakeConnection(() => ({}));
    const client = new GuideClient(connection, undefined, clock);
    await client.now(['TVN', 'TVP1']);
    await client.now(['TVP1', 'TVN']);
    await client.now(['TVN']);
    expect(sent).toHaveLength(2);
  });

  test('schedule sends UTC ISO times and caches per channel and range for 10 min', async () => {
    const { connection, sent } = fakeConnection(() => [fakty]);
    const client = new GuideClient(connection, undefined, clock);
    const start = Date.parse('2026-10-19T05:00:00+02:00');
    const end = Date.parse('2026-10-20T05:00:00+02:00');
    await expect(client.schedule('TVN', start, end)).resolves.toEqual([fakty]);
    expect(sent).toEqual([
      {
        type: 'tv_guide/schedule',
        channel_id: 'TVN',
        start: '2026-10-19T03:00:00.000Z',
        end: '2026-10-20T03:00:00.000Z',
      },
    ]);
    time = NOW + 599 * SECOND;
    await client.schedule('TVN', start, end);
    expect(sent).toHaveLength(1);
    await client.schedule('TVP1', start, end);
    await client.schedule('TVN', start, end + 1);
    expect(sent).toHaveLength(3);
    time = NOW + 601 * SECOND;
    await client.schedule('TVN', start, end);
    expect(sent).toHaveLength(4);
  });

  test('airings sends programme_id and channel_ids without a limit', async () => {
    const { connection, sent } = fakeConnection(() => [fakty]);
    const client = new GuideClient(connection, undefined, clock);
    await expect(client.airings(fakty.id, ['TVN', 'TVP1'])).resolves.toEqual([fakty]);
    expect(sent).toEqual([
      { type: 'tv_guide/airings', programme_id: fakty.id, channel_ids: ['TVN', 'TVP1'] },
    ]);
  });

  test('airings are cached per programme id for 10 min', async () => {
    const { connection, sent } = fakeConnection(() => []);
    const client = new GuideClient(connection, undefined, clock);
    await client.airings('a', ['TVN']);
    time = NOW + 599 * SECOND;
    await client.airings('a', ['TVN']);
    expect(sent).toHaveLength(1);
    await client.airings('b', ['TVN']);
    expect(sent).toHaveLength(2);
    time = NOW + 601 * SECOND;
    await client.airings('a', ['TVN']);
    expect(sent).toHaveLength(3);
  });

  test('search sends the contract message and is never cached', async () => {
    const { connection, sent } = fakeConnection(() => [fakty]);
    const client = new GuideClient(connection, 'e1', clock);
    await expect(client.search('fakty', ['TVN'], 'later', 40)).resolves.toEqual([fakty]);
    await client.search('fakty', ['TVN'], 'later', 40);
    expect(sent).toEqual([
      { type: 'tv_guide/search', query: 'fakty', channel_ids: ['TVN'], when: 'later', limit: 40, entry_id: 'e1' },
      { type: 'tv_guide/search', query: 'fakty', channel_ids: ['TVN'], when: 'later', limit: 40, entry_id: 'e1' },
    ]);
  });

  test('search omits limit when not given', async () => {
    const { connection, sent } = fakeConnection(() => []);
    await new GuideClient(connection, undefined, clock).search('fakty', ['TVN'], 'now');
    expect(sent[0]).not.toHaveProperty('limit');
  });

  test('maps server errors to GuideError codes', async () => {
    const reject = (error: unknown) =>
      new GuideClient(
        { sendMessagePromise: () => Promise.reject(error) } as never,
        undefined,
        clock,
      ).info();
    const notLoaded = await reject({ code: 'not_loaded', message: 'Not loaded' }).catch((e) => e);
    expect(notLoaded).toBeInstanceOf(GuideError);
    expect(notLoaded.code).toBe('not_loaded');
    expect(notLoaded.message).toBe('Not loaded');
    await expect(reject({ code: 'not_found', message: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(reject({ code: 'invalid_format', message: 'x' })).rejects.toMatchObject({
      code: 'invalid_format',
    });
    await expect(reject({ code: 'weird', message: 'x' })).rejects.toMatchObject({ code: 'unknown' });
    await expect(reject('x')).rejects.toMatchObject({ code: 'unknown' });
    await expect(reject(new Error('socket closed'))).rejects.toMatchObject({
      code: 'unknown',
      message: 'socket closed',
    });
  });

  test('a failed request is not cached', async () => {
    let fail = true;
    const sendMessagePromise = vi.fn(() =>
      fail ? Promise.reject({ code: 'not_loaded', message: 'x' }) : Promise.resolve(channels),
    );
    const client = new GuideClient({ sendMessagePromise } as never, undefined, clock);
    await expect(client.channels()).rejects.toBeInstanceOf(GuideError);
    fail = false;
    await expect(client.channels()).resolves.toEqual(channels);
    expect(sendMessagePromise).toHaveBeenCalledTimes(2);
  });

  test('setConnection clears the caches and uses the new connection', async () => {
    const first = fakeConnection(() => channels);
    const second = fakeConnection(() => channels);
    const client = new GuideClient(first.connection, undefined, clock);
    await client.channels();
    await client.now(['TVN']);
    client.setConnection(second.connection);
    await client.channels();
    await client.now(['TVN']);
    expect(first.sent).toHaveLength(2);
    expect(second.sent).toHaveLength(2);
  });
});
