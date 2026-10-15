import type { PersonSpec } from '../spec';
import {
  type Frame, armRings, armWeights, legRings, legWeights, lin, makeFrame, mixc, mulc, torsoRings, torsoShape, torsoWeights,
} from './body';
import { B, skeletonFor } from './skeleton';
import {
  type Influence, type MeshData, type Ring, addBox, addSphere, chainWeights, loft, newMesh, pushVertex, single, surface, tubeAlong, two,
} from './mesh';
import { type V3, clamp, fbm3, gauss, lerp, seeded, smooth, smoothstep, spline } from './math';

/**
 * Garments are shells wrapped around the body rings, a few millimetres out, so they bend with the same
 * bones. Folds are small displacements concentrated where the body bends.
 */
export interface ClothParts {
  /** The main garment: patterned fabric. */
  top: MeshData;
  /** Trousers and skirts: plain twill or canvas. */
  bottom: MeshData;
  /** Collars, belts, buttons, hems: flat colours. */
  trim: MeshData;
}

const TILE = 0.3;
const WHITE: V3 = [1, 1, 1];

/** Integer number of texture repeats around a tube. */
const repeatsFor = (radius: number): number => Math.max(1, Math.round((2 * Math.PI * radius) / TILE));

function foldNoiseBase(p: V3, seed: number): number {
  return fbm3(p[0] * 45, p[1] * 150, p[2] * 45, seed, 2) - 0.2;
}

