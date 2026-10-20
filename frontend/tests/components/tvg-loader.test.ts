import { afterEach, expect, test } from 'vitest';
import '../../src/components/tvg-loader';
import type { TvgLoader } from '../../src/components/tvg-loader';

afterEach(() => document.body.replaceChildren());

test('shows the label as a status, and hides the TV drawing from screen readers', async () => {
  const el = document.createElement('tvg-loader') as TvgLoader;
  el.label = 'Loading…';
  document.body.append(el);
  await el.updateComplete;
  const box = el.shadowRoot?.querySelector('[role="status"]');
  expect(box?.textContent?.trim()).toBe('Loading…');
  expect(el.shadowRoot?.querySelector('.tv')?.getAttribute('aria-hidden')).toBe('true');
  expect(el.shadowRoot?.querySelectorAll('.wave')).toHaveLength(3);
});
