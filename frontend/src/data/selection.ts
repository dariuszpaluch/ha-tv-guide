import type { ChannelConfig } from '../config';

/**
 * True when the card lists a guide id that the integration does not keep. The user has to tick the
 * channel in the integration options too; saying so is more helpful than a plain "No guide".
 * @param channel Channel of the card config.
 * @param kept Guide ids from `tv_guide/channels`; `undefined` until they are loaded.
 */
export const notSelected = (channel: ChannelConfig, kept: ReadonlySet<string> | undefined): boolean =>
  kept !== undefined && channel.epg_id !== undefined && !kept.has(channel.epg_id);