export function buildCloth(spec: PersonSpec, d: import('../spec').Dims): ClothParts {
  const f = makeFrame(spec, d);
  const parts: ClothParts = { top: newMesh(), bottom: newMesh(), trim: newMesh() };
  const hs = f.hs;
  const lowH = f.clay ? -0.23 : -0.25;
  const seed = spec.seed % 1000;
  const foldNoise = (p: V3, s: number): number => foldNoiseBase(p, s) * (f.clay ? 0.3 : 1);
  const defs = skeletonFor(d);
  const tw = torsoWeights(f);
  const shape = torsoShape(f);
  void defs;

  const torsoShell = (m: MeshData, from: number, to: number, ease: (h: number) => number, o: { cap?: 'none' | 'start' | 'end' | 'both'; count?: number; foldAmp?: number } = {}): void => {
    const rings = torsoRings(f, o.count ?? 28, from, to).map((r) => ({ ...r, v: r.c[1] / TILE }));
    const avg = rings.reduce((s, r) => s + r.rx, 0) / rings.length;
    loft(m, rings, {
      radial: 32, roundness: 2.3, cap: o.cap ?? 'none', uScale: repeatsFor(avg * 1.1),
      color: (_r, _i, _a, p) => mulc(WHITE, 0.94 + 0.1 * fbm3(p[0] * 30, p[1] * 30, p[2] * 30, seed, 2)),
      weights: (r) => tw(r),
      shape,
      displace: (p, r) => {
        const waist = gauss(r.t - 0.3, 0.12);
        const chest = gauss(r.t - 0.78, 0.1);
        return ease(r.t) + (o.foldAmp ?? 1) * hs * (0.0012 + 0.0035 * waist + 0.0015 * chest) * foldNoise(p, seed) * 2 * smoothstep(0.0, 0.06, r.t);
      },
    });
  };

  const sleeve = (m: MeshData, sign: number, from: number, to: number, ease: (fr: number) => number, count = 14): void => {
    const rings = armRings(f, sign, count, from, to, from === 0).map((r) => ({ ...r, v: r.c[1] / TILE }));
    const aw = armWeights(f, sign);
    loft(m, rings, {
      radial: 18, cap: from === 0 ? 'start' : 'none', uScale: repeatsFor(0.05 * hs),
      color: (_r, _i, _a, p) => mulc(WHITE, 0.94 + 0.1 * fbm3(p[0] * 30, p[1] * 30, p[2] * 30, seed + 1, 2)),
      weights: (r) => aw(r),
      displace: (p, r) => ease(r.t) + hs * (0.0012 + 0.004 * gauss(r.t - 0.5, 0.1) + 0.003 * gauss(r.t - 0.02, 0.06)) * foldNoise(p, seed + 2) * 2,
    });
  };

  const trousers = (m: MeshData, sign: number, from: number, to: number, ease: (fr: number) => number): void => {
    const rings = legRings(f, sign, 24, from, to).map((r) => ({ ...r, v: r.c[1] / TILE }));
    const lw = legWeights(f, sign);
    loft(m, rings, {
      radial: 22, cap: 'none', uScale: repeatsFor(0.07 * hs),
      color: (_r, _i, _a, p) => mulc(WHITE, 0.94 + 0.1 * fbm3(p[0] * 30, p[1] * 30, p[2] * 30, seed + 3, 2)),
      weights: (r) => lw(r),
      displace: (p, r) =>
        ease(r.t) + hs * (0.0012 + 0.005 * gauss(r.t - 0.5, 0.07) + 0.004 * gauss(r.t - 0.06, 0.05) + 0.002 * smoothstep(0.8, 1, r.t)) * foldNoise(p, seed + 4) * 2,
    });
  };

  const collar = (m: MeshData, color: V3, height: number, flare: number): void => {
    const rings: Ring[] = [];
    const nr = (f.clay ? 0.064 : f.female ? 0.039 : 0.047) * hs * f.bw;
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      rings.push({
        c: [0, f.lm.neckBaseY - 0.008 * hs + t * height * hs, -0.006 * hs],
        rx: nr + 0.011 * hs + flare * hs * t * t,
        rz: nr * 1.05 + 0.011 * hs + flare * hs * t * t,
        v: t, t,
      });
    }
    loft(m, rings, {
      radial: 20, cap: 'none',
      color: () => color,
      weights: (r) => chainWeights([{ bone: B.chest, start: -9 }, { bone: B.neck, start: f.lm.neckBaseY }], r.c[1], 0.02 * hs),
    });
  };

  const belt = (m: MeshData, color: V3): void => {
    const rings = torsoRings(f, 5, 0.13, 0.19);
    loft(m, rings, {
      radial: 32, roundness: 2.3, cap: 'none',
      color: () => color,
      weights: (r) => tw(r),
      shape,
      displace: () => 0.026 * hs,
    });
    // Buckle.
    const r0 = torsoRings(f, 1, 0.16, 0.16)[0] as Ring;
    addBox(m, [0, r0.c[1], r0.rz + 0.028 * hs], 0.014 * hs, 0.012 * hs, 0.003 * hs, lin(0xc9b36a), single(B.spine));
  };

  /** A vertical strip on the front of the torso (plackets, pockets, zips). */
  const frontStrip = (m: MeshData, x0: number, halfWidth: number, h0: number, h1: number, lift: number, col: V3): void => {
    const rows = 10;
    const rings = torsoRings(f, rows, h0, h1);
    surface(
      m, 3, rows - 1,
      (u, v) => {
        const r = rings[Math.round(v * (rows - 1))] as Ring;
        const x = x0 + (u - 0.5) * 2 * halfWidth;
        const z = r.c[2] + r.rz * Math.sqrt(Math.max(0.05, 1 - (x / r.rx) ** 2)) + lift;
        return shape([x, r.c[1], z]);
      },
      () => col,
      (_u, v) => tw(rings[Math.round(v * (rows - 1))] as Ring),
    );
  };

  const button = (m: MeshData, h: number, col: V3): void => {
    const r = torsoRings(f, 1, h, h)[0] as Ring;
    const p = shape([0, r.c[1], r.c[2] + r.rz + 0.024 * hs]);
    addSphere(m, p, 0.0055 * hs, () => col, tw(r), 8, 6);
  };

  const sleeveTrimRing = (m: MeshData, sign: number, fr: number, e: number, col: V3): void => {
    const rings = armRings(f, sign, 3, fr, fr + 0.045, false);
    const aw = armWeights(f, sign);
    loft(m, rings, { radial: 18, cap: 'none', color: () => col, weights: (r) => aw(r), displace: () => e });
  };

  const skirt = (m: MeshData, topH: number, hemY: number, hemRx: number, hemRz: number, folds: number, off: number): void => {
    const waist = torsoRings(f, 1, topH, topH)[0] as Ring;
    const count = 18;
    const rings: Ring[] = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const k = t ** 0.75;
      const y = lerp(waist.c[1], hemY, t);
      rings.push({
        c: [0, y, lerp(waist.c[2], -0.005 * hs, k)],
        rx: lerp(waist.rx + off * hs, hemRx, k),
        rz: lerp(waist.rz + off * hs, hemRz, k),
        v: y / TILE, t,
      });
    }
    const span = waist.c[1] - hemY;
    const wob = (p: V3): number => fbm3(p[0] * 8, p[1] * 3, p[2] * 8, seed + 20, 2);
    loft(m, rings, {
      radial: 40, cap: 'none', uScale: repeatsFor(hemRx * 0.8),
      color: (r) => mulc(WHITE, 0.9 + 0.14 * r.t),
      weights: (_r, _i, _a, p) => {
        const depth = clamp((waist.c[1] - p[1]) / span, 0, 1);
        const w = smooth(depth) * 0.35;
        const sideL = clamp(0.5 + p[0] / (0.14 * hs), 0, 1);
        const wl = w * sideL;
        const wr = w * (1 - sideL);
        return { b: [B.hips, B.thighL, B.thighR, 0], w: [1 - wl - wr, wl, wr, 0] };
      },
      displace: (p, r, _i, a) => {
        const amp = (0.003 + 0.017 * r.t) * hs * (f.clay ? 0.55 : 1);
        return amp * Math.sin(a * folds + wob(p) * 5) * smoothstep(0.03, 0.3, r.t);
      },
    });
    // Hem band.
    const hem = rings.slice(-3).map((r, i) => ({ ...r, rx: r.rx + 0.003 * hs, rz: r.rz + 0.003 * hs, v: i }));
    loft(parts.trim, hem, {
      radial: 40, cap: 'none',
      color: () => lin(spec.accent),
      weights: (_r, _i, _a, p) => {
        const depth = clamp((waist.c[1] - p[1]) / span, 0, 1);
        const w = smooth(depth) * 0.35;
        const sideL = clamp(0.5 + p[0] / (0.14 * hs), 0, 1);
        return { b: [B.hips, B.thighL, B.thighR, 0], w: [1 - w, w * sideL, w * (1 - sideL), 0] };
      },
      displace: (p, r, _i, a) => (0.003 + 0.017 * r.t) * hs * (f.clay ? 0.55 : 1) * Math.sin(a * folds + wob(p) * 5) * 0.9,
    });
  };

  const legsBottom = (from: number, to: number, ease: (t: number) => number): void => {
    for (const sign of [1, -1]) trousers(parts.bottom, sign, from, to, ease);
  };

  const flare = (t: number): number => 0.007 * hs + 0.008 * hs * smoothstep(0.65, 1, t);
  const snug = 0.007 * hs;

  const neck = lin(spec.accent);
  switch (spec.outfit) {
    case 'tee': {
      torsoShell(parts.top, -0.14, 1.0, (h) => 0.011 * hs + 0.022 * hs * smoothstep(0.12, -0.14, h));
      if (spec.sleeves !== 'none') for (const sign of [1, -1]) sleeve(parts.top, sign, 0, 0.4, (fr) => 0.011 * hs + 0.007 * hs * smoothstep(0.1, 0.4, fr));
      collar(parts.trim, mixc(lin(spec.top), neck, 0.35), 0.022, 0.0);
      belt(parts.trim, lin(0x2a1d14));
      torsoShell(parts.bottom, lowH, 0.17, (h) => snug + 0.014 * hs * smoothstep(0.05, -0.2, h), { cap: 'start' });
      if (spec.shorts) legsBottom(0, 0.42, () => 0.012 * hs);
      else legsBottom(0.06, 1, flare);
      break;
    }
    case 'shirt': {
      torsoShell(parts.top, -0.14, 0.99, (h) => 0.012 * hs + 0.022 * hs * smoothstep(0.12, -0.14, h));
      for (const sign of [1, -1]) {
        sleeve(parts.top, sign, 0, 0.96, (fr) => 0.010 * hs + 0.004 * hs * gauss(fr - 0.5, 0.15));
        sleeveTrimRing(parts.trim, sign, 0.9, 0.013 * hs, mixc(lin(spec.top), WHITE, 0.25));
      }
      collar(parts.trim, mixc(lin(spec.top), WHITE, 0.2), 0.034, 0.012);
      frontStrip(parts.trim, 0, 0.012 * hs, -0.05, 1.0, 0.022 * hs, mixc(lin(spec.top), WHITE, 0.2));
      for (let i = 0; i < 7; i++) button(parts.trim, 0.1 + i * 0.13, lin(0xf2efe6));
      belt(parts.trim, lin(0x2a1d14));
      torsoShell(parts.bottom, lowH, 0.17, (h) => snug + 0.014 * hs * smoothstep(0.05, -0.2, h), { cap: 'start' });
      legsBottom(0.06, 1, flare);
      break;
    }
    case 'dress': {
      torsoShell(parts.top, -0.07, 1.0, (h) => 0.008 * hs + 0.006 * hs * smoothstep(0.2, -0.12, h));
      if (spec.sleeves !== 'none') for (const sign of [1, -1]) sleeve(parts.top, sign, 0, 0.28, (fr) => 0.010 * hs + 0.005 * hs * smoothstep(0.1, 0.28, fr));
      collar(parts.trim, lin(spec.accent), 0.014, 0.004);
      skirt(parts.top, -0.04, f.lm.kneeY - 0.1 * hs, 0.27 * hs * f.bw, 0.23 * hs * f.bd, 11 + (seed % 4), 0.0122);
      break;
    }
    case 'kaftan': {
      torsoShell(parts.top, -0.07, 1.0, (h) => 0.022 * hs + 0.012 * hs * smoothstep(0.3, -0.12, h));
      for (const sign of [1, -1]) sleeve(parts.top, sign, 0, 0.62, (fr) => 0.02 * hs + 0.012 * hs * smoothstep(0.3, 0.62, fr), 12);
      skirt(parts.top, -0.04, f.lm.kneeY + 0.04 * hs, 0.235 * hs * f.bw, 0.19 * hs * f.bd, 9 + (seed % 3), 0.0305);
      collar(parts.trim, lin(spec.accent), 0.02, 0.012);
      frontStrip(parts.trim, 0, 0.022 * hs, 0.0, 1.0, 0.042 * hs, lin(spec.accent));
      frontStrip(parts.trim, 0, 0.007 * hs, 0.0, 1.0, 0.048 * hs, mulc(lin(spec.accent), 0.6));
      torsoShell(parts.bottom, lowH, 0.1, () => snug, { cap: 'start' });
      legsBottom(0.06, 1, flare);
      break;
    }
    case 'workwear': {
      torsoShell(parts.top, -0.14, 1.0, (h) => 0.012 * hs + 0.012 * hs * smoothstep(0.12, -0.14, h));
      torsoShell(parts.top, lowH, 0.17, (h) => snug + 0.014 * hs * smoothstep(0.05, -0.2, h), { cap: 'start' });
      for (const sign of [1, -1]) sleeve(parts.top, sign, 0, 0.97, (fr) => 0.011 * hs + 0.003 * hs * gauss(fr - 0.5, 0.2));
      for (const sign of [1, -1]) trousers(parts.top, sign, 0.06, 1, (t) => 0.011 * hs + 0.004 * hs * smoothstep(0.7, 1, t));
      collar(parts.trim, mulc(lin(spec.top), 0.8), 0.036, 0.014);
      frontStrip(parts.trim, 0, 0.012 * hs, -0.2, 1.0, 0.024 * hs, mulc(lin(spec.top), 0.65));
      for (const sx of [-1, 1]) {
        frontStrip(parts.trim, sx * 0.075 * hs, 0.034 * hs, 0.6, 0.72, 0.026 * hs, mulc(lin(spec.top), 0.8));
      }
      belt(parts.trim, mulc(lin(spec.top), 0.6));
      break;
    }
  }

  // Bag: a satchel hanging at the hip, its strap running diagonally across the chest over the opposite shoulder.
  if (spec.accessory === 'bag') {
    const leather = [0x5a3a22, 0x2a2420, 0x7a5a30, 0x3b2a1a, spec.accent];
    const col = mulc(lin(leather[seed % leather.length] as number), 0.9);
    const dark = mulc(col, 0.7);
    const side = spec.seed % 2 === 0 ? 1 : -1;
    // A point on the torso surface at height h (torso fraction) and a fraction of the ring (-1 back .. 0 side .. front).
    const onTorso = (h: number, a: number, lift: number): { p: V3; ring: Ring } => {
      const ring = torsoRings(f, 1, h, h)[0] as Ring;
      const p: V3 = [ring.c[0] + Math.cos(a) * (ring.rx + lift), ring.c[1], ring.c[2] + Math.sin(a) * (ring.rz + lift)];
      return { p: shape(p), ring };
    };
    // Strap: from the shoulder on the far side, diagonal across the front, down to the bag side.
    const farA = Math.PI / 2 + side * 0.62; // front-ish, on the far side
    const nearA = side > 0 ? 0.12 : Math.PI - 0.12; // side of the hip
    const strapPts: Array<{ p: V3; r: number; r2: number }> = [];
    const steps = 14;
    let lastRing: Ring | null = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const h = lerp(0.97, 0.06, t);
      const a = lerp(farA, nearA, smooth(t));
      const o = onTorso(h, a, 0.027 * hs);
      lastRing = o.ring;
      strapPts.push({ p: o.p, r: 0.013 * hs, r2: 0.0045 * hs });
    }
    // Over the shoulder and diagonally down the back to the bag side.
    const back: Array<{ p: V3; r: number; r2: number }> = [];
    const farA1 = Math.PI / 2 + 0.62;
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const a1 = lerp(farA1, Math.PI * 2 - 0.2, smooth(t));
      const a = side > 0 ? a1 : Math.PI - a1;
      const o = onTorso(lerp(0.97, 0.06, t), a, 0.027 * hs);
      back.push({ p: o.p, r: 0.013 * hs, r2: 0.0045 * hs });
    }
    void lastRing;
    const strapWeights = (_i: number, p: V3): Influence => {
      const r = torsoRings(f, 1, clamp((p[1] - f.lm.hipY) / d.torso, -0.2, 1), clamp((p[1] - f.lm.hipY) / d.torso, -0.2, 1))[0] as Ring;
      return tw(r);
    };
    tubeAlong(parts.trim, strapPts, { radial: 8, color: () => col, weights: strapWeights, cap: 'both', up: [0, 0, 1] });
    tubeAlong(parts.trim, back, { radial: 8, color: () => col, weights: strapWeights, cap: 'both', up: [0, 0, 1] });
    // Bag body: a soft rounded box hanging on the near hip, a flap over the top, a buckle.
    const ring0 = torsoRings(f, 1, 0.0, 0.0)[0] as Ring;
    const bx = side * (ring0.rx + 0.04 * hs);
    const bz = -0.075 * hs;
    const topY = f.lm.hipY + 0.07 * hs;
    const height = 0.17 * hs;
    const bagW = 0.17 * hs;
    const bagD = 0.07 * hs;
    const bagWeights = (): Influence => two(B.hips, B.spine, 0.15);
    const bagRings: Ring[] = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const sag = 1 + 0.08 * Math.sin(t * Math.PI);
      bagRings.push({
        c: [bx, topY - t * height, bz], rx: bagD * 0.5 * sag * (t > 0.9 ? 0.9 : 1), rz: bagW * 0.5 * sag * (t > 0.9 ? 0.85 : 1),
        u: [1, 0, 0], w: [0, 0, 1], v: t, t,
      });
    }
    loft(parts.trim, bagRings, {
      radial: 24, roundness: 3, cap: 'both',
      color: (_r, _i, _a, p) => mulc(col, 0.92 + 0.14 * fbm3(p[0] * 80, p[1] * 80, p[2] * 80, seed + 7, 2)),
      weights: bagWeights,
      displace: (_p, r) => 0.003 * hs * Math.sin(r.t * 9),
    });
    // Flap.
    const flapRings: Ring[] = [];
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      flapRings.push({ c: [bx, topY - t * height * 0.38, bz], rx: bagD * 0.5 + 0.006 * hs, rz: bagW * 0.5 + 0.004 * hs, u: [1, 0, 0], w: [0, 0, 1], v: t, t });
    }
    loft(parts.trim, flapRings, { radial: 24, roundness: 3, cap: 'both', color: () => dark, weights: bagWeights });
    addBox(parts.trim, [bx + side * (bagD * 0.5 + 0.009 * hs), topY - height * 0.34, bz], 0.003 * hs, 0.011 * hs, 0.014 * hs, lin(0xc9b36a), bagWeights());
    // Strap ends meet the bag top.
    const hip = onTorso(0.06, nearA, 0.027 * hs).p;
    tubeAlong(parts.trim, [
      { p: hip, r: 0.013 * hs, r2: 0.0045 * hs },
      { p: [bx - side * bagD * 0.2, topY + 0.004 * hs, bz + bagW * 0.32], r: 0.013 * hs, r2: 0.0045 * hs },
    ], { radial: 8, color: () => col, weights: bagWeights, cap: 'both', up: [0, 0, 1] });
    tubeAlong(parts.trim, [
      { p: hip, r: 0.013 * hs, r2: 0.0045 * hs },
      { p: [bx - side * bagD * 0.2, topY + 0.004 * hs, bz - bagW * 0.32], r: 0.013 * hs, r2: 0.0045 * hs },
    ], { radial: 8, color: () => col, weights: bagWeights, cap: 'both', up: [0, 0, 1] });
  }
  void seeded;
  void spline;
  void pushVertex;
  return parts;
}
