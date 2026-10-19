import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Translate } from '../i18n';
import { fire } from './events';
import { icon, iconStyles } from './icons';

/** The search field. It reports every change and Enter; the parent owns the query and the search. */
@customElement('tvg-search-box')
export class TvgSearchBox extends LitElement {
  @property({ attribute: false }) value = '';
  @property({ attribute: false }) t!: Translate;

  static styles = [
    iconStyles,
    css`
      :host {
        display: block;
      }
      .search {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 52px;
        padding: 0 14px;
        color: var(--secondary-text-color);
      }
      input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: 0;
        background: none;
        font: inherit;
        font-size: 16px;
        color: var(--primary-text-color);
      }
      input::placeholder {
        color: var(--secondary-text-color);
      }
      input::-webkit-search-cancel-button {
        display: none;
      }
      .clear {
        display: grid;
        place-items: center;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: none;
        color: inherit;
        cursor: pointer;
      }
      :focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
      }
    `,
  ];

  private onInput(event: Event): void {
    fire(this, 'tvg-search', { query: (event.target as HTMLInputElement).value });
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') fire(this, 'tvg-submit', {});
  }

  private clear(): void {
    fire(this, 'tvg-search', { query: '' });
    this.shadowRoot?.querySelector('input')?.focus();
  }

  protected render() {
    return html`<div class="search">
      ${icon('search')}
      <input
        type="search"
        enterkeyhint="search"
        autocomplete="off"
        .value=${this.value}
        placeholder=${this.t('search')}
        aria-label=${this.t('search')}
        @input=${this.onInput}
        @keydown=${this.onKeydown}
      />
      ${this.value
        ? html`<button class="clear" aria-label=${this.t('clear')} @click=${this.clear}>${icon('close')}</button>`
        : nothing}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tvg-search-box': TvgSearchBox;
  }
}
