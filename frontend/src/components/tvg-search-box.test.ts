import { afterEach, expect, test, vi } from 'vitest';
import { tEn } from '../test/fixtures';
import { TvgSearchBox } from './tvg-search-box';

const mount = async (value = '') => {
  const el = new TvgSearchBox();
  el.value = value;
  el.t = tEn;
  document.body.append(el);
  await el.updateComplete;
  return el;
};

const input = (el: TvgSearchBox) => el.shadowRoot?.querySelector('input') as HTMLInputElement;

afterEach(() => document.body.replaceChildren());

test('search box fires tvg-search on input and tvg-submit on Enter', async () => {
  const el = await mount();
  const onSearch = vi.fn();
  const onSubmit = vi.fn();
  el.addEventListener('tvg-search', (e) => onSearch(e.detail));
  el.addEventListener('tvg-submit', onSubmit);

  input(el).value = 'tvn';
  input(el).dispatchEvent(new Event('input'));
  input(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

  expect(onSearch).toHaveBeenCalledWith({ query: 'tvn' });
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test('other keys do not submit', async () => {
  const el = await mount();
  const onSubmit = vi.fn();
  el.addEventListener('tvg-submit', onSubmit);
  input(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
  expect(onSubmit).not.toHaveBeenCalled();
});

test('shows the value and the translated placeholder', async () => {
  const el = await mount('fakty');
  expect(input(el).value).toBe('fakty');
  expect(input(el).placeholder).toBe('Search channel or programme');
});

test('clear button shows only with a query and empties it', async () => {
  const empty = await mount();
  expect(empty.shadowRoot?.querySelector('.clear')).toBeNull();

  const el = await mount('fakty');
  const onSearch = vi.fn();
  el.addEventListener('tvg-search', (e) => onSearch(e.detail));
  el.shadowRoot?.querySelector<HTMLButtonElement>('.clear')?.click();
  expect(onSearch).toHaveBeenCalledWith({ query: '' });
});
