import { describe, expect, it } from 'vitest';
import { Rng, defaultAppearance } from '@accra/core';
import { type PersonSpec, computeDims, randomSpec, specFromAppearance } from './spec';
import { POSE_KEYS, blendPose, idlePose, neutralPose, walkPose, wrapAngle } from './pose';

describe('spec', () => {
  it('is deterministic for a seed', () => {
    expect(randomSpec(new Rng(5))).toEqual(randomSpec(new Rng(5)));
  });

  it('makes varied, plausible adults', () => {
    const rng = new Rng(11);
    const outfits = new Set<string>();
    const hairs = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const s = randomSpec(rng);
      expect(s.height).toBeGreaterThanOrEqual(1.5);
      expect(s.height).toBeLessThanOrEqual(1.9);
      outfits.add(s.outfit);
      hairs.add(s.hair);
      if (s.outfit === 'dress') expect(s.female).toBe(true);
    }
    expect(outfits.size).toBe(5);
    expect(hairs.size).toBeGreaterThanOrEqual(6);
  });

  it('traders carry a head load and workers wear workwear', () => {
    expect(randomSpec(new Rng(1), 'trader').accessory).toBe('headLoad');
    expect(randomSpec(new Rng(1), 'worker').outfit).toBe('workwear');
  });

  it('builds from an appearance, including old saves without new fields', () => {
    const old = { name: 'Ama', skin: 2, shirt: 1, hair: 'wrap' } as never;
    const s = specFromAppearance(old);
    expect(s.hair).toBe('wrap');
    expect(s.build).toBe('average');
    expect(specFromAppearance({ ...defaultAppearance(), outfit: 'dress' }).female).toBe(true);
    expect(specFromAppearance({ skin: 99, shirt: -1, hair: 'zzz' } as never).skin).toBeGreaterThan(0);
  });

  it('has human proportions', () => {
    const d = computeDims(specFromAppearance(defaultAppearance()));
    expect(d.hipY + d.torso + d.neck + d.headR * 2).toBeCloseTo(d.height, 1);
    expect(d.thigh + d.shin + d.foot).toBeCloseTo(d.hipY, 1);
  });
});

describe('pose', () => {
  it('standing still is the neutral stance', () => {
    const p = walkPose({ phase: 1.2, speed: 0 });
    for (const k of POSE_KEYS) expect(Math.abs(p[k])).toBeLessThan(1e-9);
  });

  it('legs and arms swing in opposition', () => {
    const p = walkPose({ phase: Math.PI / 2, speed: 1.5 });
    expect(p.lHip * p.rHip).toBeLessThan(0);
    expect(p.lSh * p.rSh).toBeLessThan(0);
    // Same-side leg and arm swing the opposite way, like a real gait.
    expect(p.lHip * p.lSh).toBeLessThan(0);
  });

  it('running swings further and leans more than walking', () => {
    const walk = walkPose({ phase: Math.PI / 2, speed: 1.5 });
    const run = walkPose({ phase: Math.PI / 2, speed: 5 });
    expect(Math.abs(run.rHip)).toBeGreaterThan(Math.abs(walk.rHip));
    expect(run.lean).toBeGreaterThan(walk.lean);
  });

  it('knees only bend, never hyperextend', () => {
    for (let i = 0; i < 64; i++) {
      const p = walkPose({ phase: (i / 64) * Math.PI * 2, speed: 5 });
      expect(p.lKnee).toBeGreaterThanOrEqual(0);
      expect(p.rKnee).toBeGreaterThanOrEqual(0);
    }
  });

  it('blends toward a target without overshooting', () => {
    const cur = neutralPose();
    const target = { ...neutralPose(), lHip: 1 };
    blendPose(cur, target, 0.05, 10);
    expect(cur.lHip).toBeGreaterThan(0);
    expect(cur.lHip).toBeLessThan(1);
    for (let i = 0; i < 200; i++) blendPose(cur, target, 0.05, 10);
    expect(cur.lHip).toBeCloseTo(1, 3);
  });

  it('idle stays small and varies with the seed', () => {
    const a = idlePose(3, 0);
    const b = idlePose(3, 2);
    expect(Math.abs(a.headYaw)).toBeLessThan(0.2);
    expect(a.roll).not.toBe(b.roll);
  });

  it('wraps angles', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 5);
    expect(wrapAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI / 2, 5);
  });
});

import { buildAll } from './sculpt';
import type { HairStyle, OutfitKind } from '@accra/core';
import type { Accessory } from './spec';

describe('detailed model', () => {
  const hairs: HairStyle[] = ['lowcut', 'braids', 'wrap', 'afro', 'cornrows', 'scarf', 'bald'];
  const outfits: OutfitKind[] = ['tee', 'shirt', 'dress', 'kaftan', 'workwear'];
  const accessories: Accessory[] = ['none', 'cap', 'glasses', 'bag', 'headLoad'];

  const check = (spec: PersonSpec): void => {
    const model = buildAll(spec, computeDims(spec));
    expect(Object.keys(model.parts)).toContain('skin');
    for (const [name, m] of Object.entries(model.parts)) {
      const n = m.pos.length / 3;
      expect(n).toBeGreaterThan(0);
      expect(m.nrm.length).toBe(m.pos.length);
      expect(m.col.length).toBe(m.pos.length);
      expect(m.uv.length).toBe(n * 2);
      expect(m.bi.length).toBe(n * 4);
      expect(m.bw.length).toBe(n * 4);
      for (const v of m.pos) if (!Number.isFinite(v)) throw new Error(`${name}: non-finite position`);
      for (const v of m.nrm) if (!Number.isFinite(v)) throw new Error(`${name}: non-finite normal`);
      for (const i of m.idx) if (!(i >= 0 && i < n)) throw new Error(`${name}: index out of range`);
      for (const b of m.bi) if (!(b >= 0 && b < 19)) throw new Error(`${name}: bad bone index`);
      for (let i = 0; i < n; i++) {
        const s = (m.bw[i * 4] as number) + (m.bw[i * 4 + 1] as number) + (m.bw[i * 4 + 2] as number) + (m.bw[i * 4 + 3] as number);
        if (Math.abs(s - 1) > 1e-3) throw new Error(`${name}: weights sum to ${s}`);
      }
    }
  };

  it('every hair style, outfit and accessory builds a valid mesh', () => {
    const rng = new Rng(11);
    for (const hair of hairs) {
      for (const outfit of outfits) {
        const spec = { ...randomSpec(rng, 'commuter'), hair, outfit, accessory: accessories[(hairs.indexOf(hair) + outfits.indexOf(outfit)) % accessories.length] as Accessory };
        check(spec);
      }
    }
  });

  it('random people of every role build valid meshes', () => {
    const rng = new Rng(5);
    for (const role of ['commuter', 'vendor', 'trader', 'worker'] as const) for (let i = 0; i < 6; i++) check(randomSpec(rng, role));
  });
});
