import { describe, expect, test, vi } from 'vitest';
import {
  dayLabel,
  formatDuration,
  formatTime,
  hour12,
  progress,
  timeZoneOf,
  tvDayKey,
  tvDayRange,
  tvDays,
  whenText,
} from '../../src/data/time';
import {
  NOW,
  WAW,
  fakty,
  faktyDay3,
  faktyTomorrow,
  nocneKino,
  poKinie,
  sport,
  tEn,
  tPl,
  uwagaTomorrow,
} from '../fixtures';
import type { HomeAssistant } from '../../src/types/hass';

const HOUR = 3600e3;

describe('tvDayKey', () => {
  test('programme after midnight belongs to the evening before', () => {
    expect(tvDayKey(Date.parse('2026-10-20T01:30:00+02:00'), WAW, 5)).toBe('2026-10-19');
  });
  test('the day changes exactly at the start hour', () => {
    expect(tvDayKey(Date.parse('2026-10-20T04:59:00+02:00'), WAW, 5)).toBe('2026-10-19');
    expect(tvDayKey(Date.parse('2026-10-20T05:00:00+02:00'), WAW, 5)).toBe('2026-10-20');
  });
  test('the day changes at the start hour on the DST night', () => {
    expect(tvDayKey(Date.parse('2026-10-25T04:59:00+01:00'), WAW, 5)).toBe('2026-10-24');
    expect(tvDayKey(Date.parse('2026-10-25T05:00:00+01:00'), WAW, 5)).toBe('2026-10-25');
    expect(tvDayKey(Date.parse(nocneKino.start), WAW, 5)).toBe('2026-10-24');
    expect(tvDayKey(Date.parse(poKinie.start), WAW, 5)).toBe('2026-10-24');
  });
  test('start hour 2 on the DST night: the repeated hour belongs to the day before, in both halves', () => {
    // Clocks go back at 03:00 CEST. 02:00-03:00 happens twice, and the TV day starts at the second 02:00.
    expect(tvDayKey(Date.parse('2026-10-25T00:30:00Z'), WAW, 2)).toBe('2026-10-24');
    expect(tvDayKey(Date.parse('2026-10-25T00:59:59.999Z'), WAW, 2)).toBe('2026-10-24');
    expect(tvDayKey(Date.parse('2026-10-25T01:00:00Z'), WAW, 2)).toBe('2026-10-25');
  });
  test('start hour 0 gives the calendar day', () => {
    expect(tvDayKey(Date.parse('2026-10-20T00:10:00+02:00'), WAW, 0)).toBe('2026-10-20');
  });
});

describe('tvDayRange', () => {
  test('a normal day spans 24 hours from the start hour', () => {
    const { start, end } = tvDayRange('2026-10-19', WAW, 5);
    expect(start).toBe(Date.parse('2026-10-19T05:00:00+02:00'));
    expect(end).toBe(Date.parse('2026-10-20T05:00:00+02:00'));
  });
  test('tvDayRange spans 25 hours on 2026-10-24', () => {
    const { start, end } = tvDayRange('2026-10-24', WAW, 5);
    expect(end - start).toBe(25 * HOUR);
  });
  test('tvDayRange spans 23 hours when the clocks go forward', () => {
    const { start, end } = tvDayRange('2026-03-28', WAW, 5);
    expect(end - start).toBe(23 * HOUR);
  });
  test('range and key agree', () => {
    const { start, end } = tvDayRange('2026-10-24', WAW, 5);
    expect(tvDayKey(start, WAW, 5)).toBe('2026-10-24');
    expect(tvDayKey(end - 1, WAW, 5)).toBe('2026-10-24');
    expect(tvDayKey(end, WAW, 5)).toBe('2026-10-25');
  });
});

describe('tvDayKey and tvDayRange for every start hour', () => {
  test.each([0, 1, 2, 3, 4, 5, 12, 23])('key matches range at start hour %i on the DST days', (startHour) => {
    for (const day of ['2026-03-28', '2026-03-29', '2026-10-24', '2026-10-25']) {
      const { start, end } = tvDayRange(day, WAW, startHour);
      for (let ms = start; ms < end; ms += 15 * 60e3) expect(tvDayKey(ms, WAW, startHour)).toBe(day);
    }
  });
});

