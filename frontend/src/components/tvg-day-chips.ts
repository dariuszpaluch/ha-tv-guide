import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { fire } from './events';

/** A row of day buttons. The selected day is pressed; a tap fires `tvg-day`. */
@customElement('tvg-day-chips')
export class TvgDayChips extends LitElement {
  /** Day keys, `YYYY-MM-DD`, in the order to show. */
  @property({ attribute: false }) days: string[] = [];
  @property({ attribute: false }) selected = '';
  /** Text of each chip by day key, for example "Today". A day without a label shows its key. */
  @property({ attribute: false }) labels: Record<string, string> = {};
  /** Accessible name of the whole group. */
  @property({ attribute: false }) groupLabel = '';

  static styles = css`
    :host {
      display: block;
    }
    .days {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding: 10px 12px;
      background: var(--card-background-color);
      border-bottom: 1px solid var(--divider-color);
      scrollbar-width: none;
    }
    .days::-webkit-scrollbar {
      display: none;
    }
    button {
      flex: none;
      height: 32px;
      padding: 0 14px;
      border-radius: 16px;
      border: 1px solid var(--divider-color);
      background: none;
      color: inherit;
      font: inherit;
      font-size: 13px;
      white-space: nowrap;
      cursor: pointer;
    }
    button[aria-pressed='true'] {
      background: var(--primary-color);
      border-color: var(--primary-color);
      color: var(--text-primary-color, #fff);
    }
    :focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }
  `;

  protected render() {
    return html`<div class="days" role="group" aria-label=${this.groupLabel}>
      ${this.days.map(
        (key) => html`<button aria-pressed=${key === this.selected} @click=${() => fire(this, 'tvg-day', { key })}>
          ${this.labels[key] ?? key}
        </button>`,
      )}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tvg-day-chips': TvgDayChips;
  }
}
