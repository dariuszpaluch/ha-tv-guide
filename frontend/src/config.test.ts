import { describe, expect, test } from 'vitest';
import { channelIds, switchServiceCall, validateConfig } from './config';

const switchAction = {
  perform_action: 'script.cable_box_go_to_channel',
  data: { channel: '{number}', note: 'ch {number}' },
};

type Raw = Record<string, unknown>;

const tvp1: Raw = { number: 1, name: 'TVP 1 HD', epg_id: 'TVP 1', logo: '/local/tvp1.png', logo_tile: 'dark' };
const tvp2: Raw = { number: 2, name: 'TVP 2 HD', epg_id: 'TVP 2' };

const baseConfig = (): Raw => ({
  type: 'custom:tv-guide',
  switch_action: switchAction,
  sections: [{ title: 'Main', channels: [tvp1, tvp2] }],
});

/** Base config without one key. */
const without = (key: string): Raw => Object.fromEntries(Object.entries(baseConfig()).filter(([k]) => k !== key));

/** Config with one section that holds the given channels. */
const withChannels = (...channels: Raw[]): Raw => ({ ...baseConfig(), sections: [{ channels }] });

describe('validateConfig', () => {
  test('fills the defaults', () => {
    const config = validateConfig(baseConfig());
    expect(config.tv_day_starts_at).toBe(5);
    expect(config.height).toBe('600px');
    expect(config.entry_id).toBeUndefined();
  });

  test('keeps given values', () => {
    const config = validateConfig({ ...baseConfig(), entry_id: '01J', tv_day_starts_at: 6, height: '80vh' });
    expect(config).toMatchObject({ entry_id: '01J', tv_day_starts_at: 6, height: '80vh' });
    expect(config.sections[0]?.title).toBe('Main');
    expect(config.sections[0]?.channels[0]).toEqual({
      number: 1,
      name: 'TVP 1 HD',
      epg_id: 'TVP 1',
      logo: '/local/tvp1.png',
      logo_tile: 'dark',
    });
    expect(config.switch_action).toEqual(switchAction);
  });

  test('fills the card type when HA leaves it out', () => {
    expect(validateConfig(without('type')).type).toBe('custom:tv-guide');
  });

  test('rejects a config that is not an object', () => {
    expect(() => validateConfig(undefined)).toThrow('tv-guide: ');
    expect(() => validateConfig([])).toThrow('tv-guide: ');
  });

  test('rejects an unknown key', () => {
    expect(() => validateConfig({ ...baseConfig(), foo: 1 })).toThrow('tv-guide: unknown key "foo"');
  });

  test('rejects an unknown key in a section and in a channel', () => {
    expect(() => validateConfig({ ...baseConfig(), sections: [{ channels: [], colour: 'red' }] })).toThrow('"colour"');
    expect(() => validateConfig(withChannels({ ...tvp1, id: 'x' }))).toThrow('"id"');
  });

  test('requires sections', () => {
    expect(() => validateConfig(without('sections'))).toThrow('tv-guide: "sections" is required');
  });

  test('requires sections to be a list', () => {
    expect(() => validateConfig({ ...baseConfig(), sections: {} })).toThrow('"sections" must be a list');
  });

  test('requires switch_action', () => {
    expect(() => validateConfig(without('switch_action'))).toThrow('tv-guide: "switch_action" is required');
  });

  test('requires perform_action as domain.service', () => {
    const config = { ...baseConfig(), switch_action: { perform_action: 'cable_box' } };
    expect(() => validateConfig(config)).toThrow('"switch_action.perform_action" must be "domain.service"');
  });

  test('requires perform_action', () => {
    const config = { ...baseConfig(), switch_action: { data: {} } };
    expect(() => validateConfig(config)).toThrow('"switch_action.perform_action" is required');
  });

  test('rejects data that is not an object', () => {
    const config = { ...baseConfig(), switch_action: { perform_action: 'script.go', data: 'x' } };
    expect(() => validateConfig(config)).toThrow('"switch_action.data" must be an object');
  });

  test('names the channel that has no number', () => {
    expect(() => validateConfig(withChannels(tvp1, { name: 'Polsat' }))).toThrow('channel "Polsat": "number" is required');
  });

  test('accepts a text channel number, such as a US sub-channel', () => {
    const config = validateConfig(withChannels({ ...tvp1, number: ' 5.1 ' }, { ...tvp2, number: '702-1' }));
    expect(config.sections[0]?.channels.map((channel) => channel.number)).toEqual(['5.1', '702-1']);
  });

  test('rejects a number with a fraction and asks for quotes', () => {
    expect(() => validateConfig(withChannels({ ...tvp1, number: 5.1 }))).toThrow(
      'channel "TVP 1 HD": "number" must be a whole number, or text in quotes such as "5.1"',
    );
  });

  test('rejects an empty or negative channel number', () => {
    expect(() => validateConfig(withChannels({ ...tvp1, number: '  ' }))).toThrow('channel "TVP 1 HD": "number" must not be empty');
    expect(() => validateConfig(withChannels({ ...tvp1, number: -1 }))).toThrow(
      'channel "TVP 1 HD": "number" must be a whole number, or text in quotes such as "5.1"',
    );
  });

  test('requires a channel name', () => {
    expect(() => validateConfig(withChannels({ number: 7 }))).toThrow('channel 7: "name" is required');
  });

  test('rejects a wrong logo_tile', () => {
    expect(() => validateConfig(withChannels({ ...tvp1, logo_tile: 'red' }))).toThrow('channel "TVP 1 HD": "logo_tile" must be "dark" or "light"');
  });

  test('rejects a wrong tv_day_starts_at', () => {
    expect(() => validateConfig({ ...baseConfig(), tv_day_starts_at: 24 })).toThrow(
      '"tv_day_starts_at" must be a whole number from 0 to 23',
    );
    expect(() => validateConfig({ ...baseConfig(), tv_day_starts_at: '5' })).toThrow('"tv_day_starts_at"');
  });

  test('rejects a height that is not a string', () => {
    expect(() => validateConfig({ ...baseConfig(), height: 600 })).toThrow('"height" must be a string');
  });

  test('rejects a section without channels', () => {
    expect(() => validateConfig({ ...baseConfig(), sections: [{ title: 'Empty' }] })).toThrow(
      'section "Empty": "channels" is required',
    );
  });
});

