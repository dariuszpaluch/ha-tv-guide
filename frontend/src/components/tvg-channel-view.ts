import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ChannelConfig } from '../config';
import { dayLabel, formatTime, progress } from '../data/time';
import type { Translate } from '../i18n';
import type { Programme } from '../types/api';
import { fire } from './events';
import { icon } from './icons';
import './tvg-day-chips';
import './tvg-progress';
import {
  BrokenPosters,
  overlapsDay,
  renderChannelTitle,
  renderCloseButton,
  renderLoading,
  renderPoster,
  renderSwitchAction,
  viewStyles,
} from './view-parts';

/**
 * Index of the programme the schedule scrolls to: the focused one, else on today the first one that has not ended.
 * `-1` means the top of the list.
 * @param programmes Programmes of the shown day, in order.
 * @param focusId Id of the programme to keep in view, or `''`.
 * @param now Current time, in milliseconds.
 * @param today Whether the shown day is today.
 */
export const scrollAnchor = (programmes: Programme[], focusId: string, now: number, today: boolean): number => {
  const focused = focusId ? programmes.findIndex((p) => p.id === focusId) : -1;
  if (focused >= 0 || !today) return focused;
  return programmes.findIndex((p) => Date.parse(p.stop) > now);
};

/**
 * The base view of the details sheet: one channel, day chips and the schedule of the chosen day.
 * The schedule scrolls to the focused programme, or on today to the programme on now, with one programme above it.
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
  /** Id of the programme to keep in view: the one the programme view shows. Empty for none. */
  @property({ attribute: false }) focusId = '';
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
  /** Text for a schedule that failed to load. Empty when the load worked. It replaces the "no guide" text. */
  @property({ attribute: false }) error = '';
  /** Ids of the programmes with a reminder of the user. */
  @property({ attribute: false }) remindedIds: ReadonlySet<string> = new Set();

  private readonly broken = new BrokenPosters(this);
  /** A scroll waits for the next frame. `true` while it may keep a visible row where it is. */
  private scrollPending?: boolean;

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
      /* The time column is 42px wide, so the bell sits under the time, not beside it. */
      .slot .rem {
        display: flex;
        margin-top: 2px;
        color: var(--primary-color);
      }
      .slot .rem svg.i {
        width: 14px;
        height: 14px;
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

  /** Programmes of the chosen day, including one that started before the day start and still runs. */
  private dayProgrammes(): Programme[] {
    return this.programmes.filter((p) => overlapsDay(p, this.selectedDay, this.timeZone, this.startHour));
  }

  protected updated(changed: PropertyValues<this>): void {
    const moved = (['channel', 'programmes', 'selectedDay', 'loading'] as const).some((key) => changed.has(key));
    if (!moved && !changed.has('focusId')) return;
    const queued = this.scrollPending !== undefined;
    this.scrollPending = (this.scrollPending ?? true) && !moved;
    if (queued) return;
    // The day chips and the progress bar render after this view, so the rows get their size in the next frame.
    requestAnimationFrame(() => {
      const onlyIfHidden = this.scrollPending;
      this.scrollPending = undefined;
      if (onlyIfHidden !== undefined) this.scrollToAnchor(onlyIfHidden);
    });
  }

  /**
   * Scrolls the schedule so the anchor programme is the second row, under the one before it.
   * With `onlyIfHidden` a row that the user can see stays where it is, so a tap on a row does not move the list.
   * It sets `scrollTop` and does not use `scrollIntoView()`, which also scrolls the HA page.
   */
  private scrollToAnchor(onlyIfHidden: boolean): void {
    const scroll = this.renderRoot.querySelector<HTMLElement>('.scroll');
    if (!scroll) return;
    const slots = [...this.renderRoot.querySelectorAll<HTMLElement>('.slot')];
    const index = scrollAnchor(this.dayProgrammes(), this.focusId, this.now, this.selectedDay === this.todayKey);
    const anchor = slots[index];
    if (!anchor) {
      if (!onlyIfHidden) scroll.scrollTop = 0;
      return;
    }
    // The day chips stick to the top of the list and cover the rows under them.
    const covered = this.renderRoot.querySelector<HTMLElement>('tvg-day-chips')?.offsetHeight ?? 0;
    const visible =
      anchor.offsetTop >= scroll.scrollTop + covered &&
      anchor.offsetTop + anchor.offsetHeight <= scroll.scrollTop + scroll.clientHeight;
    if (onlyIfHidden && visible) return;
    const top = slots[index - 1] ?? anchor;
    scroll.scrollTop = Math.max(0, top.offsetTop - covered);
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
      <span class="t tnum"
        >${formatTime(start, this.locale, this.timeZone, this.hour12)}${this.remindedIds.has(programme.id)
          ? html`<span class="rem" role="img" aria-label=${this.t('reminderSet')}>${icon('bellRing')}</span>`
          : nothing}</span
      >
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
    return html`
      <tvg-day-chips
        .days=${this.days}
        .selected=${this.selectedDay}
        .labels=${Object.fromEntries(this.days.map((key) => [key, dayLabel(key, this.todayKey, this.locale, this.t)]))}
        .groupLabel=${this.t('day')}
      ></tvg-day-chips>
      <div class="sched">${this.dayProgrammes().map((p) => this.renderSlot(p))}</div>
    `;
  }

  private renderBody() {
    if (this.loading) return renderLoading(this.t);
    if (this.error) return html`<p class="no-guide">${this.error}</p>`;
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
