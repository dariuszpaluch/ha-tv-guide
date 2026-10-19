import { css, html, type TemplateResult } from 'lit';

/** Material Design Icons paths (24x24). */
export const ICON = {
  search:
    'M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z',
  close:
    'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z',
  tv: 'M8,3L12,7L16,3L17,4L14,7H21A1,1 0 0,1 22,8V20A1,1 0 0,1 21,21H3A1,1 0 0,1 2,20V8A1,1 0 0,1 3,7H10L7,4L8,3M4,9V19H20V9H4Z',
  play: 'M8,5.14V19.14L19,12.14L8,5.14Z',
  back: 'M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z',
  chevron: 'M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z',
} as const;

/**
 * An inline icon. Style it with `iconStyles`.
 * @param name Key of `ICON`.
 */
export const icon = (name: keyof typeof ICON): TemplateResult =>
  html`<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d=${ICON[name]}></path></svg>`;

export const iconStyles = css`
  svg.i {
    width: 22px;
    height: 22px;
    fill: currentColor;
    flex: none;
  }
`;
