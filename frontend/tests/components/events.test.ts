import { expect, test, vi } from 'vitest';
import { fire } from '../../src/components/events';

test('fire sends a typed event that bubbles and crosses shadow roots', () => {
  const host = document.createElement('div');
  const listener = vi.fn();
  host.addEventListener('tvg-open-programme', listener);

  fire(host, 'tvg-open-programme', { number: 5, programmeId: 'TVN|2026-10-19T17:00:00Z' });

  const event = listener.mock.calls[0]?.[0] as CustomEvent;
  expect(event.detail).toEqual({ number: 5, programmeId: 'TVN|2026-10-19T17:00:00Z' });
  expect(event.bubbles).toBe(true);
  expect(event.composed).toBe(true);
});

test('fire sends tvg-reminder with the programme and the new state', () => {
  const host = document.createElement('div');
  const listener = vi.fn();
  host.addEventListener('tvg-reminder', listener);

  fire(host, 'tvg-reminder', { programmeId: 'TVN|2026-10-19T17:35:00Z', on: true });

  expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ programmeId: 'TVN|2026-10-19T17:35:00Z', on: true });
});
