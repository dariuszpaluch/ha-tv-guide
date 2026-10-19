import { channelIds, type ChannelConfig, type TvGuideConfig } from '../config';
import { GuideError, type GuideClient } from './guide-client';
import type { GuideErrorCode, Programme } from '../types/api';
import { normalize } from '../utils/normalize';

/** What the search box shows. `null` means that step is still running. */
export interface SearchResults {
  /** The normalized query these results belong to. */
  query: string;
  /** Step 1: channels by number or name. */
  channels: ChannelConfig[];
  /** Step 2: programmes on air now. */
  now: Programme[] | null;
  /** Step 3: later programmes, soonest first. */
  later: Programme[] | null;
  /** Set when a server step failed. That step then has an empty list. */
  error?: GuideErrorCode | 'unknown';
}

const PROGRAMME_SEARCH_MIN = 2;
const LATER_LIMIT = 40;
/** The most the server allows. A name that matches on many channels must not be cut. */
const NOW_LIMIT = 100;

const configChannels = (config: TvGuideConfig): ChannelConfig[] => config.sections.flatMap((section) => section.channels);

/**
 * Step 1: channels whose number starts with the query or whose name contains it.
 * A blank query matches nothing, so an empty search box shows the normal channel list.
 * @param channels Channels of the card config.
 * @param query Text typed by the user.
 */
export const matchChannels = (channels: ChannelConfig[], query: string): ChannelConfig[] => {
  const text = normalize(query);
  if (text === '') return [];
  return channels.filter((channel) => String(channel.number).startsWith(text) || normalize(channel.name).includes(text));
};

/**
 * Runs the three search steps. Channels are ready at once; the two server steps update on their own.
 * A newer `run` or `cancel` makes every older answer stale, and stale answers never reach `onUpdate`.
 */
export class SearchRunner {
  private runId = 0;

  /**
   * @param search The `search` method of the guide client.
   * @param onUpdate Called after each step with the results so far.
   */
  constructor(
    private readonly search: GuideClient['search'],
    private readonly onUpdate: (results: SearchResults) => void,
  ) {}

  /**
   * Starts a search and cancels the previous one.
   * Below 2 characters the server is not called and `now` and `later` are `[]`.
   * @param query Text typed by the user.
   * @param config Validated card config.
   */
  run(query: string, config: TvGuideConfig): void {
    const runId = ++this.runId;
    const text = normalize(query);
    let results: SearchResults = { query: text, channels: matchChannels(configChannels(config), text), now: null, later: null };

    if (text.length < PROGRAMME_SEARCH_MIN) {
      this.onUpdate({ ...results, now: [], later: [] });
      return;
    }
    this.onUpdate(results);

    const ids = channelIds(config);
    const step = (key: 'now' | 'later', request: Promise<Programme[]>): void => {
      const finish = (change: Partial<SearchResults>): void => {
        if (runId !== this.runId) return;
        results = { ...results, ...change };
        this.onUpdate(results);
      };
      request.then(
        (programmes) => finish({ [key]: programmes }),
        (error: unknown) => finish({ [key]: [], error: errorCode(error) }),
      );
    };
    step('now', this.search(text, ids, 'now', NOW_LIMIT));
    step('later', this.search(text, ids, 'later', LATER_LIMIT));
  }

  /** Makes the running search stale. Its answers are ignored. */
  cancel(): void {
    this.runId++;
  }
}

/** The contract error code of a failed request, or `unknown`. */
const errorCode = (error: unknown): GuideErrorCode | 'unknown' => (error instanceof GuideError ? error.code : 'unknown');

/**
 * The channel that Enter switches to: the first channel result,
 * else the channel of the first `now` programme, else of the first `later` programme.
 * @param results Current search results.
 * @param config Validated card config.
 */
export const firstResult = (results: SearchResults, config: TvGuideConfig): ChannelConfig | undefined => {
  if (results.channels[0]) return results.channels[0];
  const channels = configChannels(config);
  for (const programme of [...(results.now ?? []), ...(results.later ?? [])]) {
    const channel = channels.find((candidate) => candidate.epg_id === programme.channel_id);
    if (channel) return channel;
  }
  return undefined;
};
