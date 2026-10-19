import { expect, test } from 'vitest';
import './tvg-progress';
import { TvgProgress } from './tvg-progress';

test('bar width follows the value', async () => {
  const el = new TvgProgress();
  el.value = 42.5;
  document.body.append(el);
  await el.updateComplete;

  const fill = el.shadowRoot?.querySelector<HTMLElement>('.bar > i');
  expect(fill?.style.width).toBe('42.5%');
  el.remove();
});
