import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ChannelConfig } from '../config';
import { canRemind } from '../data/reminders';
import { dayLabel, formatTime, progress, tvDayKey, whenText } from '../data/time';
import type { Translate } from '../i18n';
import type { Programme } from '../types/api';
import { fire } from './events';
import { icon } from './icons';
import './tvg-logo';
import './tvg-progress';
import {
  BrokenPosters,
  overlapsDay,
  renderBackButton,
  renderChannelTitle,
  renderCloseButton,
  renderLoading,
  renderPoster,
  renderSwitchAction,
  viewStyles,
} from './view-parts';

/** A channel of the card, found by its guide id. */
export interface ChannelEntry {
  config: ChannelConfig;
  /** Logo URL, already chosen: the config logo, or else the guide icon. */
  logo?: string;
}

/** Each group of airings shows this many rows until the user asks for all. */
const AIRINGS_SHOWN = 3;

type GroupKey = 'same' | 'others';

/**
 * The age chip: `12` becomes `12+`. Other systems, such as `PG-13` or `FSK 12`, stay as the guide gives them.
 * @param rating Age rating from the guide.
 */
const ageLabel = (rating: string): string => (/^\d+$/.test(rating) ? `${rating}+` : rating);

/**
 * The details of one programme. It slides over the channel view in the sheet.
 * Below the description it lists other airings of the programme, first on its own channel, then on the other channels.
 * It has one `header` (the sheet starts a close drag from it) and no other.
 */
@customElement('tvg-programme-view')
export class TvgProgrammeView extends LitElement {
  @property({ attribute: false }) channel!: ChannelConfig;
  /** Logo URL, already chosen by the parent: the config logo, or else the guide icon. */
  @property({ attribute: false }) logo?: string;
  @property({ attribute: false }) programme!: Programme;
  /** Other airings of the programme; `null` while they load. */
  @property({ attribute: false }) airings: Programme[] | null = [];
  /** Channels of the card by guide id. */
  @property({ attribute: false }) channelsById: Map<string, ChannelEntry> = new Map();
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
  /** The user has a reminder for this programme. */
  @property({ attribute: false }) reminded = false;
  /** The integration found no phone with the HA app for the user, so a reminder only fires the event. */
  @property({ attribute: false }) noPhone = false;

  @state() private expanded: Record<GroupKey, boolean> = { same: false, others: false };

  private readonly broken = new BrokenPosters(this);

  static styles = [
    viewStyles,
    css`
      header {
        padding-left: 4px;
      }
      .poster {
        display: block;
        aspect-ratio: 16 / 9;
        background: var(--tvg-track, color-mix(in srgb, var(--primary-text-color) 10%, transparent));
      }
      .poster.none {
        display: grid;
      }
      .poster.none svg {
        width: 40px;
        height: 40px;
      }
      .sel {
        padding: 12px 16px 8px;
      }
      h3 {
        margin: 0;
        font-size: 20px;
        font-weight: 500;
        line-height: 1.25;
      }
      .sub {
        color: var(--secondary-text-color);
        font-size: 13.5px;
        margin-top: 2px;
      }
      .timing {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        color: var(--secondary-text-color);
        margin: 10px 0 6px;
      }
      .timing b {
        color: var(--primary-text-color);
        font-weight: 500;
      }
      .warn {
        font-size: 13px;
        color: var(--warning-color, var(--secondary-text-color));
        margin: 0 0 6px;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 10px 0 4px;
      }
      .meta span {
        font-size: 12.5px;
        padding: 3px 8px;
        border-radius: 6px;
        background: var(--tvg-track, color-mix(in srgb, var(--primary-text-color) 10%, transparent));
      }
      .meta .age {
        font-weight: 700;
      }
      .desc {
        line-height: 1.5;
        margin: 10px 0 4px;
      }
      .airings {
        padding: 4px 0 12px;
        border-top: 1px solid var(--divider-color);
        margin-top: 8px;
      }
      .airings h4 {
        margin: 12px 16px 2px;
        font-size: 15px;
        font-weight: 500;
      }
      .grp {
        padding: 10px 16px 4px;
        font-size: 12.5px;
        font-weight: 500;
        color: var(--secondary-text-color);
      }
      .air {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        box-sizing: border-box;
        padding: 8px 8px 8px 16px;
        border: 0;
        background: none;
        text-align: left;
        cursor: pointer;
      }
      .air:hover {
        background: var(--secondary-background-color);
      }
      .air tvg-logo {
        --tvg-logo-width: 44px;
        --tvg-logo-height: 26px;
      }
      .air .txt {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .air .when {
        font-weight: 500;
      }
      .air .c {
        font-size: 12.5px;
        color: var(--secondary-text-color);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .air .chev {
        color: var(--disabled-text-color);
      }
    `,
  ];

  protected willUpdate(changed: PropertyValues<this>): void {
    // "Show all" belongs to one programme: a new programme starts with the short lists again.
    if (changed.has('programme')) this.expanded = { same: false, others: false };
  }

  private dayKeyOf(programme: Programme): string {
    return tvDayKey(Date.parse(programme.start), this.timeZone, this.startHour);
  }

