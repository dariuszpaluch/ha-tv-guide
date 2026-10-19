import { expect, test } from 'vitest';
import { logoTone } from './logo-tone';

const SIZE = 48;
const TOTAL = SIZE * SIZE;

type Share = { white?: number; black?: number; transparent?: number };

/** Builds a 48x48 RGBA buffer. Each value is a percentage of all pixels; the rest is mid grey. */
const pixels = ({ white = 0, black = 0, transparent = 0 }: Share): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(TOTAL * 4);
  const count = (percent: number) => Math.round((TOTAL * percent) / 100);
  const [whiteEnd, blackEnd, clearEnd] = [
    count(white),
    count(white) + count(black),
    count(white) + count(black) + count(transparent),
  ];
  for (let i = 0; i < TOTAL; i += 1) {
    const [r, g, b, a] =
      i < whiteEnd ? [255, 255, 255, 255]
      : i < blackEnd ? [0, 0, 0, 255]
      : i < clearEnd ? [0, 0, 0, 0]
      : [128, 128, 128, 255];
    data.set([r, g, b, a], i * 4);
  }
  return data;
};

test('logoTone light / dark / mixed', () => {
  expect(logoTone(pixels({ white: 70, transparent: 30 }))).toBe('light');
  expect(logoTone(pixels({ black: 50, transparent: 50 }))).toBe('dark');
  expect(logoTone(pixels({ white: 100 }))).toBe('mixed');
});

test('logoTone ignores a fully transparent image', () => {
  expect(logoTone(pixels({ transparent: 100 }))).toBe('mixed');
});

test('logoTone is mixed when neither share is high enough', () => {
  expect(logoTone(pixels({ white: 40, black: 30, transparent: 10 }))).toBe('mixed');
});
