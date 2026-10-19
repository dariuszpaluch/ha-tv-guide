import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './components/tvg-channel-row';
import './components/tvg-channel-view';
import './components/tvg-programme-row';
import './components/tvg-programme-view';
import './components/tvg-search-box';
import './components/tvg-sheet';
import type { ChannelEntry } from './components/tvg-programme-view';
import { channelIds, switchServiceCall, validateConfig, type ChannelConfig, type TvGuideConfig } from './config';
import { GuideClient, GuideError } from './data/guide-client';
import { channelEntries, guideIcons, logoOf } from './data/logos';
import { SearchRunner, firstResult, type SearchResults } from './data/search';
import { formatLastSuccess, isStale } from './data/stale';
import { hour12, timeZoneOf, tvDayKey, tvDayRange, tvDays } from './data/time';
import { en, localeOf, resolveLanguage, translator, type Translate } from './i18n';
import type { GuideErrorCode, GuideInfo, NowMap, Programme } from './types/api';
import type { HomeAssistant } from './types/hass';
import { tvGuideStyles } from './tv-guide-styles';

const CARD_TYPE = 'tv-guide';
const CARD_SIZE = 9;
const REFRESH_MS = 60e3;
const SWITCH_FEEDBACK_MS = 1600;
const DAY_MS = 24 * 3600e3;
/** How far ahead the card looks for days with programmes. The guide holds about 5 days. */
const GUIDE_HORIZON_DAYS = 14;
const PROGRAMME_SEARCH_MIN = 2;

/** Everything the open details sheet shows. The sheet keeps its content while it slides away. */
interface Details {
  channel: ChannelConfig;
  open: boolean;
  /** Selected TV day, `YYYY-MM-DD`. */
  day: string;
  days: string[];
  programmes: Programme[];
  loading: boolean;
  showEarlier: boolean;
  programme?: Programme;
  showProgramme: boolean;
  /** `null` while they load. */
  airings: Programme[] | null;
}

type LoadError = GuideErrorCode | 'unknown';

declare global {
  interface HTMLElementTagNameMap {
    'tv-guide': TvGuide;
  }
  interface Window {
    customCards?: { type: string; name: string; description: string }[];
  }
}

/** Text of whatever a rejected promise holds. HA rejects with plain `{ code, message }` objects. */
const errorText = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : String(error);
};

/** The message for a failed load. */
const loadErrorKey = (code: LoadError): 'notLoaded' | 'notSetUp' | 'loadFailed' => {
  if (code === 'not_loaded') return 'notLoaded';
  if (code === 'not_found') return 'notSetUp';
  return 'loadFailed';
};

/** The TV guide card: a channel list with search, and a sheet with the schedule and programme details. */
@customElement('tv-guide')
export class TvGuide extends LitElement {
  @state() private config?: TvGuideConfig;
  @state() private info?: GuideInfo;
  @state() private nowMap?: NowMap;
  @state() private entries = new Map<string, ChannelEntry>();
  @state() private loadError?: LoadError;
  /** Current time in ms. It changes with each refresh, so the whole card shows one moment. */
  @state() private nowMs = Date.now();
  @state() private query = '';
  @state() private results?: SearchResults;
  @state() private activeNumber?: number;
  @state() private switchingNumber?: number;
  @state() private details?: Details;

  private hassObject?: HomeAssistant;
  private client?: GuideClient;
  private runner?: SearchRunner;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private switchTimer?: ReturnType<typeof setTimeout>;
  private icons = new Map<string, string>();
  /** Each counter makes the answers of older requests stale. */
  private scheduleRun = 0;
  private daysRun = 0;
  private airingsRun = 0;
  private translateCache?: { language: string; t: Translate };

  /** Called by Home Assistant with the card config. Throws the config error, which HA shows on the card. */
  setConfig(raw: unknown): void {
    const config = validateConfig(raw);
    this.stopRefreshing();
    this.config = config;
    this.client = undefined;
    this.runner?.cancel();
    this.runner = undefined;
    this.info = undefined;
    this.nowMap = undefined;
    this.loadError = undefined;
    this.icons = new Map();
    this.entries = channelEntries(config, this.icons);
    this.query = '';
    this.results = undefined;
    this.details = undefined;
    this.prepareClient();
    this.startRefreshing();
  }

