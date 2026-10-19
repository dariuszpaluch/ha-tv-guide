import { afterEach, expect, test, vi } from 'vitest';
import { tEn } from '../test/fixtures';
import './tvg-sheet';
import type { TvgSheet } from './tvg-sheet';

const mount = async (props: { open?: boolean; showProgramme?: boolean } = {}) => {
  const el = document.createElement('tvg-sheet') as TvgSheet;
  el.t = tEn;
  el.open = props.open ?? true;
  el.showProgramme = props.showProgramme ?? false;
  el.innerHTML = `
    <div slot="channel"><header>Channel</header><div class="content">Schedule</div></div>
    <div slot="programme"><header>Programme</header><div class="content">Details</div></div>`;
  document.body.append(el);
  await el.updateComplete;
  const part = (selector: string) => el.shadowRoot?.querySelector(selector) as HTMLElement;
  for (const selector of ['.sheet', '.view.prog']) {
    Object.defineProperty(part(selector), 'offsetWidth', { value: 300 });
    Object.defineProperty(part(selector), 'offsetHeight', { value: 500 });
  }
  const listen = (name: 'tvg-close' | 'tvg-back') => {
    const handler = vi.fn();
    el.addEventListener(name, handler);
    return handler;
  };
  return { el, part, onClose: listen('tvg-close'), onBack: listen('tvg-back') };
};

const pointer = (type: string, x: number, y: number, time: number): PointerEvent => {
  const event = new PointerEvent(type, {
    pointerId: 1,
    button: 0,
    clientX: x,
    clientY: y,
    bubbles: true,
    composed: true,
  });
  Object.defineProperty(event, 'timeStamp', { value: time });
  return event;
};

const drag = (el: Element, from: [number, number], to: [number, number], ms: number) => {
  el.dispatchEvent(pointer('pointerdown', ...from, 1000));
  el.dispatchEvent(pointer('pointermove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, 1000 + ms / 2));
  el.dispatchEvent(pointer('pointermove', ...to, 1000 + ms));
  el.dispatchEvent(pointer('pointerup', ...to, 1000 + ms));
};

const slotted = (el: TvgSheet, slot: string, selector: string) =>
  el.querySelector(`[slot="${slot}"] ${selector}`) as HTMLElement;

afterEach(() => document.body.replaceChildren());

test('scrim click fires tvg-close', async () => {
  const { part, onClose } = await mount();
  part('.scrim').click();
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('Escape fires tvg-close, other keys do not', async () => {
  const { el, onClose } = await mount();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
  expect(onClose).not.toHaveBeenCalled();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('dragging the grab bar down fires tvg-close', async () => {
  const { part, onClose } = await mount();
  drag(part('.grab'), [150, 0], [150, 200], 400);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('dragging a header down fires tvg-close, in both views', async () => {
  const { el, onClose } = await mount({ showProgramme: true });
  drag(slotted(el, 'channel', 'header'), [150, 0], [150, 200], 400);
  expect(onClose).toHaveBeenCalledTimes(1);
  drag(slotted(el, 'programme', 'header'), [150, 0], [150, 200], 400);
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('a short slow drag on the header does not close', async () => {
  const { el, onClose } = await mount();
  drag(slotted(el, 'channel', 'header'), [150, 0], [150, 30], 400);
  expect(onClose).not.toHaveBeenCalled();
});

test('a vertical drag inside the scrolling content does not close', async () => {
  const { el, onClose, onBack } = await mount({ showProgramme: true });
  drag(slotted(el, 'channel', '.content'), [150, 0], [150, 300], 100);
  drag(slotted(el, 'programme', '.content'), [150, 0], [150, 300], 100);
  expect(onClose).not.toHaveBeenCalled();
  expect(onBack).not.toHaveBeenCalled();
});

test('a long right swipe on the programme view fires tvg-back', async () => {
  const { el, onBack, onClose } = await mount({ showProgramme: true });
  drag(slotted(el, 'programme', '.content'), [0, 100], [150, 100], 400);
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
});

test('a right swipe does not fire tvg-back while the programme view is hidden', async () => {
  const { el, onBack } = await mount({ showProgramme: false });
  drag(slotted(el, 'programme', '.content'), [0, 100], [150, 100], 400);
  expect(onBack).not.toHaveBeenCalled();
});

test('the scrim follows a drag down and returns when it ends', async () => {
  const { part } = await mount();
  const grab = part('.grab');
  grab.dispatchEvent(pointer('pointerdown', 150, 0, 1000));
  grab.dispatchEvent(pointer('pointermove', 150, 250, 1010));
  expect(part('.scrim').style.opacity).toBe('0.5');
  grab.dispatchEvent(pointer('pointercancel', 150, 250, 1020));
  expect(part('.scrim').style.opacity).toBe('');
});

test('is a labelled dialog and reflects the open state', async () => {
  const { el, part } = await mount({ open: false });
  expect(part('.sheet').getAttribute('role')).toBe('dialog');
  expect(part('.sheet').getAttribute('aria-label')).toBe('Channel details');
  expect(part('.sheet').hasAttribute('inert')).toBe(true);
  expect(part('.sheet').classList.contains('open')).toBe(false);

  el.open = true;
  el.showProgramme = true;
  await el.updateComplete;
  expect(part('.sheet').hasAttribute('inert')).toBe(false);
  expect(part('.sheet').classList.contains('open')).toBe(true);
  expect(part('.sheet').classList.contains('prog-open')).toBe(true);
});
