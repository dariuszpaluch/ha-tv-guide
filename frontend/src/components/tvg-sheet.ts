import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { SwipeController } from '../controllers/swipe-controller';
import type { Translate } from '../i18n';
import { fire } from './events';

/**
 * The details sheet: a scrim and a bottom sheet with two views. The channel view is the base;
 * the programme view slides over it. The parent owns `open` and `showProgramme` and fills the
 * `channel` and `programme` slots. Each view should start with a `header` element: a drag
 * down on it closes the sheet.
 *
 * Fires `tvg-close` (scrim, grab bar or header dragged down, Escape) and `tvg-back` (programme
 * view swiped right).
 */
@customElement('tvg-sheet')
export class TvgSheet extends LitElement {
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean, attribute: 'show-programme' }) showProgramme = false;
  @property({ attribute: false }) t!: Translate;

  private readonly close = (): void => fire(this, 'tvg-close', {});
  private readonly sheet = (): HTMLElement | null => this.renderRoot.querySelector('.sheet');
  private readonly view = (name: 'channel' | 'prog'): HTMLElement | null =>
    this.renderRoot.querySelector(`.view.${name}`);

  // The scrim fades with the sheet while the finger moves it. Plain DOM writes: no render per move.
  private readonly fadeScrim = (share: number | null): void => {
    const scrim = this.renderRoot.querySelector<HTMLElement>('.scrim');
    if (scrim) scrim.style.opacity = share === null ? '' : String(1 - share);
  };

  private closeSwipe(element: () => HTMLElement | null, from?: string): void {
    new SwipeController(this, {
      element,
      axis: 'y',
      target: this.sheet,
      enabled: () => this.open,
      from,
      onDone: this.close,
      onProgress: this.fadeScrim,
    });
  }

  // Both close drags and the swipe back listen on the host, not on the views in the shadow DOM:
  // the views are slotted, and the pointer events of slotted content bubble through the host.
  constructor() {
    super();
    // The controllers register themselves with the host.
    new SwipeController(this, {
      element: () => this,
      axis: 'x',
      target: () => this.view('prog'),
      enabled: () => this.open && this.showProgramme,
      from: '[slot="programme"]',
      onDone: () => fire(this, 'tvg-back', {}),
    });
    this.closeSwipe(() => this.renderRoot.querySelector<HTMLElement>('.grab'));
    this.closeSwipe(() => this, 'header');
  }

  static styles = css`
    :host {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .scrim {
      position: absolute;
      inset: 0;
      z-index: 10;
      background: var(--mdc-dialog-scrim-color, rgba(0, 0, 0, 0.32));
      opacity: 0;
      transition: opacity 0.2s;
    }
    .scrim.open {
      opacity: 1;
      pointer-events: auto;
    }
    .sheet {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 92%;
      z-index: 11;
      overflow: hidden;
      border-radius: 20px 20px 0 0;
      background: var(--card-background-color);
      color: var(--primary-text-color);
      transform: translateY(105%);
      transition: transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
      outline: none;
    }
    .sheet.open {
      transform: none;
      pointer-events: auto;
    }
    .view {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      background: var(--card-background-color);
    }
    .view.prog {
      z-index: 3;
      transform: translateX(100%);
      transition: transform 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
      box-shadow: -8px 0 24px var(--divider-color);
      /* Horizontal moves are ours (swipe back); vertical moves scroll the content. */
      touch-action: pan-y;
    }
    .sheet.prog-open .view.prog {
      transform: none;
    }
    ::slotted(*) {
      flex: 1;
      min-height: 0;
    }
    .grab {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 18px;
      z-index: 5;
      touch-action: none;
      cursor: grab;
    }
    .grab::after {
      content: '';
      position: absolute;
      top: 7px;
      left: 50%;
      translate: -50%;
      width: 36px;
      height: 4px;
      border-radius: 2px;
      background: var(--disabled-text-color);
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('keydown', this.onKeydown);
  }

  disconnectedCallback(): void {
    this.removeEventListener('keydown', this.onKeydown);
    super.disconnectedCallback();
  }

  protected updated(changed: PropertyValues<this>): void {
    // Escape only reaches the sheet when the focus is inside it.
    if (changed.has('open') && this.open) this.sheet()?.focus({ preventScroll: true });
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.open) this.close();
  };

  protected render() {
    return html`
      <div class="scrim ${this.open ? 'open' : ''}" @click=${this.close}></div>
      <div
        class="sheet ${this.open ? 'open' : ''} ${this.showProgramme ? 'prog-open' : ''}"
        role="dialog"
        aria-label=${this.t('sheet')}
        tabindex="-1"
        ?inert=${!this.open}
      >
        <div class="grab" aria-hidden="true"></div>
        <div class="view channel"><slot name="channel"></slot></div>
        <div class="view prog" ?inert=${!this.showProgramme}>
          <slot name="programme"></slot>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tvg-sheet': TvgSheet;
  }
}
