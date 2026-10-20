import { describe, expect, test } from 'vitest';
import { splitMatch } from '../../src/utils/highlight';

describe('splitMatch', () => {
  test('keeps the original case around the match', () => {
    expect(splitMatch('TVP 1 HD', 'tvp')).toEqual({ before: '', match: 'TVP', after: ' 1 HD' });
  });

  test('finds a match in the middle', () => {
    expect(splitMatch('Kino TVP Info', 'tvp')).toEqual({ before: 'Kino ', match: 'TVP', after: ' Info' });
  });

  test('matches without diacritics and keeps them in the text', () => {
    expect(splitMatch('Życie na fali', 'zycie')).toEqual({ before: '', match: 'Życie', after: ' na fali' });
  });

  test('treats ł as l', () => {
    expect(splitMatch('Pałac Łazienki', 'pal')).toEqual({ before: '', match: 'Pał', after: 'ac Łazienki' });
  });

  test('stays correct when normalization changes the length', () => {
    // "ﬁ" (one ligature character) becomes "fi" (two characters).
    expect(splitMatch('ﬁlm noir', 'noir')).toEqual({ before: 'ﬁlm ', match: 'noir', after: '' });
    expect(splitMatch('ﬁlm noir', 'fi')).toEqual({ before: '', match: 'ﬁ', after: 'lm noir' });
    expect(splitMatch('Die Straße', 'strasse')).toEqual({ before: 'Die ', match: 'Straße', after: '' });
  });

  test('keeps a combining mark inside the match', () => {
    const decomposed = 'Zycié tu';
    expect(splitMatch(decomposed, 'zycie')).toEqual({ before: '', match: 'Zycié', after: ' tu' });
  });

  test('treats special characters as plain text', () => {
    expect(splitMatch('Mecz (finał) *', '(fin')).toEqual({ before: 'Mecz ', match: '(fin', after: 'ał) *' });
    expect(splitMatch('Mecz (finał) *', '*')).toEqual({ before: 'Mecz (finał) ', match: '*', after: '' });
  });

  test('gives null for an empty query or no match', () => {
    expect(splitMatch('TVP 1 HD', '')).toBeNull();
    expect(splitMatch('TVP 1 HD', 'xyz')).toBeNull();
  });
});
