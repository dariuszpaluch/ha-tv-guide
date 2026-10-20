import { LitElement, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ChannelConfig } from '../config';
import { formatTime, progress } from '../data/time';
import type { Translate } from '../i18n';
import type { Programme } from '../types/api';
import { fire } from './events';
import { highlighted } from './highlighted';
import { renderChevron, renderZap, rowStyles } from './row-parts';
import './tvg-progress';

/**
 * A channel in the list: number and logo on the left (switch), and on the right (details) the name,
 * the programme on now and the one after it.
 */
@customElement('tvg-channel-row')
export class TvgChannelRow extends LitElement {
  @property({ attribute: false }) channel!: ChannelConfig;
  /** Logo URL, already chosen by the parent: the config logo, or else the guide icon. */
  @property({ attribute: false }) logo?: string;
  @property({ attribute: false }) programme: Programme | null = null;
  /** The programme after the one on now. */
  @property({ attribute: false }) next: Programme | null = null;
  /** The integration does not keep this channel's guide id. */
  @property({ attribute: false }) notSelected = false;
  /** Current time, in milliseconds. */
  @property({ attribute: false }) now = 0;
  @property({ attribute: false }) t!: Translate;
  @property({ attribute: false }) locale = 'en-GB';
  @property({ attribute: false }) timeZone = 'UTC';
  @property({ attribute: false }) hour12 = false;
  @property({ attribute: false }) darkMode = false;
  /** This channel is the one on the TV. */
  @property({ attribute: false }) active = false;
  /** A switch to this channel is in progress. */
  @property({ attribute: false }) switching = false;
  /** First row of a result list: shown with a background, as the one Enter switches to. */
  @property({ attribute: false }) first = false;
  /** Search query to mark in the channel name. */
  @property({ attribute: false }) highlight = '';

  static styles = rowStyles;

  private time(iso: string): string {
    return formatTime(Date.parse(iso), this.locale, this.timeZone, this.hour12);
  }

  /** The end time shows here only without a next programme: the "next" line has the same time. */
  private renderProgramme(programme: Programme) {
    return html`
      <span class="now">
        <span class="title">${programme.title}</span>
        ${this.next ? nothing : html`<span class="tnum">${this.time(programme.stop)}</span>`}
      </span>
      <tvg-progress .value=${progress(programme, this.now)}></tvg-progress>
    `;
  }

  private renderNext(next: Programme) {
    return html`<span class="next">
      <span class="label">${this.t('next')}</span>
      <span class="tnum">${this.time(next.start)}</span>
      <span class="title">${next.title}</span>
    </span>`;
  }

  protected render() {
    const { channel, t } = this;
    return html`<div class="row ${this.active ? 'active' : ''} ${this.first ? 'first' : ''}">
      ${renderZap(this, { channel, logo: this.logo, switching: this.switching, darkMode: this.darkMode, t })}
      <button
        class="info"
        aria-label=${t('details', { name: channel.name })}
        @click=${() => fire(this, 'tvg-open-channel', { number: channel.number })}
      >
        <span class="col">
          <span class="name">${highlighted(channel.name, this.highlight)}</span>
          ${this.programme
            ? this.renderProgramme(this.programme)
            : html`<span class="now"><span class="title">${t(this.notSelected ? 'notSelected' : 'noGuide')}</span></span>`}
          ${this.next ? this.renderNext(this.next) : nothing}
        </span>
        ${renderChevron()}
      </button>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tvg-channel-row': TvgChannelRow;
  }
}
