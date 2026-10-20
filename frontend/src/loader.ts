/**
 * Entry of the built card. Settles when the card is defined, or when it cannot load.
 *
 * Home Assistant loads this file at the same time as its own app. The app replaces
 * `window.customElements` with a polyfill before it defines `home-assistant`, and the
 * polyfill does not know elements defined before that. So the card waits for that
 * element and only then defines its own. When HA is already running, it does not wait.
 */
export const cardLoaded: Promise<void> = customElements
  .whenDefined('home-assistant')
  .then(async () => {
    await import('./tv-guide');
  })
  .catch((error: unknown) => console.error('TV guide card: cannot load', error));
