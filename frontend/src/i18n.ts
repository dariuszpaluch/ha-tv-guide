/// <reference types="vite/client" />
import en from '../i18n/en.json';

/** A key of the card texts. `@metadata` names the authors and is not a text. */
export type MessageKey = Exclude<keyof typeof en, '@metadata'>;

/** Values for the `{placeholders}` of a text. */
export type MessageValues = Readonly<Record<string, string | number>>;

/** Translate a key and fill in its placeholders. */
export type Translate = (key: MessageKey, values?: MessageValues) => string;

type Messages = Partial<Record<MessageKey, string>>;

const FALLBACK = 'en';
const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * The texts of one file: string values only, without `@metadata`.
 * @param file Content of a JSON file in `frontend/i18n/`.
 */
const messagesOf = (file: Record<string, unknown>): Messages =>
  Object.fromEntries(Object.entries(file).filter(([key, value]) => key !== '@metadata' && typeof value === 'string'));

// Vite finds every file at build time, so a new language is one new JSON file.
// `qqq.json` holds the notes for translators: it is not a language, and users do not need it.
const FILES = import.meta.glob<Record<string, unknown>>(['../i18n/*.json', '!../i18n/qqq.json'], {
  eager: true,
  import: 'default',
});

const TABLES: ReadonlyMap<string, Messages> = new Map(
  Object.entries(FILES)
    .map(([path, file]) => [path.replace(/^.*\/|\.json$/g, '').toLowerCase(), messagesOf(file)] as const),
);

const ENGLISH = messagesOf(en);

/**
 * The card language for a Home Assistant language code: the file with the same name, then the file of the
 * base language (`pl` for `pl-PL`), then English.
 * @param language For example `pl`, `pl-PL` or `de`.
 */
export const resolveLanguage = (language?: string): string => {
  const code = language?.toLowerCase() ?? FALLBACK;
  if (TABLES.has(code)) return code;
  const base = code.split('-')[0] ?? FALLBACK;
  return TABLES.has(base) ? base : FALLBACK;
};

/**
 * Locale for dates and times. English uses `en-GB`, so it has the 24-hour clock and the day before the month.
 * @param language A card language from `resolveLanguage`.
 */
export const localeOf = (language: string): string => (language === FALLBACK ? 'en-GB' : language);

/**
 * Fills in the `{placeholders}` of a text. A placeholder without a value stays, so the gap is visible.
 * @param text A text with placeholders, such as `Switch to {channel_number}`.
 * @param values The value for each placeholder.
 */
export const format = (text: string, values: MessageValues = {}): string =>
  text.replace(PLACEHOLDER, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });

/**
 * Builds the `t()` function for a language. A key missing in the language uses the English text.
 * @param language Home Assistant language code; unsupported codes give English.
 */
export const translator = (language?: string): Translate => {
  const table = TABLES.get(resolveLanguage(language)) ?? ENGLISH;
  return (key, values) => format(table[key] ?? ENGLISH[key] ?? key, values);
};
