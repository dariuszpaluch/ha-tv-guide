import { expect, test } from 'vitest';
import { normalize } from '../../src/utils/normalize';

// The integration has the same cases in tests/test_search.py: both sides must agree.
test.each([
  ['  Życie ŁÓDŹ ', 'zycie lodz'],
  ['Straße', 'strasse'],
  ['Kırmızı', 'kirmizi'],
  ['Søren', 'soren'],
  ['Đoković', 'dokovic'],
  ['Æble', 'aeble'],
  ['Œuvre', 'oeuvre'],
  // Only non-spacing marks (Mn) go. The Devanagari vowel sign in "की" is a spacing mark (Mc), so it stays.
  ['की', 'की'],
  ['กำ', 'กา'],
  ['ที่', 'ท'],
])('normalize(%j) is %j', (text, expected) => {
  expect(normalize(text)).toBe(expected);
});
