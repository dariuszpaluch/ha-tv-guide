import type { GuideInfo } from '../types/api';
import { formatTime } from './time';

const HOUR_MS = 3600e3;
/** The guide is stale when this many update intervals passed without a good download. */
const STALE_AFTER_INTERVALS = 2;

/**
 * Whether the last good download is older than two update intervals.
 * @param info Answer of `tv_guide/info`.
 * @param now Current instant in milliseconds.
 */
export const isStale = (info: GuideInfo, now: number): boolean =>
  now - Date.parse(info.last_success) > STALE_AFTER_INTERVALS * info.update_interval * HOUR_MS;

/**
 * Day and time of the last good download, like "17 Oct, 12:30".
 * @param info Answer of `tv_guide/info`.
 * @param locale A locale from `localeOf`, such as `en-GB` or `pl`.
 * @param timeZone IANA time zone name.
 * @param use12Hour `true` for the 12-hour clock.
 */
export const formatLastSuccess = (info: GuideInfo, locale: string, timeZone: string, use12Hour: boolean): string => {
  const ms = Date.parse(info.last_success);
  const day = new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone });
  return `${day}, ${formatTime(ms, locale, timeZone, use12Hour)}`;
};
