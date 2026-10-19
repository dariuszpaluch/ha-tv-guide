/** Logo tile colour behind a channel logo. */
export type LogoTile = 'dark' | 'light';

/**
 * Channel number on the box: a whole number, or text for numbers such as the US sub-channel `5.1`.
 * Text keeps what the user wrote; YAML would turn an unquoted 5.10 into the float 5.1.
 */
export type ChannelNumber = number | string;

/** One channel in the card config. */
export interface ChannelConfig {
  number: ChannelNumber;
  name: string;
  /** XMLTV channel id. Without it the channel shows "No guide". */
  epg_id?: string;
  logo?: string;
  logo_tile?: LogoTile;
}

/** A titled group of channels. */
export interface SectionConfig {
  title?: string;
  channels: ChannelConfig[];
}

/** HA action that switches the TV to a channel. */
export interface SwitchAction {
  perform_action: string;
  data?: Record<string, unknown>;
}

/** The validated card config. */
export interface TvGuideConfig {
  type: string;
  entry_id?: string;
  switch_action: SwitchAction;
  tv_day_starts_at: number;
  height: string;
  sections: SectionConfig[];
}

/** A service call ready for `hass.callService`. */
export interface ServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
}

const DEFAULT_TV_DAY_STARTS_AT = 5;
const CARD_TYPE = 'custom:tv-guide';
const DEFAULT_HEIGHT = '600px';
const LAST_HOUR_OF_DAY = 23;
const NUMBER_PLACEHOLDER = '{number}';

const LOGO_TILES: readonly LogoTile[] = ['dark', 'light'];

type Dict = Record<string, unknown>;

const isRecord = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Builds a config error. Config errors are for the dashboard author, so they are English and skip `t()`.
 * @param where Which part of the config the error is about, e.g. `channel "BBC"`. Empty for the top level.
 * @param message What is wrong.
 */
const configError = (where: string, message: string): Error =>
  new Error(`tv-guide: ${where ? `${where}: ` : ''}${message}`);

/**
 * Throws when `value` has a key that is not in `allowed`.
 * @param value Config object to check.
 * @param allowed Keys that may appear.
 * @param where Error context, see `configError`.
 */
const assertKnownKeys = (value: Dict, allowed: readonly string[], where: string): void => {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw configError(where, `unknown key "${unknown}"`);
};

/** Reads an optional string field. */
const optionalString = (value: Dict, key: string, where: string): string | undefined => {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== 'string') throw configError(where, `"${key}" must be a string`);
  return field;
};

/** Reads a required string field. */
const requiredString = (value: Dict, key: string, where: string): string => {
  if (value[key] === undefined) throw configError(where, `"${key}" is required`);
  return optionalString(value, key, where) as string;
};

/** Reads a required list field. */
const requiredList = (value: Dict, key: string, where: string): unknown[] => {
  const field = value[key];
  if (field === undefined) throw configError(where, `"${key}" is required`);
  if (!Array.isArray(field)) throw configError(where, `"${key}" must be a list`);
  return field;
};

/**
 * Reads a channel number: a whole number, or trimmed text.
 * @param raw `number` from the YAML.
 * @param where Name of the channel, for the error message.
 */
const channelNumber = (raw: unknown, where: string): ChannelNumber => {
  if (raw === undefined) throw configError(where, '"number" is required');
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) throw configError(where, '"number" must not be empty');
    return text;
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    throw configError(where, '"number" must be a whole number, or text in quotes such as "5.1"');
  }
  return raw;
};

/**
 * Validates one channel.
 * @param raw Channel from the YAML.
 * @param index Position in its section, used when the channel has no name.
 */
const validateChannel = (raw: unknown, index: number): ChannelConfig => {
  if (!isRecord(raw)) throw configError(`channel at position ${index + 1}`, 'must be an object');
  const where =
    typeof raw.name === 'string'
      ? `channel "${raw.name}"`
      : typeof raw.number === 'number' || typeof raw.number === 'string'
        ? `channel ${raw.number}`
        : `channel at position ${index + 1}`;
  assertKnownKeys(raw, ['number', 'name', 'epg_id', 'logo', 'logo_tile'], where);
  const number = channelNumber(raw.number, where);
  const logoTile = raw.logo_tile;
  if (logoTile !== undefined && !LOGO_TILES.includes(logoTile as LogoTile)) {
    throw configError(where, '"logo_tile" must be "dark" or "light"');
  }
  return {
    number,
    name: requiredString(raw, 'name', where),
    epg_id: optionalString(raw, 'epg_id', where),
    logo: optionalString(raw, 'logo', where),
    logo_tile: logoTile as LogoTile | undefined,
  };
};

