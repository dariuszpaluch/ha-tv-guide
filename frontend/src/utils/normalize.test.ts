import { expect, test } from 'vitest';
import { normalize } from './normalize';

test('normalize ignores case, diacritics and outer spaces', () => {
  expect(normalize('  Życie ŁÓDŹ ')).toBe('zycie lodz');
});
