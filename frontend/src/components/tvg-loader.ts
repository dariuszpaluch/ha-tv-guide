import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * A TV with antenna waves and a text, centered in the space it gets.
 * For data that the user waits for: the channel list and a channel schedule.
 */
@customElement('tvg-loader')
export class TvgLoader extends LitElement {
  /** The text under the TV, for example "Loading…". */
  @property({ attribute: false }) label = '';

  static styles = css`
    :host {
      display: grid;
      place-items: center;
      box-sizing: border-box;
      min-height: 100%;
      padding: 32px 16px;
      color: var(--secondary-text-color);
      font-size: 13px;
    }
    .box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .tv {
      position: relative;
      width: 72px;
      height: 76px;
    }
    svg {
      position: absolute;
      left: 0;
      bottom: 0;
    }
    /* The top arc of a circle: one wave. The three waves start one after another. */
    .wave {
      position: absolute;
      left: 50%;
      translate: -50%;
      box-sizing: border-box;
      border: 3px solid transparent;
      border-top-color: var(--primary-color);
      border-radius: 50%;
      opacity: 0;
      animation: wave 1.5s ease-out infinite;
    }
    .w1 {
      top: 8px;
      width: 18px;
      height: 18px;
    }
    .w2 {
      top: 0;
      width: 34px;
      height: 34px;
      animation-delay: 0.25s;
    }
    .w3 {
      top: -8px;
      width: 50px;
      height: 50px;
      animation-delay: 0.5s;
    }
    @keyframes wave {
      30% {
        opacity: 1;
      }
      100% {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .wave {
        animation: none;
        opacity: 1;
      }
    }
  `;

  protected render() {
    return html`<div class="box" role="status">
      <span class="tv" aria-hidden="true">
        <span class="wave w1"></span><span class="wave w2"></span><span class="wave w3"></span>
        <svg width="72" height="50" viewBox="0 0 72 50">
          <rect x="2" y="2" width="68" height="40" rx="8" fill="none" stroke="currentColor" stroke-width="3" />
          <rect x="23" y="46" width="26" height="4" rx="2" fill="currentColor" />
        </svg>
      </span>
      <span class="label">${this.label}</span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tvg-loader': TvgLoader;
  }
}