  private renderTiming(programme: Programme) {
    const start = Date.parse(programme.start);
    const stop = Date.parse(programme.stop);
    const today = overlapsDay(programme, this.todayKey, this.timeZone, this.startHour);
    const day = today ? '' : `${dayLabel(this.dayKeyOf(programme), this.todayKey, this.locale, this.t)}, `;
    const range = `${formatTime(start, this.locale, this.timeZone, this.hour12)} - ${formatTime(stop, this.locale, this.timeZone, this.hour12)}`;
    const when = today
      ? whenText(programme, this.now, this.todayKey, this.locale, this.timeZone, this.hour12, this.startHour, this.t)
      : '';
    const live = start <= this.now && stop > this.now;
    return html`
      <div class="timing tnum"><b>${day}${range}</b><span>${when}</span></div>
      ${live ? html`<tvg-progress .value=${progress(programme, this.now)}></tvg-progress>` : nothing}
      ${this.reminded && this.noPhone ? html`<div class="warn">${this.t('noPhone')}</div>` : nothing}
    `;
  }

  private renderBell(programme: Programme) {
    if (!canRemind(programme, this.now)) return nothing;
    const label = this.t(this.reminded ? 'reminderSet' : 'remindMe');
    return html`<button
      class="icon-btn"
      data-reminder
      aria-pressed=${this.reminded ? 'true' : 'false'}
      aria-label=${label}
      @click=${() => fire(this, 'tvg-reminder', { programmeId: programme.id, on: !this.reminded })}
    >
      ${icon(this.reminded ? 'bellRing' : 'bell')}
    </button>`;
  }

  private renderChips(programme: Programme) {
    const chips = [
      ...programme.categories.map((category) => html`<span>${category}</span>`),
      programme.rating ? html`<span class="age">${ageLabel(programme.rating)}</span>` : null,
      programme.year ? html`<span>${programme.year}</span>` : null,
      programme.countries.length ? html`<span>${programme.countries.join(', ')}</span>` : null,
      programme.star_rating ? html`<span>★ ${programme.star_rating}</span>` : null,
    ].filter((chip) => chip !== null);
    return chips.length ? html`<div class="meta">${chips}</div>` : nothing;
  }

  private renderAiring(airing: Programme, config: ChannelConfig, entry?: ChannelEntry) {
    const key = this.dayKeyOf(airing);
    const start = formatTime(Date.parse(airing.start), this.locale, this.timeZone, this.hour12);
    // The channel name tells the other-channel rows apart; the subtitle and episode tell episodes apart.
    const details = [entry ? config.name : '', airing.subtitle, airing.episode].filter(Boolean).join(' · ');
    return html`<button
      class="air"
      @click=${() => fire(this, 'tvg-open-programme', { number: config.number, programmeId: airing.id })}
    >
      ${entry ? html`<tvg-logo .src=${entry.logo} .tile=${config.logo_tile} .darkMode=${this.darkMode}></tvg-logo>` : nothing}
      <span class="txt">
        <span class="when tnum"><span>${dayLabel(key, this.todayKey, this.locale, this.t)}</span> <span>${start}</span></span>
        ${details ? html`<span class="c">${details}</span>` : nothing}
      </span>
      <span class="chev">${icon('chevron')}</span>
    </button>`;
  }

  private renderGroup(key: GroupKey, title: string, rows: { airing: Programme; config: ChannelConfig; entry?: ChannelEntry }[]) {
    if (!rows.length) return nothing;
    const open = this.expanded[key];
    const shown = open ? rows : rows.slice(0, AIRINGS_SHOWN);
    return html`
      <div class="grp">${title}</div>
      ${shown.map(({ airing, config, entry }) => this.renderAiring(airing, config, entry))}
      ${!open && rows.length > AIRINGS_SHOWN
        ? html`<button class="text-btn" @click=${() => (this.expanded = { ...this.expanded, [key]: true })}>
            ${this.t('showAll', { count: rows.length })}
          </button>`
        : nothing}
    `;
  }

  private renderAirings() {
    const { airings, programme, channel, t } = this;
    if (airings === null) {
      return html`<section class="airings"><h4>${t('moreAirings')}</h4>${renderLoading(t)}</section>`;
    }
    const same = airings
      .filter((airing) => airing.channel_id === programme.channel_id)
      .map((airing) => ({ airing, config: channel }));
    // An airing on a channel that is not in the card cannot be switched to, so it is left out.
    const others = airings.flatMap((airing) => {
      const entry = this.channelsById.get(airing.channel_id);
      return airing.channel_id === programme.channel_id || !entry ? [] : [{ airing, config: entry.config, entry }];
    });
    if (!same.length && !others.length) return nothing;
    return html`<section class="airings">
      <h4>${t('moreAirings')}</h4>
      ${this.renderGroup('same', t('onChannel', { channel_name: channel.name }), same)}
      ${this.renderGroup('others', t('onOtherChannels'), others)}
    </section>`;
  }

  protected render() {
    const { channel, programme, t } = this;
    if (!programme) return nothing;
    const episode = [programme.subtitle, programme.episode].filter(Boolean).join(', ');
    return html`
      <header>
        ${renderBackButton(t('back'), () => fire(this, 'tvg-back', {}))}
        ${renderChannelTitle(channel, this.logo, this.darkMode)} ${this.renderBell(programme)}
        ${renderCloseButton(t('close'), () => fire(this, 'tvg-close', {}))}
      </header>
      <div class="scroll">
        ${programme.image ? renderPoster('poster', `${programme.image}/large`, this.broken) : nothing}
        <div class="sel">
          <h3>${programme.title}</h3>
          ${episode ? html`<div class="sub">${episode}</div>` : nothing}
          ${this.renderTiming(programme)} ${this.renderChips(programme)}
          ${programme.description ? html`<p class="desc">${programme.description}</p>` : nothing}
        </div>
        ${this.renderAirings()}
      </div>
      ${renderSwitchAction(this, channel, t)}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tvg-programme-view': TvgProgrammeView;
  }
}
