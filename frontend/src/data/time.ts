import type { Translate } from '../i18n';
import type { Programme } from '../types/api';
import type { HomeAssistant } from '../types/hass';

const MINUTE_MS = 60e3;
const HOUR_MS = 3600e3;
const DAY_MS = 24 * HOUR_MS;

type TimeFormat = HomeAssistant['locale']['time_format'];

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * Wall-clock date and time of an instant in a time zone.
 * @param ms Instant in milliseconds since the epoch.
 * @param timeZone IANA time zone name.
 */
const wallClock = (ms: number, timeZone: string): WallClock => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute') };
};

/** Formats a calendar date as `YYYY-MM-DD`. */
const dateKey = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Key of the calendar day `days` after a key. Works on UTC dates, so DST cannot disturb it.
 * @param key Day key, `YYYY-MM-DD`.
 * @param days Number of days to add; may be negative.
 */
const addDays = (key: string, days: number): string => dateKey(new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS));

/**
 * TV day of an instant. A TV day starts at `startHour` local time, so a programme after midnight belongs to the evening before.
 * The answer comes from `tvDayRange`, not from "minus N hours" or from the wall-clock hour: when the clocks change inside
 * those hours, only the range knows which of two equal wall-clock times starts the day.
 * @param ms Instant in milliseconds since the epoch.
 * @param timeZone IANA time zone name.
 * @param startHour Local hour at which a TV day starts.
 * @returns Day key, `YYYY-MM-DD`.
 */
export const tvDayKey = (ms: number, timeZone: string, startHour: number): string => {
  const { year, month, day } = wallClock(ms, timeZone);
  const calendarDay = dateKey(new Date(Date.UTC(year, month - 1, day)));
  return ms < tvDayRange(calendarDay, timeZone, startHour).start ? addDays(calendarDay, -1) : calendarDay;
};

/**
 * Instant at which a wall-clock time happens in a time zone.
 * The offset of the zone depends on the instant, so the guess is corrected until it settles.
 * @param key Day key, `YYYY-MM-DD`.
 * @param hour Local hour.
 * @param timeZone IANA time zone name.
 */
const zonedInstant = (key: string, hour: number, timeZone: string): number => {
  const wanted = Date.parse(`${key}T00:00:00Z`) + hour * HOUR_MS;
  const offsetAt = (ms: number): number => {
    const w = wallClock(ms, timeZone);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - (ms - (ms % MINUTE_MS));
  };
  const first = wanted - offsetAt(wanted);
  return wanted - offsetAt(first);
};

/**
 * Start and end instants of a TV day. The day can be 23, 24 or 25 hours long when the clocks change.
 * @param key Day key, `YYYY-MM-DD`.
 * @param timeZone IANA time zone name.
 * @param startHour Local hour at which a TV day starts.
 */
export const tvDayRange = (key: string, timeZone: string, startHour: number): { start: number; end: number } => ({
  start: zonedInstant(key, startHour, timeZone),
  end: zonedInstant(addDays(key, 1), startHour, timeZone),
});

/**
 * TV days that have programmes, from today on.
 * @param programmes Programmes of any channels.
 * @param todayKey Key of the current TV day.
 * @param timeZone IANA time zone name.
 * @param startHour Local hour at which a TV day starts.
 * @returns Unique day keys in ascending order.
 */
export const tvDays = (programmes: Programme[], todayKey: string, timeZone: string, startHour: number): string[] => {
  const keys = new Set(programmes.map((p) => tvDayKey(Date.parse(p.start), timeZone, startHour)));
  return [...keys].filter((key) => key >= todayKey).sort();
};

/**
 * Label of a TV day: "Today", "Tomorrow", or a short weekday with the day number, like "Wed 21".
 * @param key Day key, `YYYY-MM-DD`.
 * @param todayKey Key of the current TV day.
 * @param locale `en-GB` or `pl-PL`.
 * @param t Translate function.
 */
export const dayLabel = (key: string, todayKey: string, locale: string, t: Translate): string => {
  if (key === todayKey) return t('today');
  if (key === addDays(todayKey, 1)) return t('tomorrow');
  // Noon UTC shown in UTC: the key is a calendar date, so no time zone may move it to another day.
  return new Date(`${key}T12:00:00Z`)
    .toLocaleDateString(locale, { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
    .replace(',', '');
};

/**
 * Whether times use the 12-hour clock, from the HA profile setting.
 * `language` is the HA default; the card locales `en-GB` and `pl-PL` use the 24-hour clock.
 * @param timeFormat Value of `hass.locale.time_format`.
 */
export const hour12 = (timeFormat: TimeFormat): boolean => {
  if (timeFormat === '12') return true;
  if (timeFormat === 'system') return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 ?? false;
  return false;
};

/**
 * Time zone for the times on the card, from the HA profile setting.
 * @param hass The Home Assistant object.
 */
export const timeZoneOf = (hass: HomeAssistant): string =>
  hass.locale.time_zone === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : hass.config.time_zone;

/**
 * Clock time of an instant.
 * @param ms Instant in milliseconds since the epoch.
 * @param locale `en-GB` or `pl-PL`.
 * @param timeZone IANA time zone name.
 * @param use12Hour `true` for the 12-hour clock.
 */
export const formatTime = (ms: number, locale: string, timeZone: string, use12Hour: boolean): string =>
  new Date(ms).toLocaleTimeString(locale, {
    hour: use12Hour ? 'numeric' : '2-digit',
    minute: '2-digit',
    hourCycle: use12Hour ? 'h12' : 'h23',
    timeZone,
  });

/**
 * Length of time as text, like "45 min" or "3 h 17 min".
 * @param minutes Whole minutes.
 * @param t Translate function.
 */
export const formatDuration = (minutes: number, t: Translate): string =>
  minutes >= 60 ? t('hours', Math.floor(minutes / 60), minutes % 60) : t('minutes', minutes);

/**
 * Short text about when a programme happens: time left, time until it starts, or its day and time.
 * @param p The programme.
 * @param now Current instant in milliseconds.
 * @param todayKey Key of the current TV day.
 * @param locale `en-GB` or `pl-PL`.
 * @param timeZone IANA time zone name.
 * @param use12Hour `true` for the 12-hour clock.
 * @param startHour Local hour at which a TV day starts.
 * @param t Translate function.
 */
export const whenText = (
  p: Programme,
  now: number,
  todayKey: string,
  locale: string,
  timeZone: string,
  use12Hour: boolean,
  startHour: number,
  t: Translate,
): string => {
  const start = Date.parse(p.start);
  const stop = Date.parse(p.stop);
  if (start <= now && stop > now) return t('left', formatDuration(Math.max(1, Math.round((stop - now) / MINUTE_MS)), t));
  if (stop <= now) return t('ended');
  const key = tvDayKey(start, timeZone, startHour);
  if (key === todayKey) return t('in', formatDuration(Math.max(1, Math.round((start - now) / MINUTE_MS)), t));
  return `${dayLabel(key, todayKey, locale, t)}, ${formatTime(start, locale, timeZone, use12Hour)}`;
};

/**
 * How much of a programme has passed.
 * @param p The programme.
 * @param now Current instant in milliseconds.
 * @returns A number from 0 to 100.
 */
export const progress = (p: Programme, now: number): number => {
  const start = Date.parse(p.start);
  const stop = Date.parse(p.stop);
  return Math.min(100, Math.max(0, ((now - start) / (stop - start)) * 100));
};
