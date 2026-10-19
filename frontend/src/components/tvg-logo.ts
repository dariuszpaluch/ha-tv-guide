import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { LogoTile } from '../config';
import { measureLogo, type LogoTone } from '../utils/logo-tone';
import { icon, iconStyles } from './icons';

/** Tones that are already measured, so a logo is not measured again when its row is drawn again. */
const measured = new Map<string, LogoTone>();

/**
 * A channel logo in a fixed box. A light logo gets a dark tile in light mode and a dark logo a light
 * tile in dark mode, so it stays readable. Without a logo it shows a TV icon.
 */
@customElement('tvg-logo')
export class TvgLogo extends LitElement {
  @property({ attribute: false }) src?: string;
  /** Tile from the card config. It wins over the measured tone. */
  @property({ attribute: false }) tile?: LogoTile;
  @property({ attribute: false }) darkMode = false;

  @state() private tone?: LogoTone;
  @state() private broken = false;

  static styles = [
    iconStyles,
    css`
      :host {
        display: inline-block;
        flex: none;
      }
      .logo {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--tvg-logo-width, 52px);
        height: var(--tvg-logo-height, 30px);
        color: var(--disabled-text-color);
      }
      img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .tile-dark,
      .tile-light {
        padding: 3px 4px;
        border-radius: 6px;
      }
      .tile-dark {
        background: var(--tvg-tile-dark, #262626);
      }
      .tile-light {
        background: var(--tvg-tile-light, #f2f2f2);
      }
    `,
  ];

  protected willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has('src')) return;
    this.broken = false;
    this.tone = this.src ? measured.get(this.src) : undefined;
  }

  /** Class of the tile behind the logo, or an empty string for none. */
  private tileClass(): string {
    if (this.tile) return `tile-${this.tile}`;
    if (this.tone === 'light' && !this.darkMode) return 'tile-dark';
    if (this.tone === 'dark' && this.darkMode) return 'tile-light';
    return '';
  }

  /** Measures the logo once it has loaded. A logo from another origin may block the canvas: no tile then. */
  private onLoad(event: Event): void {
    if (!this.src || this.tile || this.tone) return;
    try {
      this.tone = measureLogo(event.target as HTMLImageElement);
    } catch {
      this.tone = 'mixed';
    }
    measured.set(this.src, this.tone);
  }

  protected render() {
    const src = this.broken ? undefined : this.src;
    return html`<span class="logo ${src ? this.tileClass() : ''}">
      ${src
        ? html`<img src=${src} alt="" @load=${this.onLoad} @error=${() => (this.broken = true)} />`
        : icon('tv')}
    </span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tvg-logo': TvgLogo;
  }
}
