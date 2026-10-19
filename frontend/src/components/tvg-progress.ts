import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

/** A thin bar that shows how much of a programme has passed. The text next to it says the same in words. */
@customElement('tvg-progress')
export class TvgProgress extends LitElement {
  /** Percent, from 0 to 100. */
  @property({ attribute: false }) value = 0;

  static styles = css`
    :host {
      display: block;
    }
    .bar {
      height: 3px;
      border-radius: 2px;
      background: var(--tvg-track, color-mix(in srgb, var(--primary-text-color) 10%, transparent));
      overflow: hidden;
    }
    .bar > i {
      display: block;
      height: 100%;
      background: var(--primary-color);
      border-radius: inherit;
    }
  `;

  protected render() {
    return html`<div class="bar" aria-hidden="true"><i style=${styleMap({ width: `${this.value}%` })}></i></div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tvg-progress': TvgProgress;
  }
}
