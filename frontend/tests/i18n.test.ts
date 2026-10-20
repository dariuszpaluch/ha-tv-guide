import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { format, localeOf, resolveLanguage, translator } from '../src/i18n';

const FOLDER = join(__dirname, '..', 'i18n');
const METADATA = '@metadata';

/** Reads one file of `frontend/i18n/` as plain data. */
const readFile = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FOLDER, name), 'utf8')) as Record<string, unknown>;

/** The keys of a file, without `@metadata`. */
const keysOf = (file: Record<string, unknown>): string[] => Object.keys(file).filter((key) => key !== METADATA).sort();

/** The `{placeholder}` names in a string, sorted. */
const placeholdersOf = (text: unknown): string[] =>
  [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();

const en = readFile('en.json');
const notes = readFile('qqq.json');
const languages = readdirSync(FOLDER).filter((name) => name.endsWith('.json') && name !== 'qqq.json');

describe('language and locale', () => {
  test('resolveLanguage finds the file for a Home Assistant language', () => {
    expect(resolveLanguage('pl')).toBe('pl');
    expect(resolveLanguage('pl-PL')).toBe('pl');
    expect(resolveLanguage('PL')).toBe('pl');
    expect(resolveLanguage('de')).toBe('en');
    expect(resolveLanguage(undefined)).toBe('en');
  });

  test('the translator notes are not a language', () => {
    expect(resolveLanguage('qqq')).toBe('en');
  });

  test('localeOf gives English the 24-hour clock and the day before the month', () => {
    expect(localeOf('en')).toBe('en-GB');
    expect(localeOf('pl')).toBe('pl');
  });
});

describe('translator', () => {
  test('fills in the placeholders', () => {
    expect(translator('pl')('switchTo', { channel_number: 3 })).toBe('Przełącz na 3');
    expect(translator('en')('showAll', { count: 14 })).toBe('Show all (14)');
    expect(translator('pl')('showAll', { count: 22 })).toBe('Pokaż wszystkie (22)');
    expect(translator('en')('notLoaded')).toBe('The guide is not loaded yet.');
    expect(translator('en')('switchFailed', { channel_name: 'TVN', error: 'offline' })).toBe(
      'Cannot switch to TVN: offline',
    );
  });

  test('an unknown language gets English', () => {
    expect(translator('de')('close')).toBe('Close');
  });

  test('format keeps a placeholder without a value, so the gap is visible', () => {
    expect(format('Switch to {channel_number}', {})).toBe('Switch to {channel_number}');
    expect(format('{hours} h {minutes} min', { hours: 1, minutes: 5 })).toBe('1 h 5 min');
  });
});

describe('translation files', () => {
  test('there are English and Polish', () => {
    expect(languages).toEqual(expect.arrayContaining(['en.json', 'pl.json']));
  });

  test.each(languages)('%s has the same keys as en.json', (name) => {
    expect(keysOf(readFile(name))).toEqual(keysOf(en));
  });

  test.each(languages)('%s uses the same placeholders as en.json', (name) => {
    const file = readFile(name);
    for (const key of keysOf(en)) expect(placeholdersOf(file[key]), key).toEqual(placeholdersOf(en[key]));
  });

  test.each([...languages, 'qqq.json'])('%s names its authors', (name) => {
    const metadata = readFile(name)[METADATA] as { authors?: unknown } | undefined;
    expect(Array.isArray(metadata?.authors) && metadata.authors.length > 0).toBe(true);
  });

  test('qqq.json has a note for each key, and no other keys', () => {
    expect(keysOf(notes)).toEqual(keysOf(en));
    for (const key of keysOf(en)) expect(typeof notes[key], key).toBe('string');
  });

  test('qqq.json explains each placeholder', () => {
    for (const key of keysOf(en)) {
      for (const name of placeholdersOf(en[key])) expect(String(notes[key]), key).toContain(`{${name}}`);
    }
  });
});
