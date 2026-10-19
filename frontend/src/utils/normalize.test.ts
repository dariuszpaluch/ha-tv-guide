import { expect, test } from 'vitest';
import { normalize } from './normalize';

// The integration has the same cases in tests/test_search.py: both sides must agree.
test.each([
  ['  Życie ŁÓDŹ ', 'zycie lodz'],
  ['Straße', 'strasse'],
  ['Kırmızı', 'kirmizi'],
  ['Søren', 'soren'],
  ['Đoković', 'dokovic'],
  ['Æble', 'aeble'],
  ['Œuvre', 'oeuvre'],
])('normalize(%j) is %j', (text, expected) => {
  expect(normalize(text)).toBe(expected);
});
