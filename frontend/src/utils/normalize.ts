/**
 * Letters that NFKD does not split into a base letter and a mark ("Title matching" in `docs/api.md`).
 * The integration has the same table in `search.py`.
 */
const FOLD: Record<string, string> = { ł: 'l', ß: 'ss', ı: 'i', ø: 'o', đ: 'd', æ: 'ae', œ: 'oe' };
const FOLD_PATTERN = new RegExp(`[${Object.keys(FOLD).join('')}]`, 'gu');

/**
 * Text for matching: lower case, no diacritics, a few letters folded, no outer spaces.
 * The integration uses the same rule (see "Title matching" in `docs/api.md`).
 * @param text Any text, for example a title typed by the user.
 */
export const normalize = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(FOLD_PATTERN, (letter) => FOLD[letter] ?? letter)
    .trim();
