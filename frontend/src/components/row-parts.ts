import { css, html, type TemplateResult } from 'lit';
import type { ChannelConfig } from '../config';
import type { Translate } from '../i18n';
import { fire } from './events';
import { icon, iconStyles } from './icons';
import './tvg-logo';

/** What the left (switch) part of a row needs. */
export interface ZapOptions {
  channel: ChannelConfig;
  logo?: string;
  switching: boolean;
  darkMode: boolean;
  t: Translate;
}

/**
 * The left part of a row: channel number and logo. A tap switches the TV to the channel.
 * @param host The row that sends the event.
 */
export const renderZap = (host: EventTarget, { channel, logo, switching, darkMode, t }: ZapOptions): TemplateResult => html`
  <button
    class="zap ${switching ? 'switching' : ''}"
    aria-label=${t('switchTo', { channel_number: channel.number })}
    @click=${() => fire(host, 'tvg-switch', { number: channel.number })}
  >
    <span class="play">${icon('play')}</span>
    <span class="number tnum">${channel.number}</span>
    <tvg-logo .src=${logo} .tile=${channel.logo_tile} .darkMode=${darkMode}></tvg-logo>
  </button>
  <span class="sep"></span>
`;

/** Look shared by the channel row and the programme row. */
export const rowStyles = [
  iconStyles,
  css`
    :host {
      display: block;
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
    mark {
      background: var(--tvg-mark, color-mix(in srgb, var(--primary-color) 30%, transparent));
      color: inherit;
      border-radius: 3px;
      padding: 0 1px;
    }

    /* Two tap targets: the left one switches the channel, the right one opens the details. */
    .row {
      display: flex;
      align-items: stretch;
      border-bottom: 1px solid var(--divider-color);
    }
    .row.first {
      background: var(--secondary-background-color);
    }
    .zap {
      position: relative;
      display: flex;
      align-items: center;
      gap: 10px;
      flex: none;
      padding: 8px 10px 8px 12px;
      margin: 4px 0 4px 4px;
      border: 0;
      border-radius: 10px;
      background: none;
      cursor: pointer;
    }
    .number {
      min-width: 3ch;
      text-align: right;
      color: var(--primary-color);
      font-weight: 500;
    }
    .zap .play {
      position: absolute;
      left: 10px;
      top: 50%;
      translate: 0 -50%;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
      display: grid;
      place-items: center;
      opacity: 0;
      scale: 0.6;
      transition:
        opacity 0.15s,
        scale 0.15s;
    }
    .zap .play svg {
      width: 16px;
      height: 16px;
    }
    @media (hover: hover) {
      .zap:hover {
        background: var(--secondary-background-color);
      }
      .zap:hover .play {
        opacity: 1;
        scale: 1;
      }
      .zap:hover .number {
        opacity: 0;
      }
      .info:hover {
        background: var(--secondary-background-color);
      }
    }
    .zap:active,
    .zap.switching {
      background: var(--tvg-mark, color-mix(in srgb, var(--primary-color) 30%, transparent));
    }
    .zap.switching .play {
      opacity: 1;
      scale: 1;
      animation: pulse 1s ease-in-out infinite;
    }
    .zap.switching .number {
      opacity: 0;
    }
    @keyframes pulse {
      50% {
        scale: 0.82;
      }
    }
    .sep {
      width: 1px;
      margin: 14px 0;
      background: var(--divider-color);
      flex: none;
    }
    .info {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 9px 6px 10px 12px;
      border: 0;
      background: none;
      text-align: left;
      cursor: pointer;
    }
    .col {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .name {
      font-size: 15px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row.active .name {
      color: var(--primary-color);
    }
    .now {
      display: flex;
      gap: 8px;
      color: var(--secondary-text-color);
      font-size: 13px;
    }
    .now .title {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    tvg-progress {
      margin-top: 3px;
    }
    .next {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-top: 2px;
      color: var(--secondary-text-color);
      font-size: 12.5px;
      white-space: nowrap;
    }
    .next .label {
      font-size: 10.5px;
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .next .title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .chev {
      color: var(--disabled-text-color);
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        transition: none !important;
        animation: none !important;
      }
    }
  `,
];

/** The chevron at the right end of the details button. */
export const renderChevron = (): TemplateResult => html`<span class="chev">${icon('chevron')}</span>`;
