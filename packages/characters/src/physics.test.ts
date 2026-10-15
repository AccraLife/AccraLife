import { describe, it, expect } from 'vitest';
import { BodyPhysics, BODY } from './physics';
import { neutralPose } from './pose';

const run = (b: BodyPhysics, secs: number, cb?: (o: ReturnType<BodyPhysics['step']>) => void) => {
  let px = 0, pz = 0;
  for (let i = 0; i < secs * 60; i++) {
    const o = b.step(1 / 60, neutralPose());
    px += o.dx; pz += o.dz;
    for (const v of Object.values(o.pose)) expect(Number.isFinite(v)).toBe(true);
    cb?.(o);
  }
  return { px, pz };
};

describe('BodyPhysics', () => {
  it('stays ok with no hit', () => {
    const b = new BodyPhysics(0.9);
    const o = b.step(1 / 60, neutralPose());
    expect(o.locked).toBe(false);
  });
  it('light bump staggers then recovers, moving along the push', () => {
    const b = new BodyPhysics(0.9);
    b.hit({ dirX: 1, dirZ: 0, strength: 1.5, kind: 'bump' }, 0);
    expect(b.mode).toBe('stagger');
    const r = run(b, 3);
    expect(b.mode).toBe('ok');
    expect(r.px).toBeGreaterThan(0.1);
  });
  it('shove falls, lies, rises, recovers', () => {
    const b = new BodyPhysics(0.9);
    b.hit({ dirX: 0, dirZ: 1, strength: 5, kind: 'shove' }, 0);
    const modes = new Set<string>();
    let minY = 9, thuds = 0;
    run(b, 10, (o) => { modes.add(o.mode); minY = Math.min(minY, o.pose.hipY + 0.9); if (o.thud > 0) thuds++; });
    expect(modes.has('fall')).toBe(true);
    expect(modes.has('down')).toBe(true);
    expect(modes.has('rise')).toBe(true);
    expect(thuds).toBeGreaterThan(0);
    expect(minY).toBeGreaterThanOrEqual(BODY.lieHeight - 0.02);
    expect(b.mode).toBe('ok');
  });
  it('vehicle hit tumbles, never goes below ground, ends up ok', () => {
    for (const yaw of [0, 1.3, 3, -2]) {
      const b = new BodyPhysics(0.9);
      b.hit({ dirX: 0.5, dirZ: -1, strength: 9, kind: 'vehicle' }, yaw);
      expect(b.mode).toBe('tumble');
      let minY = 9;
      const r = run(b, 12, (o) => { minY = Math.min(minY, o.pose.hipY + 0.9); });
      expect(minY).toBeGreaterThanOrEqual(BODY.lieHeight - 0.02);
      expect(r.pz).toBeLessThan(-1);
      expect(b.mode).toBe('ok');
    }
  });
  it('second hit while down does not restart fall', () => {
    const b = new BodyPhysics(0.9);
    b.hit({ dirX: 1, dirZ: 0, strength: 6, kind: 'shove' }, 0);
    run(b, 1);
    const m = b.mode;
    b.hit({ dirX: 1, dirZ: 0, strength: 6, kind: 'shove' }, 0);
    expect(b.mode).toBe(m);
  });
  it('landing squash is transient', () => {
    const b = new BodyPhysics(0.9);
    b.land(9);
    const o = b.step(1 / 60, neutralPose());
    expect(o.pose.hipY).toBeLessThan(0);
    run(b, 2);
    expect(b.step(1 / 60, neutralPose()).pose.hipY).toBeCloseTo(0, 3);
  });
});