describe('switchServiceCall', () => {
  test('replaces {number} in data', () => {
    const config = validateConfig(baseConfig());
    expect(switchServiceCall(config, 216)).toEqual({
      domain: 'script',
      service: 'cable_box_go_to_channel',
      data: { channel: 216, note: 'ch 216' },
    });
  });

  test('a text channel number stays text', () => {
    const config = validateConfig(baseConfig());
    expect(switchServiceCall(config, '5.1').data).toEqual({ channel: '5.1', note: 'ch 5.1' });
  });

  test('replaces in nested objects and lists, and keeps other values', () => {
    const config = validateConfig({
      ...baseConfig(),
      switch_action: {
        perform_action: 'remote.send_command',
        data: { nested: { channel: '{number}', keep: true, list: ['{number}', 'a{number}b'] }, count: 3 },
      },
    });
    expect(switchServiceCall(config, 7).data).toEqual({
      nested: { channel: 7, keep: true, list: [7, 'a7b'] },
      count: 3,
    });
  });

  test('works without data', () => {
    const config = validateConfig({ ...baseConfig(), switch_action: { perform_action: 'script.go' } });
    expect(switchServiceCall(config, 1)).toEqual({ domain: 'script', service: 'go', data: {} });
  });
});

describe('channelIds', () => {
  test('drops duplicates and channels without epg_id', () => {
    const config = validateConfig({
      ...baseConfig(),
      sections: [
        { channels: [{ number: 1, name: 'A', epg_id: 'A' }, { number: 2, name: 'B' }] },
        { channels: [{ number: 3, name: 'C', epg_id: 'C' }, { number: 4, name: 'A again', epg_id: 'A' }] },
      ],
    });
    expect(channelIds(config)).toEqual(['A', 'C']);
  });
});
