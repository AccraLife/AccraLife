import { describe, expect, it } from 'vitest';
import { MISSIONS, MissionTracker, formatCedis } from './missions';

describe('missions', () => {
  it('starts on the first step of the first mission', () => {
    const t = new MissionTracker();
    const c = t.current();
    expect(c?.def.id).toBe('settling-in');
    expect(c?.step.tag).toBe('drank');
    expect(c?.progress).toBe('0/3');
  });

  it('advances through steps and ignores unknown or repeated tags', () => {
    const t = new MissionTracker();
    expect(t.report('nonsense')).toEqual([]);
    t.report('drank');
    expect(t.current()?.step.tag).toBe('ate');
    expect(t.current()?.progress).toBe('1/3');
    t.report('drank');
    expect(t.current()?.progress).toBe('1/3');
  });

  it('completes a mission once all its steps are done, in any order', () => {
    const t = new MissionTracker();
    t.report('worked');
    t.report('ate');
    const finished = t.report('drank');
    expect(finished.map((m) => m.id)).toEqual(['settling-in']);
    expect(t.completedCount()).toBe(1);
    expect(t.current()?.def.id).toBe('know-the-city');
  });

  it('counts steps reported before their mission was active', () => {
    const t = new MissionTracker();
    t.report('landmark:arch');
    t.report('landmark:market');
    t.report('landmark:lighthouse');
    expect(t.current()?.def.id).toBe('settling-in');
    t.report('drank');
    t.report('ate');
    const finished = t.report('worked');
    // Finishing the first mission also finishes the second, which was already done.
    expect(finished.map((m) => m.id)).toEqual(['settling-in', 'know-the-city']);
    expect(t.current()?.def.id).toBe('getting-around');
  });

  it('finishes everything and then has nothing current', () => {
    const t = new MissionTracker();
    for (const m of MISSIONS) for (const s of m.steps) t.report(s.tag);
    expect(t.current()).toBeNull();
    expect(t.completedCount()).toBe(MISSIONS.length);
  });

  it('saves and restores', () => {
    const a = new MissionTracker();
    a.report('drank');
    a.report('ate');
    const b = new MissionTracker();
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.current()?.step.tag).toBe('worked');
    expect(b.completedCount()).toBe(0);
  });

  it('every mission step has text and a unique tag', () => {
    const tags = MISSIONS.flatMap((m) => m.steps.map((s) => s.tag));
    expect(new Set(tags).size).toBe(tags.length);
    for (const m of MISSIONS) for (const s of m.steps) expect(s.text.length).toBeGreaterThan(5);
  });
});

describe('formatCedis', () => {
  it('groups thousands and shows pesewas', () => {
    expect(formatCedis(0)).toBe('GHS 0.00');
    expect(formatCedis(60)).toBe('GHS 60.00');
    expect(formatCedis(1234567.5)).toBe('GHS 1,234,567.50');
    expect(formatCedis(-100)).toBe('-GHS 100.00');
  });
});
