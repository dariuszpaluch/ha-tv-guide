import { en, type Strings } from './en';
import { pl } from './pl';

export { en, pl };
export type { Strings };

export type Language = 'en' | 'pl';

/** Translate a key; keys with a function take its values as the next arguments. */
export type Translate = <K extends keyof Strings>(
  key: K,
  ...values: Strings[K] extends (...args: infer A) => string ? A : []
) => string;

const LOCALES: Record<Language, 'en-GB' | 'pl-PL'> = { en: 'en-GB', pl: 'pl-PL' };

/**
 * Language of the card for a Home Assistant language code. Anything that is not Polish is English.
 * @param language For example `pl`, `pl-PL` or `de`.
 */
export const resolveLanguage = (language?: string): Language =>
  language?.toLowerCase().startsWith('pl') ? 'pl' : 'en';

/**
 * Locale for dates and times. Both locales use the 24-hour clock and the day before the month.
 * @param language A supported card language.
 */
export const localeOf = (language: Language): 'en-GB' | 'pl-PL' => LOCALES[language];

/**
 * Builds the `t()` function for a language.
 * @param language Home Assistant language code; unsupported codes give English.
 */
export const translator = (language?: string): Translate => {
  const table: Strings = resolveLanguage(language) === 'pl' ? pl : en;
  return (key, ...values) => {
    const entry = table[key];
    return typeof entry === 'function' ? (entry as (...args: unknown[]) => string)(...values) : entry;
  };
};
