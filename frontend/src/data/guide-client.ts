import type { Channel, GuideErrorCode, GuideInfo, NowMap, Programme, SearchWhen } from '../types/api';
import type { HomeAssistant } from '../types/hass';

type Connection = Pick<HomeAssistant['connection'], 'sendMessagePromise'>;

interface CacheEntry<T> {
  expiresAt: number;
  value: Promise<T>;
}

const SECOND = 1000;
const NOW_TTL = 60 * SECOND;
const LONG_TTL = 10 * 60 * SECOND;
const KNOWN_CODES: readonly GuideErrorCode[] = ['not_found', 'not_loaded', 'invalid_format'];

/** An error from the integration. `code` is a contract error code, or `unknown` for anything else. */
export class GuideError extends Error {
  readonly code: GuideErrorCode | 'unknown';

  constructor(code: GuideErrorCode | 'unknown', message: string) {
    super(message);
    this.name = 'GuideError';
    this.code = code;
  }
}

/**
 * Turns whatever `sendMessagePromise` rejected with into a `GuideError`.
 * HA rejects with a plain object `{ code, message }`, not with an `Error`.
 */
const toGuideError = (error: unknown): GuideError => {
  if (error instanceof GuideError) return error;
  const { code, message } = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown;
    message?: unknown;
  };
  const known = KNOWN_CODES.find((candidate) => candidate === code);
  const text = typeof message === 'string' ? message : typeof error === 'string' ? error : 'Unknown error';
  return new GuideError(known ?? 'unknown', text);
};

/** Typed client for the `tv_guide/*` WebSocket commands, with small in-memory caches. */
export class GuideClient {
  private caches = new Map<string, CacheEntry<unknown>>();

  /**
   * @param connection HA connection used to send messages.
   * @param entryId Config entry id; sent only when set.
   * @param clock Current time in ms; injected so tests control the cache expiry.
   */
  constructor(
    private connection: Connection,
    private readonly entryId?: string,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Replaces the connection (HA gives a new one after a reconnect) and drops all cached answers. */
  setConnection(connection: Connection): void {
    this.connection = connection;
    this.caches.clear();
  }

  /** Time of the last good download and the update interval. */
  info(): Promise<GuideInfo> {
    return this.send<GuideInfo>('tv_guide/info');
  }

  /** The selected channels. Never cached: the card asks on every refresh, so a changed selection shows up. */
  channels(): Promise<Channel[]> {
    return this.send<Channel[]>('tv_guide/channels');
  }

  /** The programme on air for each channel. Cached for 60 s; `force` skips the cache. */
  now(channelIds: string[], options: { force?: boolean } = {}): Promise<NowMap> {
    const key = `now:${JSON.stringify([...channelIds].sort())}`;
    const load = () => this.send<NowMap>('tv_guide/now', { channel_ids: channelIds });
    return options.force ? this.store(key, NOW_TTL, load) : this.cached(key, NOW_TTL, load);
  }

  /** Programmes of one channel that overlap `[start, end)`. Times are in ms. Cached for 10 min. */
  schedule(channelId: string, start: number, end: number): Promise<Programme[]> {
    return this.cached(`schedule:${channelId}:${start}:${end}`, LONG_TTL, () =>
      this.send<Programme[]>('tv_guide/schedule', {
        channel_id: channelId,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      }),
    );
  }

  /** Programme search. Never cached. Without `limit` the server default applies. */
  search(query: string, channelIds: string[], when: SearchWhen, limit?: number): Promise<Programme[]> {
    return this.send<Programme[]>('tv_guide/search', {
      query,
      channel_ids: channelIds,
      when,
      ...(limit === undefined ? {} : { limit }),
    });
  }

  /** Other airings of a programme. Cached per programme id for 10 min. Uses the server default limit. */
  airings(programmeId: string, channelIds: string[]): Promise<Programme[]> {
    return this.cached(`airings:${programmeId}`, LONG_TTL, () =>
      this.send<Programme[]>('tv_guide/airings', { programme_id: programmeId, channel_ids: channelIds }),
    );
  }

  private send<T>(type: string, fields: Record<string, unknown> = {}): Promise<T> {
    const message = { type, ...fields, ...(this.entryId === undefined ? {} : { entry_id: this.entryId }) };
    return this.connection.sendMessagePromise<T>(message).catch((error: unknown) => {
      throw toGuideError(error);
    });
  }

  /** Returns the cached answer while it is fresh, otherwise loads and stores a new one. */
  private cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const entry = this.caches.get(key) as CacheEntry<T> | undefined;
    if (entry && entry.expiresAt > this.clock()) return entry.value;
    return this.store(key, ttl, load);
  }

  /** Loads a new answer and caches it. A failed request is removed, so the next call retries. */
  private store<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const entry: CacheEntry<T> = { expiresAt: this.clock() + ttl, value: load() };
    this.caches.set(key, entry);
    entry.value.catch(() => {
      if (this.caches.get(key) === entry) this.caches.delete(key);
    });
    return entry.value;
  }
}
