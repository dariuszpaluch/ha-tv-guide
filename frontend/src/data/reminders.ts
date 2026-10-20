import type { Programme } from '../types/api';

export const REMINDER_LEAD_MS = 5 * 60_000;

/** Whether a programme starts more than five minutes after `now`, in milliseconds. */
export const canRemind = (programme: Programme, now: number): boolean =>
  Date.parse(programme.start) - REMINDER_LEAD_MS > now;
