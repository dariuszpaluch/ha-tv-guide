import type { ReactiveControllerHost } from 'lit';
import { afterEach, expect, test, vi } from 'vitest';
import { SwipeController } from '../../src/controllers/swipe-controller';

const WIDTH = 300;
const HEIGHT = 500;

const sized = (el: HTMLElement): HTMLElement => {
  Object.defineProperty(el, 'offsetWidth', { value: WIDTH });
  Object.defineProperty(el, 'offsetHeight', { value: HEIGHT });
  return el;
};

const pointer = (type: string, x: number, y: number, time: number, id = 1): PointerEvent => {
  const event = new PointerEvent(type, {
    pointerId: id,
    button: 0,
    clientX: x,
    clientY: y,
    bubbles: true,
  });
  Object.defineProperty(event, 'timeStamp', { value: time });
  return event;
};

/** Drags with one move halfway and one at the end; returns after pointerup. */
const drag = (el: HTMLElement, from: [number, number], to: [number, number], ms: number, start = 1000) => {
  el.dispatchEvent(pointer('pointerdown', from[0], from[1], start));
  el.dispatchEvent(pointer('pointermove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, start + ms / 2));
  el.dispatchEvent(pointer('pointermove', to[0], to[1], start + ms));
  el.dispatchEvent(pointer('pointerup', to[0], to[1], start + ms));
};

const setup = (options: { axis?: 'x' | 'y'; enabled?: boolean; from?: string } = {}) => {
  const host = document.createElement('div') as unknown as HTMLElement & ReactiveControllerHost;
  Object.assign(host, {
    addController: vi.fn(),
    removeController: vi.fn(),
    requestUpdate: vi.fn(),
  });
  const header = document.createElement('header');
  const body = document.createElement('p');
  const element = sized(document.createElement('div'));
  element.append(header, body);
  host.append(element);
  document.body.append(host);
  const onDone = vi.fn();
  const onProgress = vi.fn();
  const controller = new SwipeController(host, {
    element: () => element,
    axis: options.axis ?? 'x',
    target: () => element,
    enabled: () => options.enabled ?? true,
    from: options.from,
    onDone,
    onProgress,
  });
  controller.hostConnected();
  controller.hostUpdated();
  return { host, element, header, body, onDone, onProgress, controller };
};

afterEach(() => document.body.replaceChildren());

test('long right swipe calls onDone', () => {
  const { element, onDone } = setup();
  drag(element, [0, 100], [150, 100], 400);
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('short slow swipe does not call onDone and the view springs back', () => {
  const { element, onDone } = setup();
  drag(element, [0, 100], [40, 100], 400);
  expect(onDone).not.toHaveBeenCalled();
  expect(element.style.transform).toBe('');
  expect(element.style.transition).toBe('');
});

test('flick calls onDone', () => {
  const { element, onDone } = setup();
  drag(element, [0, 100], [60, 100], 50);
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('the view follows the finger while dragging', () => {
  const { element } = setup();
  element.dispatchEvent(pointer('pointerdown', 0, 100, 1000));
  element.dispatchEvent(pointer('pointermove', 50, 100, 1010));
  expect(element.style.transform).toBe('translateX(50px)');
  expect(element.hasPointerCapture(1)).toBe(true);
  element.dispatchEvent(pointer('pointerup', 50, 100, 1020));
  expect(element.hasPointerCapture(1)).toBe(false);
});

test('vertical move on an x controller does not call onDone and is left to the browser', () => {
  const { element, onDone } = setup();
  drag(element, [100, 0], [100, 400], 400);
  expect(onDone).not.toHaveBeenCalled();
  expect(element.style.transform).toBe('');
  expect(element.hasPointerCapture(1)).toBe(false);
});

test('swipe in the wrong direction (left) does not call onDone', () => {
  const { element, onDone } = setup();
  drag(element, [200, 100], [0, 100], 50);
  expect(onDone).not.toHaveBeenCalled();
});

test('a y controller follows a downward drag and reports progress', () => {
  const { element, onDone, onProgress } = setup({ axis: 'y' });
  element.dispatchEvent(pointer('pointerdown', 100, 0, 1000));
  element.dispatchEvent(pointer('pointermove', 100, 125, 1010));
  expect(element.style.transform).toBe('translateY(125px)');
  expect(onProgress).toHaveBeenLastCalledWith(0.25);
  element.dispatchEvent(pointer('pointerup', 100, 200, 1900));
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(onProgress).toHaveBeenLastCalledWith(null);
});

test('a cancelled drag never calls onDone', () => {
  const { element, onDone } = setup();
  element.dispatchEvent(pointer('pointerdown', 0, 100, 1000));
  element.dispatchEvent(pointer('pointermove', 200, 100, 1010));
  element.dispatchEvent(pointer('pointercancel', 250, 100, 1020));
  expect(onDone).not.toHaveBeenCalled();
  expect(element.style.transform).toBe('');
  expect(element.hasPointerCapture(1)).toBe(false);
});

test('does nothing while disabled', () => {
  const { element, onDone } = setup({ enabled: false });
  drag(element, [0, 100], [250, 100], 100);
  expect(onDone).not.toHaveBeenCalled();
  expect(element.style.transform).toBe('');
});

test('with `from` the drag must start inside a matching element', () => {
  const { element, header, body, onDone } = setup({
    axis: 'y',
    from: 'header',
  });
  drag(body, [100, 0], [100, 300], 100);
  expect(onDone).not.toHaveBeenCalled();
  drag(header, [100, 0], [100, 300], 100);
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(element.style.transform).toBe('');
});

test('a click after a drag is stopped, a later click is not', async () => {
  const { element, body } = setup();
  const onClick = vi.fn();
  body.addEventListener('click', onClick);
  drag(element, [0, 100], [150, 100], 400);

  body.click();
  expect(onClick).not.toHaveBeenCalled();

  await new Promise((resolve) => setTimeout(resolve, 0));
  body.click();
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('a tap without a drag is not stopped', () => {
  const { element, body } = setup();
  const onClick = vi.fn();
  body.addEventListener('click', onClick);
  element.dispatchEvent(pointer('pointerdown', 10, 10, 1000));
  element.dispatchEvent(pointer('pointerup', 10, 10, 1050));
  body.click();
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('hostDisconnected removes the listeners', async () => {
  const { element, body, controller, onDone } = setup();
  const onClick = vi.fn();
  body.addEventListener('click', onClick);
  controller.hostDisconnected();
  drag(element, [0, 100], [150, 100], 400);
  expect(onDone).not.toHaveBeenCalled();
  body.click();
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('a drag still works when setPointerCapture throws', () => {
  const { element, onDone } = setup();
  element.setPointerCapture = () => {
    throw new DOMException('gone', 'NotFoundError');
  };
  drag(element, [0, 100], [150, 100], 400);
  expect(onDone).toHaveBeenCalledTimes(1);
});
