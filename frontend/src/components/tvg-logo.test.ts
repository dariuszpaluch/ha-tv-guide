import { afterEach, expect, test, vi } from 'vitest';
import { measureLogo } from '../utils/logo-tone';
import { TvgLogo } from './tvg-logo';

vi.mock('../utils/logo-tone', () => ({ measureLogo: vi.fn() }));

const measure = vi.mocked(measureLogo);

/** Creates a logo, adds it to the page and, for an image, fires its load event. */
const mount = async (props: Partial<Pick<TvgLogo, 'src' | 'tile' | 'darkMode'>>, load = true) => {
  const el = new TvgLogo();
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  if (load) {
    el.shadowRoot?.querySelector('img')?.dispatchEvent(new Event('load'));
    await el.updateComplete;
  }
  return el;
};

const box = (el: TvgLogo) => el.shadowRoot?.querySelector('.logo');

afterEach(() => {
  document.body.replaceChildren();
  measure.mockReset();
});

test('logo gets tile-dark for a light logo in light mode', async () => {
  measure.mockReturnValue('light');
  const el = await mount({ src: '/light.png', darkMode: false });
  expect(box(el)?.classList.contains('tile-dark')).toBe(true);
});

test('logo gets tile-light for a dark logo in dark mode', async () => {
  measure.mockReturnValue('dark');
  const el = await mount({ src: '/dark.png', darkMode: true });
  expect(box(el)?.classList.contains('tile-light')).toBe(true);
});

test('logo has no tile when it already contrasts with the theme', async () => {
  measure.mockReturnValue('light');
  const el = await mount({ src: '/light-on-dark.png', darkMode: true });
  expect(box(el)?.classList.contains('tile-dark')).toBe(false);
  expect(box(el)?.classList.contains('tile-light')).toBe(false);
});

test('the tile from the config wins and the logo is not measured', async () => {
  measure.mockReturnValue('light');
  const el = await mount({ src: '/forced.png', tile: 'light', darkMode: false });
  expect(box(el)?.classList.contains('tile-light')).toBe(true);
  expect(box(el)?.classList.contains('tile-dark')).toBe(false);
  expect(measure).not.toHaveBeenCalled();
});

test('a failed measurement leaves the logo without a tile', async () => {
  measure.mockImplementation(() => {
    throw new DOMException('tainted canvas', 'SecurityError');
  });
  const el = await mount({ src: '/other-origin.png', darkMode: false });
  expect(box(el)?.classList.contains('tile-dark')).toBe(false);
  expect(el.shadowRoot?.querySelector('img')).not.toBeNull();
});

test('without a source it shows the TV icon', async () => {
  const el = await mount({}, false);
  expect(el.shadowRoot?.querySelector('img')).toBeNull();
  expect(el.shadowRoot?.querySelector('svg')).not.toBeNull();
});

test('a broken image falls back to the TV icon', async () => {
  const el = await mount({ src: '/missing.png' }, false);
  el.shadowRoot?.querySelector('img')?.dispatchEvent(new Event('error'));
  await el.updateComplete;
  expect(el.shadowRoot?.querySelector('img')).toBeNull();
  expect(el.shadowRoot?.querySelector('svg')).not.toBeNull();
});