/**
 * Validates one section.
 * @param raw Section from the YAML.
 * @param index Position in `sections`, used when the section has no title.
 */
const validateSection = (raw: unknown, index: number): SectionConfig => {
  if (!isRecord(raw)) throw configError(`section ${index + 1}`, 'must be an object');
  const where = typeof raw.title === 'string' ? `section "${raw.title}"` : `section ${index + 1}`;
  assertKnownKeys(raw, ['title', 'channels'], where);
  return {
    title: optionalString(raw, 'title', where),
    channels: requiredList(raw, 'channels', where).map(validateChannel),
  };
};

/** Validates the `switch_action` block. */
const validateSwitchAction = (raw: unknown): SwitchAction => {
  if (raw === undefined) throw configError('', '"switch_action" is required');
  if (!isRecord(raw)) throw configError('', '"switch_action" must be an object');
  assertKnownKeys(raw, ['perform_action', 'data'], '"switch_action"');
  if (raw.perform_action === undefined) throw configError('', '"switch_action.perform_action" is required');
  if (typeof raw.perform_action !== 'string' || !/^[^.\s]+\.[^.\s]+$/.test(raw.perform_action)) {
    throw configError('', '"switch_action.perform_action" must be "domain.service"');
  }
  if (raw.data !== undefined && !isRecord(raw.data)) {
    throw configError('', '"switch_action.data" must be an object');
  }
  return { perform_action: raw.perform_action, data: raw.data };
};

/**
 * Checks the raw card config from the dashboard and fills the defaults.
 * @param raw Config object as HA passes it to `setConfig`.
 * @throws Error with a message that starts with `tv-guide: ` and names the bad field.
 */
export const validateConfig = (raw: unknown): TvGuideConfig => {
  if (!isRecord(raw)) throw configError('', 'the card config must be an object');
  assertKnownKeys(raw, ['type', 'entry_id', 'switch_action', 'tv_day_starts_at', 'height', 'sections'], '');
  const switchAction = validateSwitchAction(raw.switch_action);
  const sections = requiredList(raw, 'sections', '').map(validateSection);

  const startsAt = raw.tv_day_starts_at ?? DEFAULT_TV_DAY_STARTS_AT;
  if (!Number.isInteger(startsAt) || (startsAt as number) < 0 || (startsAt as number) > LAST_HOUR_OF_DAY) {
    throw configError('', `"tv_day_starts_at" must be a whole number from 0 to ${LAST_HOUR_OF_DAY}`);
  }

  return {
    type: optionalString(raw, 'type', '') ?? CARD_TYPE,
    entry_id: optionalString(raw, 'entry_id', ''),
    switch_action: switchAction,
    tv_day_starts_at: startsAt as number,
    height: optionalString(raw, 'height', '') ?? DEFAULT_HEIGHT,
    sections,
  };
};

/**
 * Puts the channel number into a config value.
 * A string that is exactly `{number}` becomes the number. In a longer string it becomes text.
 * Objects and lists are handled deeply.
 */
const fillNumber = (value: unknown, number: ChannelNumber): unknown => {
  if (typeof value === 'string') {
    return value === NUMBER_PLACEHOLDER ? number : value.replaceAll(NUMBER_PLACEHOLDER, String(number));
  }
  if (Array.isArray(value)) return value.map((item) => fillNumber(item, number));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillNumber(item, number)]));
  }
  return value;
};

/**
 * Builds the service call that switches the TV to a channel.
 * @param config Validated card config.
 * @param number Channel number to switch to.
 */
export const switchServiceCall = (config: TvGuideConfig, number: ChannelNumber): ServiceCall => {
  const [domain = '', service = ''] = config.switch_action.perform_action.split('.');
  const data = fillNumber(config.switch_action.data ?? {}, number) as Record<string, unknown>;
  return { domain, service, data };
};

/**
 * Unique XMLTV channel ids of the card config, in config order.
 * @param config Validated card config.
 */
export const channelIds = (config: TvGuideConfig): string[] => {
  const ids = config.sections.flatMap((section) => section.channels.map((channel) => channel.epg_id));
  return [...new Set(ids.filter((id): id is string => id !== undefined))];
};