describe('tvDays', () => {
  test('unique sorted keys from today on', () => {
    const programmes = [faktyDay3, uwagaTomorrow, fakty, faktyTomorrow, sport];
    expect(tvDays(programmes, '2026-10-20', WAW, 5)).toEqual(['2026-10-20', '2026-10-21']);
    expect(tvDays(programmes, '2026-10-19', WAW, 5)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
  });
  test('no programmes give no days', () => {
    expect(tvDays([], '2026-10-19', WAW, 5)).toEqual([]);
  });
});

describe('hour12 and timeZoneOf', () => {
  test('hour12 follows the HA time format', () => {
    expect(hour12('language')).toBe(false);
    expect(hour12('24')).toBe(false);
    expect(hour12('12')).toBe(true);
  });
  test('system reads the device setting', () => {
    const device = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 ?? false;
    expect(hour12('system')).toBe(device);
  });
  test('time zone follows the HA profile', () => {
    const hass = (time_zone: 'local' | 'server') =>
      ({ locale: { time_zone }, config: { time_zone: WAW } }) as HomeAssistant;
    expect(timeZoneOf(hass('server'))).toBe(WAW);
    expect(timeZoneOf(hass('local'))).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe('formatTime', () => {
  test('formatTime 24-hour and 12-hour', () => {
    const time = Date.parse('2026-10-20T19:55:00+02:00');
    expect(formatTime(time, 'en-GB', WAW, false)).toBe('19:55');
    expect(formatTime(time, 'en-GB', WAW, true).replace(/\s/g, ' ')).toMatch(/^7:55 pm$/i);
  });
  test('24-hour time has two digits for the hour', () => {
    expect(formatTime(Date.parse('2026-10-20T07:05:00+02:00'), 'pl-PL', WAW, false)).toBe('07:05');
  });
  test('uses the given time zone', () => {
    expect(formatTime(Date.parse('2026-10-20T19:55:00+02:00'), 'en-GB', 'UTC', false)).toBe('17:55');
  });
});

describe('dayLabel', () => {
  test('dayLabel in Polish', () => {
    expect(dayLabel('2026-10-19', '2026-10-19', 'pl-PL', tPl)).toBe('Dziś');
    expect(dayLabel('2026-10-21', '2026-10-19', 'pl-PL', tPl)).toBe('śr. 21');
  });
  test('dayLabel in English', () => {
    expect(dayLabel('2026-10-20', '2026-10-19', 'en-GB', tEn)).toBe('Tomorrow');
    expect(dayLabel('2026-10-21', '2026-10-19', 'en-GB', tEn)).toBe('Wed 21');
  });
  test('tomorrow is found across the DST night', () => {
    expect(dayLabel('2026-10-25', '2026-10-24', 'en-GB', tEn)).toBe('Tomorrow');
    expect(dayLabel('2026-11-01', '2026-10-31', 'en-GB', tEn)).toBe('Tomorrow');
  });
});

describe('whenText and formatDuration', () => {
  test('whenText and formatDuration', () => {
    expect(whenText(fakty, NOW, '2026-10-19', 'en-GB', WAW, false, 5, tEn)).toBe('15 min left');
    expect(whenText(sport, NOW, '2026-10-19', 'pl-PL', WAW, false, 5, tPl)).toBe('Za 15 min');
    expect(whenText(uwagaTomorrow, NOW, '2026-10-19', 'pl-PL', WAW, false, 5, tPl)).toBe('Jutro, 19:55');
    expect(formatDuration(197, tPl)).toBe('3 godz. 17 min');
  });
  test('a programme that starts in under a minute says in 1 min, not 0', () => {
    const almost = Date.parse(sport.start) - 20e3;
    expect(whenText(sport, almost, '2026-10-19', 'en-GB', WAW, false, 5, tEn)).toBe('In 1 min');
  });
  test('a finished programme is ended', () => {
    const later = Date.parse('2026-10-19T19:40:00+02:00');
    expect(whenText(fakty, later, '2026-10-19', 'en-GB', WAW, false, 5, tEn)).toBe('Ended');
  });
  test('a programme on a later day shows the day and the time', () => {
    expect(whenText(faktyDay3, NOW, '2026-10-19', 'en-GB', WAW, false, 5, tEn)).toBe('Wed 21, 19:00');
  });
  test('uses the 12-hour clock when asked', () => {
    expect(whenText(uwagaTomorrow, NOW, '2026-10-19', 'en-GB', WAW, true, 5, tEn).replace(/\s/g, ' ')).toMatch(
      /^Tomorrow, 7:55 pm$/i,
    );
  });
  test('formatDuration under and over one hour', () => {
    expect(formatDuration(45, tEn)).toBe('45 min');
    expect(formatDuration(60, tEn)).toBe('1 h 0 min');
  });
});

describe('progress', () => {
  test('progress', () => {
    expect(progress(fakty, NOW)).toBeCloseTo(57.1, 1);
  });
  test('stays between 0 and 100', () => {
    expect(progress(sport, NOW)).toBe(0);
    expect(progress(fakty, Date.parse('2026-10-19T20:00:00+02:00'))).toBe(100);
  });
});

test('tvDayKey reuses one formatter per time zone', () => {
  tvDayKey(NOW, WAW, 5);
  const spy = vi.spyOn(Intl, 'DateTimeFormat');
  for (let i = 0; i < 100; i++) tvDayKey(NOW + i * 3600e3, WAW, 5);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});
