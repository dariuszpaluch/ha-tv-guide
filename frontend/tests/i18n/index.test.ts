import { expect, test } from 'vitest';
import { en } from '../../src/i18n/en';
import { localeOf, resolveLanguage, translator } from '../../src/i18n/index';
import { pl } from '../../src/i18n/pl';

test('resolveLanguage and localeOf', () => {
  expect(resolveLanguage('pl')).toBe('pl');
  expect(resolveLanguage('pl-PL')).toBe('pl');
  expect(resolveLanguage('de')).toBe('en');
  expect(resolveLanguage(undefined)).toBe('en');
  expect(localeOf('en')).toBe('en-GB');
  expect(localeOf('pl')).toBe('pl-PL');
});

test('translator fills values', () => {
  expect(translator('pl')('switchTo', 3)).toBe('Przełącz na 3');
  expect(translator('en')('earlier', 14)).toBe('Show 14 earlier');
  expect(translator('pl')('showAll', 22)).toBe('Pokaż wszystkie (22)');
  expect(translator('en')('notLoaded')).toBe('The guide is not loaded yet.');
  expect(translator('en')('switchFailed', 'TVN', 'offline')).toBe('Cannot switch to TVN: offline');
});

test('pl has every key of en', () => {
  expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort());
});
