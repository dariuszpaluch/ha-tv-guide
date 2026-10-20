import { afterEach, expect, test, vi } from 'vitest';
import { tEn } from '../fixtures';
import { SHEET_CLOSE_MS, type TvgSheet } from '../../src/components/tvg-sheet';

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
  const part = <T extends HTMLElement = HTMLElement>(selector: string) => el.shadowRoot?.querySelector(selector) as T;
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

const cancel = (el: TvgSheet): Event => {
  const event = new Event('cancel', { cancelable: true });
  el.shadowRoot?.querySelector('dialog')?.dispatchEvent(event);
  return event;
};

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

test('a click on the backdrop fires tvg-close, a click inside a view does not', async () => {
  const { el, part, onClose } = await mount();
  slotted(el, 'channel', '.content').click();
  expect(onClose).not.toHaveBeenCalled();
  // The browser gives a backdrop click to the dialog itself.
  part('.sheet').click();
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('Escape fires tvg-close and keeps the dialog open for the slide-away', async () => {
  const { el, part, onClose } = await mount();
  const event = cancel(el);
  expect(event.defaultPrevented).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(part<HTMLDialogElement>('.sheet').open).toBe(true);
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

test('the backdrop follows a drag down and returns when it ends', async () => {
  const { part } = await mount();
  const grab = part('.grab');
  grab.dispatchEvent(pointer('pointerdown', 150, 0, 1000));
  grab.dispatchEvent(pointer('pointermove', 150, 250, 1010));
  expect(part('.sheet').style.getPropertyValue('--tvg-scrim')).toBe('0.5');
  grab.dispatchEvent(pointer('pointercancel', 150, 250, 1020));
  expect(part('.sheet').style.getPropertyValue('--tvg-scrim')).toBe('');
});

test('is a labelled modal dialog and reflects the open state', async () => {
  const { el, part } = await mount({ open: false });
  const sheet = part<HTMLDialogElement>('.sheet');
  const showModal = vi.spyOn(sheet, 'showModal');
  expect(sheet.localName).toBe('dialog');
  expect(sheet.getAttribute('aria-label')).toBe('Channel details');
  expect(sheet.open).toBe(false);
  expect(sheet.hasAttribute('inert')).toBe(true);
  expect(sheet.classList.contains('open')).toBe(false);

  el.open = true;
  el.showProgramme = true;
  await el.updateComplete;
  expect(showModal).toHaveBeenCalledOnce();
  expect(sheet.open).toBe(true);
  expect(sheet.hasAttribute('inert')).toBe(false);
  expect(sheet.classList.contains('open')).toBe(true);
  expect(sheet.classList.contains('prog-open')).toBe(true);
});

test('the dialog closes when the slide-away is over, and opening again in time keeps it open', async () => {
  vi.useFakeTimers();
  const { el, part, onClose } = await mount();
  const sheet = part<HTMLDialogElement>('.sheet');
  el.open = false;
  await el.updateComplete;
  expect(sheet.classList.contains('open')).toBe(false);
  expect(sheet.open).toBe(true);
  vi.advanceTimersByTime(SHEET_CLOSE_MS);
  expect(sheet.open).toBe(false);
  // The parent closed the sheet, so it hears nothing back.
  expect(onClose).not.toHaveBeenCalled();

  el.open = true;
  await el.updateComplete;
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  vi.advanceTimersByTime(SHEET_CLOSE_MS);
  expect(sheet.open).toBe(true);
});

test('a dialog that the browser closes on its own fires tvg-close', async () => {
  const { part, onClose } = await mount();
  part<HTMLDialogElement>('.sheet').close();
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('the toast slot is inside the dialog, so the note shows above the backdrop', async () => {
  const { part } = await mount();
  expect(part('.sheet slot[name="toast"]')).not.toBeNull();
});

test('swipes still work and the dialog opens again after the sheet is moved in the DOM', async () => {
  const { el, part, onClose, onBack } = await mount({ showProgramme: true });
  const parent = document.createElement('section');
  document.body.append(parent);
  parent.append(el);
  await el.updateComplete;
  expect(part<HTMLDialogElement>('.sheet').open).toBe(true);
  expect(onClose).not.toHaveBeenCalled();

  drag(part('.grab'), [150, 0], [150, 200], 400);
  expect(onClose).toHaveBeenCalledTimes(1);
  drag(slotted(el, 'programme', '.content'), [0, 100], [150, 100], 400);
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('Escape does nothing while the sheet is closed', async () => {
  const { el, onClose } = await mount({ open: false });
  cancel(el);
  expect(onClose).not.toHaveBeenCalled();
});
