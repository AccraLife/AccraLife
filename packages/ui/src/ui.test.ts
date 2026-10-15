import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@accra/core';
import { SETTINGS_KEY, loadSettings, sanitizeSettings, saveSettings } from './settings';

describe('settings', () => {
  it('drops junk and clamps values', () => {
    expect(sanitizeSettings(null)).toEqual({});
    expect(sanitizeSettings('x')).toEqual({});
    const s = sanitizeSettings({ quality: 'ultra', viewRadius: 99, masterVolume: -4, crowdDensity: 'lots', showDebug: true, evil: 1 });
    expect(s).toEqual({ viewRadius: 3, masterVolume: 0, showDebug: true });
  });

  it('round trips through storage', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const cfg = { ...defaultConfig(), quality: 'low' as const, masterVolume: 0.2, userTuned: true };
    saveSettings(cfg, storage);
    expect(mem.has(SETTINGS_KEY)).toBe(true);
    const back = loadSettings(storage);
    expect(back.quality).toBe('low');
    expect(back.masterVolume).toBe(0.2);
    expect(back.userTuned).toBe(true);
  });

  it('survives broken storage', () => {
    expect(loadSettings({ getItem: () => '{not json' })).toEqual({});
    expect(loadSettings({ getItem: () => { throw new Error('blocked'); } })).toEqual({});
  });
});
