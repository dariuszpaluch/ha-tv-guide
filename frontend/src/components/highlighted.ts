import { html, type TemplateResult } from 'lit';
import { splitMatch } from '../utils/highlight';

/**
 * Text with the part that matches a search query wrapped in `<mark>`.
 * @param text Original text.
 * @param query Search query, already normalized or not.
 */
export const highlighted = (text: string, query: string): TemplateResult => {
  const parts = splitMatch(text, query);
  return parts ? html`${parts.before}<mark>${parts.match}</mark>${parts.after}` : html`${text}`;
};
