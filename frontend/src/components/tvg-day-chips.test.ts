import { afterEach, expect, test, vi } from 'vitest';
import './tvg-day-chips';
import type { TvgDayChips } from './tvg-day-chips';

const mount = async (props: Partial<TvgDayChips> = {}) => {
  const el = document.createElement('tvg-day-chips') as TvgDayChips;
  Object.assign(el, {
    days: ['2026-10-19', '2026-10-20', '2026-10-21'],
    selected: '2026-10-20',
    labels: { '2026-10-19': 'Today', '2026-10-20': 'Tomorrow', '2026-10-21': 'Wed 21' },
    groupLabel: 'Day',
    ...props,
  });
  document.body.append(el);
  await el.updateComplete;
  return el;
};

const chips = (el: TvgDayChips) => [...(el.shadowRoot?.querySelectorAll<HTMLButtonElement>('button') ?? [])];

afterEach(() => document.body.replaceChildren());

test('shows one chip per day with its label', async () => {
  const el = await mount();
  expect(chips(el).map((c) => c.textContent?.trim())).toEqual(['Today', 'Tomorrow', 'Wed 21']);
});

test('marks only the selected day as pressed', async () => {
  const el = await mount();
  expect(chips(el).map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
});

test('a click fires tvg-day with the key', async () => {
  const el = await mount();
  const onDay = vi.fn();
  el.addEventListener('tvg-day', (e) => onDay(e.detail));
  chips(el)[2]?.click();
  expect(onDay).toHaveBeenCalledWith({ key: '2026-10-21' });
});

test('names the group for screen readers', async () => {
  const el = await mount();
  expect(el.shadowRoot?.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Day');
});

test('falls back to the key when a label is missing', async () => {
  const el = await mount({ labels: {} });
  expect(chips(el)[0]?.textContent?.trim()).toBe('2026-10-19');
});
