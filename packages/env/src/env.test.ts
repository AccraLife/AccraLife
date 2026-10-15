import { describe, expect, it } from 'vitest';
import { Rng } from '@accra/core';
import { holidayOn, monthOf, nightFactor, sunHeight, timeFromMinutes } from './clock';
import { LOOKS, pickWeather, seasonFor } from './weather';

describe('clock', () => {
  it('starts on Tuesday 13 October 2026 at 07:00', () => {
    const t = timeFromMinutes(7 * 60);
    expect(t.date).toBe('2026-10-13');
    expect(t.weekday).toBe(2);
    expect(t.hour).toBe(7);
    expect(t.minute).toBe(0);
    expect(t.day).toBe(0);
  });

  it('rolls over midnight and the weekday', () => {
    const t = timeFromMinutes(24 * 60 + 5);
    expect(t.day).toBe(1);
    expect(t.date).toBe('2026-10-14');
    expect(t.weekday).toBe(3);
    expect(t.hour).toBe(0);
    expect(t.minute).toBe(5);
  });

  it('rolls over months and years', () => {
    const t = timeFromMinutes((18 + 80) * 1440);
    // 13 Oct + 18 days = 31 Oct, + 30 = 30 Nov, + 31 = 31 Dec, + 19 = 19 Jan.
    expect(t.date).toBe('2027-01-19');
    expect(monthOf(t)).toBe(1);
  });

  it('knows holidays', () => {
    expect(holidayOn('2026-12-25')).toBe('Christmas Day');
    expect(holidayOn('2027-03-06')).toBe('Independence Day');
    expect(holidayOn('2026-10-13')).toBeNull();
  });
});

describe('sun', () => {
  it('rises at 06:00, peaks at noon, sets at 18:00', () => {
    expect(Math.abs(sunHeight(6))).toBeLessThan(1e-9);
    expect(sunHeight(12)).toBeCloseTo(1, 5);
    expect(Math.abs(sunHeight(18))).toBeLessThan(1e-9);
    expect(sunHeight(0)).toBeLessThan(0);
  });

  it('is dark at night and bright at noon', () => {
    expect(nightFactor(12)).toBe(0);
    expect(nightFactor(2)).toBe(1);
    expect(nightFactor(6.2)).toBeGreaterThan(0);
    expect(nightFactor(6.2)).toBeLessThan(1);
  });
});

describe('weather', () => {
  it('maps months to seasons', () => {
    expect(seasonFor(1)).toBe('harmattan');
    expect(seasonFor(5)).toBe('rainy');
    expect(seasonFor(10)).toBe('minor');
    expect(seasonFor(3)).toBe('dry');
  });

  it('rains more in the rainy season than in the dry one', () => {
    const rainShare = (season: 'rainy' | 'harmattan'): number => {
      const rng = new Rng(9);
      let wet = 0;
      for (let i = 0; i < 2000; i++) {
        if (LOOKS[pickWeather(season, rng)].rain > 0) wet++;
      }
      return wet / 2000;
    };
    expect(rainShare('rainy')).toBeGreaterThan(0.35);
    expect(rainShare('harmattan')).toBe(0);
  });

  it('is deterministic for a seed', () => {
    const a = new Rng(4);
    const b = new Rng(4);
    for (let i = 0; i < 30; i++) expect(pickWeather('minor', a)).toBe(pickWeather('minor', b));
  });
});
