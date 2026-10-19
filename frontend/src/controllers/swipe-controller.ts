import type { ReactiveController, ReactiveControllerHost } from 'lit';

/** A move shorter than this is not yet a drag. The direction is decided when it is passed. */
export const SWIPE_DECIDE_PX = 8;
/** A drag longer than this share of the target size is done. */
export const SWIPE_DONE_SHARE = 0.3;
/** A drag faster than this is done, however short. */
export const FLICK_PX_PER_MS = 0.5;

export interface SwipeOptions {
  /** The element that listens for the pointer. It can change between renders. */
  element: () => HTMLElement | null;
  /** `x` follows a drag to the right, `y` follows a drag down. */
  axis: 'x' | 'y';
  /** The element that moves with the finger. */
  target: () => HTMLElement | null;
  enabled: () => boolean;
  /** CSS selector: the drag must start inside a matching element on the event path, below the listening element. */
  from?: string;
  onDone: () => void;
  /** Share of the target size that is dragged (0 to 1), or `null` when the drag is over. */
  onProgress?: (share: number | null) => void;
}

interface Drag {
  x: number;
  y: number;
  time: number;
  pointerId: number;
  active: boolean;
}

/**
 * Follows a one-direction drag (right or down) and calls `onDone` when it is far or fast enough.
 * A move in the other direction stays with the browser, so the view can still scroll.
 * A finished drag also stops the click that follows it, so it is never also a tap.
 */
export class SwipeController implements ReactiveController {
  private element: HTMLElement | null = null;
  private drag: Drag | null = null;
  private justDragged = false;

  constructor(
    private readonly host: ReactiveControllerHost & HTMLElement,
    private readonly options: SwipeOptions,
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    this.host.addEventListener('click', this.onClickCapture, true);
    // After a move in the DOM the host reconnects without a new render, so `hostUpdated` does not run.
    this.hostUpdated();
  }

  /** The listening element is inside the rendered DOM, so it is picked up after each render. */
  hostUpdated(): void {
    const element = this.options.element();
    if (element === this.element) return;
    this.detach();
    this.element = element;
    element?.addEventListener('pointerdown', this.onDown);
    element?.addEventListener('pointermove', this.onMove);
    element?.addEventListener('pointerup', this.onEnd);
    element?.addEventListener('pointercancel', this.onEnd);
  }

  hostDisconnected(): void {
    this.host.removeEventListener('click', this.onClickCapture, true);
    this.detach();
  }

  private detach(): void {
    this.element?.removeEventListener('pointerdown', this.onDown);
    this.element?.removeEventListener('pointermove', this.onMove);
    this.element?.removeEventListener('pointerup', this.onEnd);
    this.element?.removeEventListener('pointercancel', this.onEnd);
    this.element = null;
    this.drag = null;
  }

  /** True when the event path (from the target up to the listening element) has a match for `from`. */
  private startsInside(event: PointerEvent): boolean {
    const { from } = this.options;
    if (!from) return true;
    // The path crosses shadow roots, so a header inside a slotted component still counts.
    for (const node of event.composedPath()) {
      if (node instanceof Element && node.matches(from)) return true;
      if (node === this.element) return false;
    }
    return false;
  }

  private along(event: PointerEvent, drag: Drag): number {
    return this.options.axis === 'x' ? event.clientX - drag.x : event.clientY - drag.y;
  }

  private across(event: PointerEvent, drag: Drag): number {
    return this.options.axis === 'x' ? event.clientY - drag.y : event.clientX - drag.x;
  }

  private onDown = (event: PointerEvent): void => {
    if (!this.options.enabled() || event.button > 0 || !this.startsInside(event)) return;
    this.drag = {
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      pointerId: event.pointerId,
      active: false,
    };
  };

  private onMove = (event: PointerEvent): void => {
    const { drag, element } = this;
    const target = this.options.target();
    if (!drag || !element || !target || event.pointerId !== drag.pointerId) return;
    const along = this.along(event, drag);
    const across = this.across(event, drag);
    if (!drag.active) {
      if (Math.max(Math.abs(along), Math.abs(across)) < SWIPE_DECIDE_PX) return;
      if (along <= 0 || Math.abs(across) > along) {
        this.drag = null;
        return;
      }
      drag.active = true;
      this.capture(element, event.pointerId, true);
      target.style.transition = 'none';
    }
    const offset = Math.max(0, along);
    target.style.transform = this.options.axis === 'x' ? `translateX(${offset}px)` : `translateY(${offset}px)`;
    this.options.onProgress?.(offset / this.size(target));
  };

  private onEnd = (event: PointerEvent): void => {
    const { drag, element } = this;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    if (!drag.active) return;
    if (element) this.capture(element, event.pointerId, false);

    const target = this.options.target();
    const along = this.along(event, drag);
    const fast = along / Math.max(1, event.timeStamp - drag.time) > FLICK_PX_PER_MS;
    const far = target ? along > this.size(target) * SWIPE_DONE_SHARE : false;

    // The click of this pointerup comes right after it, in the same task queue turn.
    this.justDragged = true;
    setTimeout(() => {
      this.justDragged = false;
    }, 0);
    if (target) {
      target.style.transition = '';
      target.style.transform = '';
    }
    this.options.onProgress?.(null);
    if (event.type === 'pointerup' && (far || fast)) this.options.onDone();
  };

  /** Capture can throw when the browser has already dropped the pointer; the drag works without it. */
  private capture(element: HTMLElement, pointerId: number, on: boolean): void {
    try {
      if (on) element.setPointerCapture(pointerId);
      else element.releasePointerCapture(pointerId);
    } catch {
      // Nothing to do: the pointer is gone.
    }
  }

  private onClickCapture = (event: Event): void => {
    if (!this.justDragged) return;
    event.stopPropagation();
    event.preventDefault();
  };

  private size(target: HTMLElement): number {
    return Math.max(1, this.options.axis === 'x' ? target.offsetWidth : target.offsetHeight);
  }
}
