import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { SwipeController } from '../controllers/swipe-controller';
import type { Translate } from '../i18n';
import { fire } from './events';

/** Time of the close animation. The dialog leaves the top layer after it. */
export const SHEET_CLOSE_MS = 280;

/**
 * The details sheet: a modal dialog with two views. The channel view is the base;
 * the programme view slides over it. The parent owns `open` and `showProgramme` and fills the
 * `channel` and `programme` slots, and optionally the `toast` slot. Each view should start
 * with a `header` element: a drag down on it closes the sheet.
 *
 * The dialog opens with `showModal()`, so the browser shows it above the whole page,
 * not inside the card: full screen on a phone, a centered dialog on a bigger screen.
 *
 * Fires `tvg-close` (backdrop, grab bar or header dragged down, Escape) and `tvg-back` (programme
 * view swiped right).
 */
@customElement('tvg-sheet')
export class TvgSheet extends LitElement {
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean, attribute: 'show-programme' }) showProgramme = false;
  @property({ attribute: false }) t!: Translate;

  private closeTimer?: ReturnType<typeof setTimeout>;

  private readonly close = (): void => fire(this, 'tvg-close', {});
  private readonly sheet = (): HTMLDialogElement | null => this.renderRoot.querySelector('.sheet');
  private readonly view = (name: 'channel' | 'prog'): HTMLElement | null =>
    this.renderRoot.querySelector(`.view.${name}`);

  // The backdrop fades with the sheet while the finger moves it. Plain DOM writes: no render per move.
  private readonly fadeScrim = (share: number | null): void => {
    const style = this.sheet()?.style;
    if (share === null) style?.removeProperty('--tvg-scrim');
    else style?.setProperty('--tvg-scrim', String(1 - share));
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
    /* The dialog shows in the top layer. The host keeps a box of no size, so swipes can capture the pointer on it. */
    :host {
      position: absolute;
    }
    /* Phone: full screen, slides up from the bottom. */
    .sheet {
      --tvg-hidden: translateY(100%);
      box-sizing: border-box;
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      margin: 0;
      padding: 0;
      border: 0;
      overflow: hidden;
      background: var(--card-background-color);
      color: var(--primary-text-color);
      outline: none;
      transform: var(--tvg-hidden);
      opacity: 0;
      transition:
        transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1),
        opacity 0.28s;
    }
    .sheet.open {
      transform: none;
      opacity: 1;
    }
    /* The dialog enters the top layer and gets the open class in the same frame; this is where the animation starts. */
    @starting-style {
      .sheet.open {
        transform: var(--tvg-hidden);
        opacity: 0;
      }
    }
    .sheet::backdrop {
      background: var(--mdc-dialog-scrim-color, rgba(0, 0, 0, 0.32));
      opacity: 0;
      transition: opacity 0.2s;
    }
    .sheet.open::backdrop {
      opacity: var(--tvg-scrim, 1);
    }
    @starting-style {
      .sheet.open::backdrop {
        opacity: 0;
      }
    }
    /* Bigger screen: a centered dialog. */
    @media (min-width: 601px) and (min-height: 501px) {
      .sheet {
        --tvg-hidden: translateY(32px);
        width: min(560px, 100% - 48px);
        height: min(800px, 100% - 64px);
        margin: auto;
        border-radius: var(--ha-dialog-border-radius, 24px);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
      }
    }
    /* The phone notch and home bar stay free. */
    .body {
      position: absolute;
      inset: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px);
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
    @media (prefers-reduced-motion: reduce) {
      .sheet,
      .sheet::backdrop,
      .view.prog {
        transition: none;
      }
    }
  `;

  disconnectedCallback(): void {
    clearTimeout(this.closeTimer);
    // A dialog that leaves the page also leaves the top layer, so it must open again when it comes back.
    this.sheet()?.close();
    super.disconnectedCallback();
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated && this.open) this.showDialog();
  }

  protected updated(changed: PropertyValues<this>): void {
    if (!changed.has('open')) return;
    if (this.open) this.showDialog();
    else this.hideDialog();
  }

  private showDialog(): void {
    const sheet = this.sheet();
    clearTimeout(this.closeTimer);
    if (!sheet?.isConnected) return;
    if (!sheet.open) sheet.showModal();
    // The focus goes to the sheet, not to its first button, so no focus ring shows on open.
    sheet.focus({ preventScroll: true });
  }

  /** The sheet slides away first; the dialog closes when the animation is over. */
  private hideDialog(): void {
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.sheet()?.close(), SHEET_CLOSE_MS);
  }

  /** Escape asks the parent to close, so the sheet can slide away. */
  private readonly onCancel = (event: Event): void => {
    event.preventDefault();
    if (this.open) this.close();
  };

  /**
   * The browser can close the dialog itself, for example after a second Escape. The parent must then know.
   * A sheet that leaves the page closes its dialog too; that close is not the user's, so it is skipped.
   */
  private readonly onNativeClose = (): void => {
    if (this.open && this.isConnected && !this.sheet()?.open) this.close();
  };

  /** A click on the backdrop has the dialog as its target: the views cover all of the dialog. */
  private readonly onClick = (event: MouseEvent): void => {
    if (event.target === event.currentTarget) this.close();
  };

  protected render() {
    return html`
      <dialog
        class="sheet ${this.open ? 'open' : ''} ${this.showProgramme ? 'prog-open' : ''}"
        aria-label=${this.t('sheet')}
        tabindex="-1"
        ?inert=${!this.open}
        @cancel=${this.onCancel}
        @close=${this.onNativeClose}
        @click=${this.onClick}
      >
        <div class="body">
          <div class="grab" aria-hidden="true"></div>
          <div class="view channel"><slot name="channel"></slot></div>
          <div class="view prog" ?inert=${!this.showProgramme}>
            <slot name="programme"></slot>
          </div>
        </div>
        <slot name="toast"></slot>
      </dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tvg-sheet': TvgSheet;
  }
}
