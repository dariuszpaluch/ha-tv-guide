import { css, html, type ReactiveControllerHost, type TemplateResult } from 'lit';
import type { ChannelConfig } from '../config';
import type { Translate } from '../i18n';
import { tvDayRange } from '../data/time';
import type { Programme } from '../types/api';
import { fire } from './events';
import { icon, iconStyles } from './icons';
import './tvg-logo';

/**
 * Whether a programme belongs to a TV day. A programme that overlaps the day range belongs to it,
 * so one that crosses the day start (04:30-05:30) is on both days. The server lists days the same way.
 * @param programme The programme.
 * @param key Day key, `YYYY-MM-DD`.
 * @param timeZone IANA time zone name.
 * @param startHour Local hour at which a TV day starts.
 */
export const overlapsDay = (programme: Programme, key: string, timeZone: string, startHour: number): boolean => {
  const range = tvDayRange(key, timeZone, startHour);
  return Date.parse(programme.start) < range.end && Date.parse(programme.stop) > range.start;
};

/** Remembers which poster URLs failed to load, so the view shows the placeholder instead. */
export class BrokenPosters {
  private readonly urls = new Set<string>();

  constructor(private readonly host: ReactiveControllerHost) {}

  has(url: string): boolean {
    return this.urls.has(url);
  }

  add(url: string): void {
    this.urls.add(url);
    this.host.requestUpdate();
  }
}

/**
 * A poster in a box of class `className`, or the TV placeholder when there is no poster or it failed to load.
 * Posters are big files, so only the ones scrolled into view load.
 * @param className Class of the box; sizes come from the view styles.
 * @param url Poster URL with its size, or `null` for the placeholder.
 * @param broken Posters that failed to load.
 */
export const renderPoster = (className: string, url: string | null, broken: BrokenPosters): TemplateResult =>
  url && !broken.has(url)
    ? html`<span class=${className}><img src=${url} alt="" loading="lazy" decoding="async" @error=${() => broken.add(url)} /></span>`
    : html`<span class="${className} none">${icon('tv')}</span>`;

/** Channel logo, name and number: the title in the header of both views. */
export const renderChannelTitle = (channel: ChannelConfig, logo: string | undefined, darkMode: boolean): TemplateResult => html`
  <tvg-logo .src=${logo} .tile=${channel.logo_tile} .darkMode=${darkMode}></tvg-logo>
  <div class="ch">${channel.name} <span>· ${channel.number}</span></div>
`;

/** The back arrow of the programme view header. */
export const renderBackButton = (label: string, onClick: () => void): TemplateResult =>
  html`<button class="icon-btn" data-back aria-label=${label} @click=${onClick}>${icon('back')}</button>`;

/** The close button of a view header. */
export const renderCloseButton = (label: string, onClick: () => void): TemplateResult =>
  html`<button class="icon-btn" data-close aria-label=${label} @click=${onClick}>${icon('close')}</button>`;

/** The "switch to this channel" button at the bottom of both views. */
export const renderSwitchAction = (host: EventTarget, channel: ChannelConfig, t: Translate): TemplateResult => html`
  <div class="actions">
    <button class="btn" @click=${() => fire(host, 'tvg-switch', { number: channel.number })}>
      ${icon('play')} ${t('switchTo', { channel_number: channel.number })}
    </button>
  </div>
`;

/** A small spinner with a text, for data that is still on its way. */
export const renderLoading = (t: Translate): TemplateResult => html`<div class="loading"><span class="spinner"></span>${t('loading')}</div>`;

/** Look shared by the channel view and the programme view. */
export const viewStyles = [
  iconStyles,
  css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      background: var(--card-background-color);
      color: var(--primary-text-color);
    }
    .tnum {
      font-variant-numeric: tabular-nums;
    }
    button {
      font: inherit;
      color: inherit;
    }
    :focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: -2px;
    }
    /* The sheet starts a close drag from the header, so the browser must not scroll or select there. */
    header {
      touch-action: none;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 18px 8px 10px 16px;
      border-bottom: 1px solid var(--divider-color);
      flex: none;
    }
    header .ch {
      flex: 1;
      min-width: 0;
      font-weight: 500;
      font-size: 15px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    header .ch span {
      color: var(--secondary-text-color);
      font-weight: 400;
    }
    .icon-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 0;
      background: none;
      display: grid;
      place-items: center;
      cursor: pointer;
      flex: none;
    }
    .icon-btn:hover {
      background: var(--secondary-background-color);
    }
    .scroll {
      position: relative;
      overflow-y: auto;
      flex: 1;
      overscroll-behavior: contain;
    }
    .text-btn {
      display: block;
      width: 100%;
      padding: 10px 16px;
      border: 0;
      background: none;
      color: var(--primary-color);
      font-weight: 500;
      text-align: left;
      cursor: pointer;
    }
    .none {
      display: grid;
      place-items: center;
      color: var(--disabled-text-color);
    }
    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .loading {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      color: var(--secondary-text-color);
    }
    .spinner {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid var(--tvg-track, color-mix(in srgb, var(--primary-text-color) 10%, transparent));
      border-top-color: var(--primary-color);
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to {
        rotate: 360deg;
      }
    }
    .actions {
      padding: 10px 16px 14px;
      border-top: 1px solid var(--divider-color);
      flex: none;
    }
    .btn {
      display: flex;
      width: 100%;
      align-items: center;
      justify-content: center;
      gap: 8px;
      height: 46px;
      border-radius: 23px;
      border: 0;
      cursor: pointer;
      font-weight: 500;
      font-size: 15px;
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
    }
    tvg-progress {
      margin-top: 5px;
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        transition: none !important;
        animation: none !important;
      }
    }
  `,
];
