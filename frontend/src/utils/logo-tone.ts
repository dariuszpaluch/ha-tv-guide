export type LogoTone = 'light' | 'dark' | 'mixed';

const SIZE = 48;
const MIN_OPAQUE_ALPHA = 128;
const LIGHT_MIN_CHANNEL = 200;
const DARK_MAX_CHANNEL = 70;
const LIGHT_SHARE = 0.6;
const DARK_SHARE = 0.45;

/**
 * Says if a logo is mostly light, mostly dark or mixed, so the card can put it on a contrasting tile.
 * Transparent pixels are ignored. An image with no transparency (or only transparency) is `mixed`:
 * it is a picture with its own background.
 * @param pixels RGBA data of a 48x48 image.
 */
export const logoTone = (pixels: Uint8ClampedArray): LogoTone => {
  let opaque = 0;
  let light = 0;
  let dark = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if ((pixels[i + 3] ?? 0) < MIN_OPAQUE_ALPHA) continue;
    const channels = [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
    opaque += 1;
    if (Math.min(...channels) > LIGHT_MIN_CHANNEL) light += 1;
    if (Math.max(...channels) < DARK_MAX_CHANNEL) dark += 1;
  }
  if (opaque === 0 || opaque === SIZE * SIZE) return 'mixed';
  if (light / opaque > LIGHT_SHARE) return 'light';
  if (dark / opaque > DARK_SHARE) return 'dark';
  return 'mixed';
};

/**
 * Draws a loaded logo on a 48x48 canvas and measures it. Needs a real canvas, so it is not unit tested.
 * @param img An image that has finished loading.
 */
export const measureLogo = (img: HTMLImageElement): LogoTone => {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 'mixed';
  context.drawImage(img, 0, 0, SIZE, SIZE);
  return logoTone(context.getImageData(0, 0, SIZE, SIZE).data);
};
