import { normalize } from './normalize';

/** A text cut in three parts around the match. The parts keep the original case and accents. */
export interface TextMatch {
  before: string;
  match: string;
  after: string;
}

/** Normal form of one character. Normalizing a lone space would trim it away, so spaces stay. */
const foldChar = (char: string): string => (/^\s$/u.test(char) ? ' ' : normalize(char));

/**
 * Finds a query in a text, ignoring case and diacritics, and cuts the ORIGINAL text around the match.
 * Normalization can change the length (`ﬁ` becomes `fi`, an accent mark disappears), so the text is
 * normalized one character at a time and each normalized position points back to its original one.
 * @param text Original text, for example a programme title.
 * @param query Search query. It is normalized here, so a normalized one also works.
 * @returns The three parts, or `null` for an empty query or no match.
 */
export const splitMatch = (text: string, query: string): TextMatch | null => {
  const needle = normalize(query);
  if (!needle) return null;

  const chars = [...text];
  const starts: number[] = []; // original offset of the character behind each normalized position
  const ends: number[] = []; // original offset just after that character
  let folded = '';
  let offset = 0;
  for (const char of chars) {
    const part = foldChar(char);
    for (let i = 0; i < part.length; i += 1) {
      starts.push(offset);
      ends.push(offset + char.length);
    }
    folded += part;
    offset += char.length;
  }

  const at = folded.indexOf(needle);
  const first = starts[at];
  const last = ends[at + needle.length - 1];
  if (at < 0 || first === undefined || last === undefined) return null;

  // A mark that normalizes to nothing (an accent after its letter) belongs to the letter before it.
  let end = last;
  for (const char of text.slice(last)) {
    if (foldChar(char) !== '') break;
    end += char.length;
  }
  return { before: text.slice(0, first), match: text.slice(first, end), after: text.slice(end) };
};
