import type { ChannelConfig, TvGuideConfig } from '../config';
import type { ChannelEntry } from '../components/tvg-programme-view';
import type { Channel } from '../types/api';

/**
 * Icons of the guide by guide channel id. Channels without an icon are left out.
 * @param channels Answer of `tv_guide/channels`.
 */
export const guideIcons = (channels: Channel[]): Map<string, string> =>
  new Map(channels.flatMap((channel): [string, string][] => (channel.icon ? [[channel.id, channel.icon]] : [])));

/**
 * The logo of a channel: the one from the card config, else the icon from the guide.
 * @param channel Channel of the card config.
 * @param icons Guide icons, see `guideIcons`.
 */
export const logoOf = (channel: ChannelConfig, icons: Map<string, string>): string | undefined =>
  channel.logo ?? (channel.epg_id === undefined ? undefined : icons.get(channel.epg_id));

/**
 * The channels of the card by guide id, for the programme view. A channel without a guide id is left out.
 * When two channels share a guide id, the first one wins.
 * @param config Validated card config.
 * @param icons Guide icons, see `guideIcons`.
 */
export const channelEntries = (config: TvGuideConfig, icons: Map<string, string>): Map<string, ChannelEntry> => {
  const entries = new Map<string, ChannelEntry>();
  for (const channel of config.sections.flatMap((section) => section.channels)) {
    if (channel.epg_id === undefined || entries.has(channel.epg_id)) continue;
    entries.set(channel.epg_id, { config: channel, logo: logoOf(channel, icons) });
  }
  return entries;
};
