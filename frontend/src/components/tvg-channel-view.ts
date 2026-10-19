import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ChannelConfig } from '../config';
import { dayLabel, formatTime, progress, tvDayKey } from '../data/time';
import type { Translate } from '../i18n';
import type { Programme } from '../types/api';
import { fire } from './events';
import './tvg-day-chips';
import './tvg-progress';
import {
  BrokenPosters,
  renderChannelTitle,
  renderCloseButton,
  renderLoading,
  renderPoster,
  renderSwitchAction,
  viewStyles,
} from './view-parts';

/**
 * The base view of the details sheet: one channel, day chips and the schedule of the chosen day.
 * On today's TV day the ended programmes are folded behind "Show N earlier".
 * It has one `header` (the sheet starts a close drag from it) and no other.
 */
@customElement('tvg-channel-view')
export class TvgChannelView extends LitElement {
  @property({ attribute: false }) channel!: ChannelConfig;
  /** Logo URL, already chosen by the parent: the config logo, or else the guide icon. */
  @property({ attribute: false }) logo?: string;
  /** Programmes of this channel for all days. */
  @property({ attribute: false }) programmes: Programme[] = [];
  /** Day keys for the chips. */
  @property({ attribute: false }) days: string[] = [];
  @property({ attribute: false }) selectedDay = '';
  /** Key of the current TV day, `YYYY-MM-DD`. */
  @property({ attribute: false }) todayKey = '';
  /** Whether the ended programmes of today show. */
  @property({ attribute: false }) showEarlier = false;
  /** Current time, in milliseconds. */
  @property({ attribute: false }) now = 0;
  @property({ attribute: false }) t!: Translate;
  @property({ attribute: false }) locale = 'en-GB';
  @property({ attribute: false }) timeZone = 'UTC';
  @property({ attribute: false }) hour12 = false;
  /** Local hour at which a TV day starts. */
  @property({ attribute: false }) startHour = 5;
  @property({ attribute: false }) darkMode = false;
  /** The schedule is still on its way. */
  @property({ attribute: false }) loading = false;

  private readonly broken = new BrokenPosters(this);

  static styles = [
    viewStyles,
    css`
      .no-guide {
        color: var(--secondary-text-color);
        padding: 24px 16px;
        margin: 0;
      }
      tvg-day-chips {
        position: sticky;
        top: 0;
        z-index: 2;
      }
      .sched {
        padding: 4px 0 8px;
      }
      .slot {
        display: grid;
        grid-template-columns: 42px auto 1fr;
        align-items: center;
        gap: 10px;
        width: 100%;
        box-sizing: border-box;
        padding: 7px 12px 7px 13px;
        border: 0;
        border-left: 3px solid transparent;
        background: none;
        text-align: left;
        cursor: pointer;
      }
      .slot:hover {
        background: var(--secondary-background-color);
      }
      .slot .t {
        color: var(--secondary-text-color);
      }
      .slot .txt {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .slot .title,
      .slot .snip {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .slot .title {
        font-weight: 500;
        line-height: 1.3;
      }
      .slot .c,
      .slot .snip {
        font-size: 12.5px;
        color: var(--secondary-text-color);
      }
      .slot .snip {
        line-height: 1.4;
      }
      .slot .c {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .thumb {
        display: block;
        width: 72px;
        aspect-ratio: 16 / 9;
        border-radius: 6px;
        overflow: hidden;
        background: var(--tvg-track, color-mix(in srgb, var(--primary-text-color) 10%, transparent));
      }
      .thumb.none {
        display: grid;
      }
      .thumb.none svg {
        width: 18px;
        height: 18px;
      }
      .slot.past {
        opacity: 0.5;
      }
      .slot.live {
        border-left-color: var(--primary-color);
        background: var(--secondary-background-color);
        align-items: start;
        padding-top: 10px;
        padding-bottom: 10px;
      }
      .slot.live .t {
        color: var(--primary-color);
        font-weight: 500;
      }
      .slot.live .thumb {
        width: 112px;
      }
    `,
  ];

  /** Programmes of the chosen day. */
  private dayProgrammes(): Programme[] {
    return this.programmes.filter((p) => tvDayKey(Date.parse(p.start), this.timeZone, this.startHour) === this.selectedDay);
  }

  private renderSlot(programme: Programme) {
    const start = Date.parse(programme.start);
    const stop = Date.parse(programme.stop);
    const live = start <= this.now && stop > this.now;
    const past = stop <= this.now;
    const poster = programme.image ? `${programme.image}/thumb` : null;
    const snippet = live && programme.description ? programme.description : null;
    const category = programme.categories[0];
    return html`<button
      class="slot ${past ? 'past' : ''} ${live ? 'live' : ''}"
      @click=${() => fire(this, 'tvg-open-programme', { number: this.channel.number, programmeId: programme.id })}
    >
      <span class="t tnum">${formatTime(start, this.locale, this.timeZone, this.hour12)}</span>
      ${renderPoster('thumb', poster, this.broken)}
      <span class="txt">
        <span class="title">${programme.title}</span>
        ${snippet
          ? html`<span class="snip">${snippet}</span>`
          : category
            ? html`<span class="c">${category}</span>`
            : nothing}
        ${live ? html`<tvg-progress .value=${progress(programme, this.now)}></tvg-progress>` : nothing}
      </span>
    </button>`;
  }

  private renderSchedule() {
    const all = this.dayProgrammes();
    const foldable = this.selectedDay === this.todayKey && !this.showEarlier;
    const ended = foldable ? all.filter((p) => Date.parse(p.stop) <= this.now) : [];
    const shown = foldable ? all.filter((p) => !ended.includes(p)) : all;
    return html`
      <tvg-day-chips
        .days=${this.days}
        .selected=${this.selectedDay}
        .labels=${Object.fromEntries(this.days.map((key) => [key, dayLabel(key, this.todayKey, this.locale, this.t)]))}
        .groupLabel=${this.t('day')}
      ></tvg-day-chips>
      <div class="sched">
        ${ended.length
          ? html`<button class="earlier" @click=${() => fire(this, 'tvg-show-earlier', {})}>${this.t('earlier', ended.length)}</button>`
          : nothing}
        ${shown.map((p) => this.renderSlot(p))}
      </div>
    `;
  }

  private renderBody() {
    if (this.loading) return renderLoading(this.t);
    if (!this.programmes.length) return html`<p class="no-guide">${this.t('noGuideLong')}</p>`;
    return this.renderSchedule();
  }

  protected render() {
    const { channel, t } = this;
    return html`
      <header>
        ${renderChannelTitle(channel, this.logo, this.darkMode)}
        ${renderCloseButton(t('close'), () => fire(this, 'tvg-close', {}))}
      </header>
      <div class="scroll">${this.renderBody()}</div>
      ${renderSwitchAction(this, channel, t)}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tvg-channel-view': TvgChannelView;
  }
}