  /** Called by Home Assistant with every state change. The card repaints only when what it shows can change. */
  set hass(hass: HomeAssistant) {
    const previous = this.hassObject;
    this.hassObject = hass;
    this.prepareClient();
    if (previous && previous.connection !== hass.connection && this.client) {
      // HA gives a new connection after a reconnect. The old answers are no longer trustworthy.
      this.client.setConnection(hass.connection);
      void this.refresh();
    }
    this.startRefreshing();
    if (!previous || this.looksDifferent(previous, hass)) this.requestUpdate();
  }

  get hass(): HomeAssistant | undefined {
    return this.hassObject;
  }

  /** Height hint for the HA masonry layout. */
  getCardSize(): number {
    return CARD_SIZE;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.startRefreshing();
  }

  disconnectedCallback(): void {
    this.stopRefreshing();
    clearTimeout(this.switchTimer);
    this.runner?.cancel();
    super.disconnectedCallback();
  }

  /** Whether a new hass object changes anything the card paints. */
  private looksDifferent(a: HomeAssistant, b: HomeAssistant): boolean {
    return (
      a.locale.language !== b.locale.language ||
      a.locale.time_format !== b.locale.time_format ||
      a.locale.time_zone !== b.locale.time_zone ||
      a.config.time_zone !== b.config.time_zone ||
      a.themes.darkMode !== b.themes.darkMode
    );
  }

  /** Creates the guide client once both the config and hass are known. */
  private prepareClient(): void {
    const { config, hassObject } = this;
    if (this.client || !config || !hassObject) return;
    const client = new GuideClient(hassObject.connection, config.entry_id);
    this.client = client;
    this.runner = new SearchRunner(
      (...args) => client.search(...args),
      (results) => {
        this.results = results;
      },
    );
  }

  /** Loads at once and then every 60 seconds, while the card is on the page. */
  private startRefreshing(): void {
    if (this.refreshTimer !== undefined || !this.isConnected || !this.client) return;
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
    void this.refresh();
  }

