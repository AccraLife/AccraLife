import { describe, expect, it } from 'vitest';
import { faintReason, isPowerOn, moveFactor, outageForDay, startState, stepMinute } from './needs';

const SEED = 20261013;

describe('needs', () => {
  it('decay at the documented rates over an hour', () => {
    const s = startState();
    for (let i = 0; i < 60; i++) stepMinute(s, false);
    expect(s.hunger).toBeCloseTo(80 - 3.9, 1);
    expect(s.thirst).toBeCloseTo(80 - 6, 1);
    expect(s.energy).toBeCloseTo(90 - 3, 1);
    expect(s.hygiene).toBeCloseTo(85 - 1.5, 1);
  });

  it('stay between 0 and 100', () => {
    const s = startState();
    for (let i = 0; i < 20000; i++) stepMinute(s, true);
    for (const v of Object.values(s)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('a hungry, thirsty player eventually collapses', () => {
    const s = startState();
    let reason: string | null = null;
    for (let i = 0; i < 6000 && !reason; i++) {
      stepMinute(s, false);
      reason = faintReason(s);
    }
    expect(reason).not.toBeNull();
  });

  it('a looked-after player does not collapse in a day', () => {
    const s = startState();
    for (let i = 0; i < 1440; i++) {
      stepMinute(s, false);
      if (i % 240 === 0) {
        s.hunger = Math.min(100, s.hunger + 45);
        s.thirst = Math.min(100, s.thirst + 40);
      }
      if (i === 900) s.energy = 100;
      expect(faintReason(s)).toBeNull();
    }
  });

  it('rain lowers mood', () => {
    const dry = startState();
    const wet = startState();
    for (let i = 0; i < 300; i++) {
      stepMinute(dry, false);
      stepMinute(wet, true);
    }
    expect(wet.mood).toBeLessThan(dry.mood);
  });

  it('exhaustion slows the player', () => {
    const s = startState();
    expect(moveFactor(s)).toBe(1);
    s.energy = 10;
    expect(moveFactor(s)).toBe(0.75);
  });
});

describe('power cuts', () => {
  it('never happen on the first day', () => {
    for (let m = 0; m < 1440; m += 10) expect(isPowerOn(m, SEED)).toBe(true);
  });

  it('are deterministic and last one to four hours', () => {
    let cuts = 0;
    for (let day = 1; day < 200; day++) {
      const a = outageForDay(day, SEED);
      expect(a).toEqual(outageForDay(day, SEED));
      if (a) {
        cuts++;
        const hours = (a.end - a.start) / 60;
        expect(hours).toBeGreaterThanOrEqual(1);
        expect(hours).toBeLessThanOrEqual(4);
      }
    }
    // About four days in ten.
    expect(cuts).toBeGreaterThan(50);
    expect(cuts).toBeLessThan(110);
  });

  it('go off inside the window and come back after it', () => {
    let day = 1;
    while (!outageForDay(day, SEED)) day++;
    const o = outageForDay(day, SEED);
    if (!o) throw new Error('no outage found');
    const base = day * 1440;
    expect(isPowerOn(base + o.start - 1, SEED)).toBe(true);
    expect(isPowerOn(base + o.start, SEED)).toBe(false);
    if (o.end <= 1440) expect(isPowerOn(base + o.end, SEED)).toBe(true);
    expect(isPowerOn(base + o.end - 1, SEED)).toBe(false);
  });
});
