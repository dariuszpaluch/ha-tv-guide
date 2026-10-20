import type { ChannelNumber } from '../config';

/** Detail of every event the card parts send to their parent. */
export interface TvgEventDetails {
  'tvg-switch': { number: ChannelNumber };
  'tvg-open-channel': { number: ChannelNumber };
  'tvg-open-programme': { number: ChannelNumber; programmeId: string };
  'tvg-search': { query: string };
  'tvg-submit': Record<string, never>;
  'tvg-day': { key: string };
  'tvg-back': Record<string, never>;
  'tvg-close': Record<string, never>;
  'tvg-show-earlier': Record<string, never>;
  'tvg-reminder': { programmeId: string; on: boolean };
}

declare global {
  interface HTMLElementEventMap {
    'tvg-switch': CustomEvent<TvgEventDetails['tvg-switch']>;
    'tvg-open-channel': CustomEvent<TvgEventDetails['tvg-open-channel']>;
    'tvg-open-programme': CustomEvent<TvgEventDetails['tvg-open-programme']>;
    'tvg-search': CustomEvent<TvgEventDetails['tvg-search']>;
    'tvg-submit': CustomEvent<TvgEventDetails['tvg-submit']>;
    'tvg-day': CustomEvent<TvgEventDetails['tvg-day']>;
    'tvg-back': CustomEvent<TvgEventDetails['tvg-back']>;
    'tvg-close': CustomEvent<TvgEventDetails['tvg-close']>;
    'tvg-show-earlier': CustomEvent<TvgEventDetails['tvg-show-earlier']>;
    'tvg-reminder': CustomEvent<TvgEventDetails['tvg-reminder']>;
  }
}

/**
 * Sends one of the card events. It bubbles and crosses shadow roots, so any ancestor can listen.
 * @param host The element that sends the event.
 * @param name Event name.
 * @param detail Event detail; its type follows the name.
 */
export const fire = <K extends keyof TvgEventDetails>(host: EventTarget, name: K, detail: TvgEventDetails[K]): void => {
  host.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
};
