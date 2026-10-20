/** Types of the API contract between the integration and the card. Field names match `docs/api.md`. */

export interface Channel {
  id: string;
  name: string;
  /** URL of the guide icon, or `null` when the guide has none. */
  icon: string | null;
}

/** Times are ISO 8601 strings with the offset of the source. */
export interface Programme {
  /** `<channel_id>|<start in UTC, YYYY-MM-DDTHH:MM:SSZ>` */
  id: string;
  channel_id: string;
  start: string;
  stop: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  episode: string | null;
  categories: string[];
  /** HA path of the poster without a size; the card adds `/thumb` or `/large`. */
  image: string | null;
  /** `null` when the source says no age limit. */
  rating: string | null;
  star_rating: string | null;
  year: string | null;
  countries: string[];
}

export interface GuideInfo {
  last_success: string;
  /** Hours. */
  update_interval: number;
}

/** A reminder belonging to the user of the connection. */
export interface Reminder {
  programme_id: string;
  channel_id: string;
  title: string;
  start: string;
}

/** Full reminder list and notification phone names for the user of the connection. */
export interface Reminders {
  reminders: Reminder[];
  phones: string[];
}

/** Answer of `tv_guide/now`: a channel without a programme on air has `null`. */
export type NowMap = Record<string, Programme | null>;

export type SearchWhen = 'now' | 'later';

export type GuideErrorCode = 'not_found' | 'not_loaded' | 'invalid_format' | 'too_late';
