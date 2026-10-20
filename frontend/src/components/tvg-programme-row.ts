import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ChannelConfig } from '../config';
import { formatTime, progress, whenText } from '../data/time';
import type { Translate } from '../i18n';
import type { Programme } from '../types/api';
import { fire } from './events';
import { highlighted } from './highlighted';
import { renderChevron, renderZap, rowStyles } from './row-parts';
import './tvg-progress';

/** A programme found by search. The programme is the main line, the channel the second one. */
@customElement('tvg-programme-row')
export class TvgProgrammeRow extends LitElement {
  @property({ attribute: false }) channel!: ChannelConfig;
  /** Logo URL, already chosen by the parent: the config logo, or else the guide icon. */
  @property({ attribute: false }) logo?: string;
  @property({ attribute: false }) programme: Programme | null = null;
  /** Current time, in milliseconds. */
  @property({ attribute: false }) now = 0;
  /** Key of the current TV day, `YYYY-MM-DD`. */
  @property({ attribute: false }) todayKey = '';
  @property({ attribute: false }) t!: Translate;
  @property({ attribute: false }) locale = 'en-GB';
  @property({ attribute: false }) timeZone = 'UTC';
  @property({ attribute: false }) hour12 = false;
  /** Local hour at which a TV day starts. */
  @property({ attribute: false }) startHour = 5;
  @property({ attribute: false }) darkMode = false;
  @property({ attribute: false }) first = false;
  /** Search query to mark in the programme title. */
  @property({ attribute: false }) highlight = '';

  static styles = [
    rowStyles,
    css`
      /* The programme title may take two lines. */
      .name {
        font-size: 14.5px;
        line-height: 1.3;
        white-space: normal;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
    `,
  ];

  /** "until 20:00" while on air; otherwise when it starts. */
  private whenLabel(programme: Programme, live: boolean): string {
    if (live) return this.t('until', { time: formatTime(Date.parse(programme.stop), this.locale, this.timeZone, this.hour12) });
    return whenText(programme, this.now, this.todayKey, this.locale, this.timeZone, this.hour12, this.startHour, this.t);
  }

  protected render() {
    const { channel, programme, t } = this;
    if (!programme) return nothing;
    const live = Date.parse(programme.start) <= this.now && Date.parse(programme.stop) > this.now;
    return html`<div class="row prog ${this.first ? 'first' : ''}">
      ${renderZap(this, { channel, logo: this.logo, switching: false, darkMode: this.darkMode, t })}
      <button
        class="info"
        aria-label=${t('details', { name: programme.title })}
        @click=${() => fire(this, 'tvg-open-programme', { number: channel.number, programmeId: programme.id })}
      >
        <span class="col">
          <span class="name">${highlighted(programme.title, this.highlight)}</span>
          <span class="now">
            <span class="title">${channel.name}</span>
            <span class="tnum">${this.whenLabel(programme, live)}</span>
          </span>
          ${live ? html`<tvg-progress .value=${progress(programme, this.now)}></tvg-progress>` : nothing}
        </span>
        ${renderChevron()}
      </button>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tvg-programme-row': TvgProgrammeRow;
  }
}