  private stopRefreshing(): void {
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  /**
   * Loads the guide state and what is on now. The client caches the channels for the session.
   * A failure shows a message; the next tick tries again, so the card recovers when the integration is ready.
   */
  private async refresh(): Promise<void> {
    const { client, config } = this;
    if (!client || !config) return;
    this.nowMs = Date.now();
    try {
      const [info, guideChannels] = await Promise.all([client.info(), client.channels()]);
      const ids = channelIds(config);
      const nowMap = ids.length > 0 ? await client.now(ids, { force: true }) : {};
      if (client !== this.client) return;
      this.icons = guideIcons(guideChannels);
      this.entries = channelEntries(config, this.icons);
      this.info = info;
      this.nowMap = nowMap;
      this.loadError = undefined;
    } catch (error) {
      if (client !== this.client) return;
      this.loadError = error instanceof GuideError ? error.code : 'unknown';
    }
  }

  private strings(): Translate {
    const language = this.hassObject?.locale.language ?? 'en';
    if (this.translateCache?.language !== language) this.translateCache = { language, t: translator(language) };
    return this.translateCache.t;
  }

  private channels(): ChannelConfig[] {
    return this.config?.sections.flatMap((section) => section.channels) ?? [];
  }

  private channelByNumber(number: number): ChannelConfig | undefined {
    return this.channels().find((channel) => channel.number === number);
  }

  private timeZone(): string {
    return this.hassObject ? timeZoneOf(this.hassObject) : 'UTC';
  }

  private todayKey(): string {
    return tvDayKey(this.nowMs, this.timeZone(), this.config?.tv_day_starts_at ?? 0);
  }

  // ---- switching ----

  private switchTo(channel: ChannelConfig): void {
    const { config, hassObject } = this;
    if (!config || !hassObject) return;
    const t = this.strings();
    const call = switchServiceCall(config, channel.number);
    this.switchingNumber = channel.number;
    clearTimeout(this.switchTimer);
    this.switchTimer = setTimeout(() => {
      this.switchingNumber = undefined;
    }, SWITCH_FEEDBACK_MS);
    hassObject.callService(call.domain, call.service, call.data).then(
      () => {
        this.activeNumber = channel.number;
      },
      (error: unknown) => {
        this.dispatchEvent(
          new CustomEvent('hass-notification', {
            detail: { message: t('switchFailed', channel.name, errorText(error)) },
            bubbles: true,
            composed: true,
          }),
        );
      },
    );
  }

  private readonly onSwitch = (event: HTMLElementEventMap['tvg-switch']): void => {
    const channel = this.channelByNumber(event.detail.number);
    if (channel) this.switchTo(channel);
  };

  // ---- search ----

  private readonly onSearch = (event: HTMLElementEventMap['tvg-search']): void => {
    if (!this.config) return;
    this.query = event.detail.query;
    this.runner?.run(this.query, this.config);
    const list = this.renderRoot.querySelector<HTMLElement>('.list');
    if (list) list.scrollTop = 0;
  };

  private readonly onSubmit = (): void => {
    const { config, results } = this;
    if (!config || !results || results.query === '') return;
    const channel = firstResult(results, config);
    if (channel) this.switchTo(channel);
    // Closes the on-screen keyboard.
    this.renderRoot.querySelector('tvg-search-box')?.shadowRoot?.querySelector('input')?.blur();
  };

  // ---- details sheet ----

  /** Finds a programme the user can have tapped: in the schedule, the airings, the search results or on now. */
  private findProgramme(id: string): Programme | undefined {
    const { details, results, nowMap } = this;
    const known = [
      ...(details?.programmes ?? []),
      ...(details?.airings ?? []),
      ...(results?.now ?? []),
      ...(results?.later ?? []),
      ...Object.values(nowMap ?? {}),
    ];
    return known.find((programme): programme is Programme => programme?.id === id);
  }

  private readonly onOpenChannel = (event: HTMLElementEventMap['tvg-open-channel']): void => {
    const channel = this.channelByNumber(event.detail.number);
    if (channel) this.openChannel(channel, this.todayKey());
  };

  private readonly onOpenProgramme = (event: HTMLElementEventMap['tvg-open-programme']): void => {
    const channel = this.channelByNumber(event.detail.number);
    const programme = this.findProgramme(event.detail.programmeId);
    if (!channel || !programme) return;
    const { details } = this;
    if (details?.open && details.channel === channel && details.programmes.some((p) => p.id === programme.id)) {
      this.showProgramme(programme);
      return;
    }
    // The TV day of the start. A programme that began before today's start and still runs belongs to today.
    const day = tvDayKey(Date.parse(programme.start), this.timeZone(), this.config?.tv_day_starts_at ?? 0);
    this.openChannel(channel, day < this.todayKey() ? this.todayKey() : day, programme);
  };

  private readonly onDay = (event: HTMLElementEventMap['tvg-day']): void => {
    if (!this.details) return;
    this.details = { ...this.details, day: event.detail.key, programmes: [], showEarlier: false };
    void this.loadDay();
  };

  private readonly onBack = (): void => {
    if (this.details) this.details = { ...this.details, showProgramme: false };
  };

  private readonly onClose = (): void => {
    if (this.details) this.details = { ...this.details, open: false };
  };

  private readonly onShowEarlier = (): void => {
    if (this.details) this.details = { ...this.details, showEarlier: true };
  };

  /**
   * Opens the sheet on a channel and a TV day, and loads the schedule of that day.
   * With `programme` the programme view opens on top.
   */
  private openChannel(channel: ChannelConfig, day: string, programme?: Programme): void {
    this.nowMs = Date.now();
    this.details = {
      channel,
      open: true,
      day,
      days: [...new Set([this.todayKey(), day])].sort(),
      programmes: [],
      loading: channel.epg_id !== undefined,
      showEarlier: false,
      programme,
      showProgramme: programme !== undefined,
      airings: null,
    };
    void this.loadDay();
    void this.loadDays();
    if (programme) void this.loadAirings(programme);
  }

  private showProgramme(programme: Programme): void {
    if (!this.details) return;
    this.details = { ...this.details, programme, showProgramme: true, airings: null };
    void this.loadAirings(programme);
  }

  /** Loads the schedule of the selected day of the open channel. */
  private async loadDay(): Promise<void> {
    const { client, config, details } = this;
    const run = ++this.scheduleRun;
    if (!client || !config || !details) return;
    const id = details.channel.epg_id;
    if (id === undefined) {
      this.details = { ...details, loading: false };
      return;
    }
    this.details = { ...details, loading: true };
    const { start, end } = tvDayRange(details.day, this.timeZone(), config.tv_day_starts_at);
    const programmes = await client.schedule(id, start, end).catch((): Programme[] => []);
    if (run !== this.scheduleRun || !this.details) return;
    this.details = { ...this.details, programmes, loading: false };
  }

  /** Finds the days that have programmes, for the day chips. */
  private async loadDays(): Promise<void> {
    const { client, config, details } = this;
    const run = ++this.daysRun;
    const id = details?.channel.epg_id;
    if (!client || !config || !details || id === undefined) return;
    const zone = this.timeZone();
    const today = this.todayKey();
    const { start } = tvDayRange(today, zone, config.tv_day_starts_at);
    const programmes = await client.schedule(id, start, start + GUIDE_HORIZON_DAYS * DAY_MS).catch((): Programme[] => []);
    if (run !== this.daysRun || !this.details) return;
    const days = tvDays(programmes, today, zone, config.tv_day_starts_at);
    this.details = { ...this.details, days: [...new Set([...days, this.details.day])].sort() };
  }

  private async loadAirings(programme: Programme): Promise<void> {
    const { client, config } = this;
    const run = ++this.airingsRun;
    if (!client || !config) return;
    const airings = await client.airings(programme.id, channelIds(config)).catch((): Programme[] => []);
    if (run !== this.airingsRun || !this.details) return;
    this.details = { ...this.details, airings };
  }

  // ---- rendering ----

  static styles = tvGuideStyles;

  protected render(): TemplateResult | typeof nothing {
    const { config, hassObject } = this;
    if (!config || !hassObject) return nothing;
    const t = this.strings();
    const stale = this.info && isStale(this.info, this.nowMs);
    return html`<div
      class="frame"
      style="height: ${config.height}"
      @tvg-switch=${this.onSwitch}
      @tvg-open-channel=${this.onOpenChannel}
      @tvg-open-programme=${this.onOpenProgramme}
      @tvg-search=${this.onSearch}
      @tvg-submit=${this.onSubmit}
      @tvg-day=${this.onDay}
      @tvg-back=${this.onBack}
      @tvg-close=${this.onClose}
      @tvg-show-earlier=${this.onShowEarlier}
    >
      <tvg-search-box class="panel" .value=${this.query} .t=${t}></tvg-search-box>
      ${stale && this.info ? html`<div class="stale">${t('staleGuide', this.lastSuccessText())}</div>` : nothing}
      <div class="panel list">${this.renderList(t)}</div>
      ${this.renderToast(t)} ${this.renderDetails(t)}
    </div>`;
  }

  private lastSuccessText(): string {
    const { info, hassObject } = this;
    if (!info || !hassObject) return '';
    const locale = localeOf(resolveLanguage(hassObject.locale.language));
    return formatLastSuccess(info, locale, this.timeZone(), hour12(hassObject.locale.time_format));
  }

  private renderToast(t: Translate): TemplateResult | typeof nothing {
    const channel = this.switchingNumber === undefined ? undefined : this.channelByNumber(this.switchingNumber);
    return channel
      ? html`<div class="toast" role="status">${t('switching', channel.number, channel.name)}</div>`
      : nothing;
  }

  private renderList(t: Translate): TemplateResult {
    if (this.loadError && !this.nowMap) return html`<div class="empty">${t(loadErrorKey(this.loadError))}</div>`;
    if (!this.nowMap) return html`<div class="searching"><span class="spinner"></span>${t('loading')}</div>`;
    const { results } = this;
    if (results && results.query !== '') return this.renderResults(results, t);
    return html`${this.config?.sections.map(
      (section) => html`
        <div class="section">${section.title}</div>
        ${section.channels.map((channel) => this.renderChannelRow(channel, t, false, ''))}
      `,
    )}`;
  }

  private renderChannelRow(channel: ChannelConfig, t: Translate, first: boolean, highlight: string): TemplateResult {
    const { hassObject } = this;
    const language = resolveLanguage(hassObject?.locale.language);
    return html`<tvg-channel-row
      .channel=${channel}
      .logo=${logoOf(channel, this.icons)}
      .programme=${(channel.epg_id === undefined ? undefined : this.nowMap?.[channel.epg_id]) ?? null}
      .now=${this.nowMs}
      .t=${t}
      .locale=${localeOf(language)}
      .timeZone=${this.timeZone()}
      .hour12=${hour12(hassObject?.locale.time_format ?? 'language')}
      .darkMode=${hassObject?.themes.darkMode ?? false}
      .active=${this.activeNumber === channel.number}
      .switching=${this.switchingNumber === channel.number}
      .first=${first}
      .highlight=${highlight}
    ></tvg-channel-row>`;
  }

  private renderProgrammeRow(programme: Programme, t: Translate, first: boolean, highlight: string) {
    const entry = this.entries.get(programme.channel_id);
    const { hassObject, config } = this;
    if (!entry || !config) return nothing;
    return html`<tvg-programme-row
      .channel=${entry.config}
      .logo=${entry.logo}
      .programme=${programme}
      .now=${this.nowMs}
      .todayKey=${this.todayKey()}
      .t=${t}
      .locale=${localeOf(resolveLanguage(hassObject?.locale.language))}
      .timeZone=${this.timeZone()}
      .hour12=${hour12(hassObject?.locale.time_format ?? 'language')}
      .startHour=${config.tv_day_starts_at}
      .darkMode=${hassObject?.themes.darkMode ?? false}
      .first=${first}
      .highlight=${highlight}
    ></tvg-programme-row>`;
  }

  /** The three search steps. Each step shows when it is ready. */
  private renderResults(results: SearchResults, t: Translate): TemplateResult {
    const { query, channels, now, later } = results;
    if (now && later && !channels.length && !now.length && !later.length) {
      return html`<div class="empty">${t('noMatch', this.query.trim())}</div>`;
    }
    const target = this.config ? firstResult(results, this.config) : undefined;
    let firstUsed = false;
    const isFirst = (channel: ChannelConfig | undefined): boolean => {
      if (firstUsed || channel === undefined || channel !== target) return false;
      firstUsed = true;
      return true;
    };
    const programmes = (title: string, items: Programme[] | null): TemplateResult | typeof nothing => {
      if (query.length < PROGRAMME_SEARCH_MIN) return nothing;
      if (items === null) {
        return html`<div class="section">${title}</div>
          <div class="searching"><span class="spinner"></span>${t('searching')}</div>`;
      }
      if (items.length === 0) return nothing;
      return html`<div class="section">${title}</div>
        ${items.map((programme) =>
          this.renderProgrammeRow(programme, t, isFirst(this.entries.get(programme.channel_id)?.config), query),
        )}`;
    };
    return html`${channels.length
      ? html`<div class="section">${t('channels')}</div>
          ${channels.map((channel) => this.renderChannelRow(channel, t, isFirst(channel), query))}`
      : nothing}
    ${programmes(t('onNow'), now)} ${programmes(t('later'), later)}`;
  }

  private renderDetails(t: Translate): TemplateResult | typeof nothing {
    const { details, config, hassObject } = this;
    if (!details || !config || !hassObject) return nothing;
    const { channel, programme } = details;
    const locale = localeOf(resolveLanguage(hassObject.locale.language));
    const timeZone = this.timeZone();
    const use12Hour = hour12(hassObject.locale.time_format);
    const darkMode = hassObject.themes.darkMode;
    const logo = logoOf(channel, this.icons);
    return html`<tvg-sheet .open=${details.open} .showProgramme=${details.showProgramme} .t=${t}>
      <tvg-channel-view
        slot="channel"
        .channel=${channel}
        .logo=${logo}
        .programmes=${details.programmes}
        .days=${details.days}
        .selectedDay=${details.day}
        .todayKey=${this.todayKey()}
        .showEarlier=${details.showEarlier}
        .now=${this.nowMs}
        .t=${t}
        .locale=${locale}
        .timeZone=${timeZone}
        .hour12=${use12Hour}
        .startHour=${config.tv_day_starts_at}
        .darkMode=${darkMode}
        .loading=${details.loading}
      ></tvg-channel-view>
      ${programme
        ? html`<tvg-programme-view
            slot="programme"
            .channel=${channel}
            .logo=${logo}
            .programme=${programme}
            .airings=${details.airings}
            .channelsById=${this.entries}
            .now=${this.nowMs}
            .todayKey=${this.todayKey()}
            .t=${t}
            .locale=${locale}
            .timeZone=${timeZone}
            .hour12=${use12Hour}
            .startHour=${config.tv_day_starts_at}
            .darkMode=${darkMode}
          ></tvg-programme-view>`
        : nothing}
    </tvg-sheet>`;
  }
}

/** Adds the card to the HA card picker. Calling it again does nothing. */
export const registerCard = (): void => {
  window.customCards ??= [];
  if (window.customCards.some((card) => card.type === CARD_TYPE)) return;
  window.customCards.push({ type: CARD_TYPE, name: 'TV guide', description: en.cardDescription });
};

registerCard();
