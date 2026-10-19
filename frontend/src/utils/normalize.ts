/**
 * Text for matching: lower case, no diacritics, `ł` as `l`, no outer spaces.
 * The integration uses the same rule (see "Title matching" in `docs/api.md`).
 * @param text Any text, for example a title typed by the user.
 */
export const normalize = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll('ł', 'l')
    .trim();
