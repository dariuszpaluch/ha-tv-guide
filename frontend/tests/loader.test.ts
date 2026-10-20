import { expect, test } from 'vitest';

test('the card is defined only after Home Assistant defines its main element', async () => {
  // HA replaces `window.customElements` with a polyfill before it defines `home-assistant`.
  // A card defined earlier is lost, so the loader must wait for that element.
  const { cardLoaded } = await import('../src/loader');
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(customElements.get('tv-guide')).toBeUndefined();

  customElements.define('home-assistant', class extends HTMLElement {});

  await cardLoaded;
  expect(customElements.get('tv-guide')).toBeDefined();
});
