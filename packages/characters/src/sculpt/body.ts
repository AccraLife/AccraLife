import type { Dims, PersonSpec } from '../spec';
import { BUILD_SCALE } from '../spec';
import {
  type Influence, type MeshData, type Ring, addSphere, chainWeights, loft, newMesh, pushVertex, single, surface, tubeAlong, two,
} from './mesh';
import { type V3, clamp, fbm3, gauss, lerp, smoothstep, spline } from './math';
import { B, landmarks, skeletonFor } from './skeleton';

/** sRGB hex to linear 0..1 triple (vertex colours are read as linear by three.js). */
export function lin(hex: number): V3 {
  const f = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}
export const mulc = (c: V3, k: number): V3 => [c[0] * k, c[1] * k, c[2] * k];
export const mixc = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Everything a garment or hair piece needs to follow the body. */
export interface Frame {
  spec: PersonSpec;
  d: Dims;
  /** Metres per unit of the 1.76 m reference figure. */
  hs: number;
  bw: number;
  bd: number;
  bl: number;
  female: boolean;
  lm: ReturnType<typeof landmarks>;
  headCentre: V3;
  headR: V3;
  skin: V3;
  clay: boolean;
  eyeX: number;
  eyeY: number;
}

export function makeFrame(spec: PersonSpec, d: Dims): Frame {
  const bs = BUILD_SCALE[spec.build];
  const lm = landmarks(d);
  const hs = d.height / 1.76;
  const clay = spec.style === 'clay';
  const headR: V3 = clay ? [d.headR * 1.0, d.headR * 0.94, d.headR * 0.96] : [d.headR * 0.73, d.headR, d.headR * 0.9];
  const headCentre: V3 = clay ? [0, lm.headBaseY + d.headR * 0.86, 0.004 * hs] : [0, lm.headBaseY + d.headR * 0.82, 0.006 * hs];
  return {
    spec, d, hs, bw: bs.width, bd: bs.depth, bl: bs.limb, female: spec.female, lm,
    headCentre, headR, clay,
    eyeX: clay ? headR[0] * 0.4 : 0.036 * hs,
    eyeY: clay ? headCentre[1] - headR[1] * 0.04 : headCentre[1] + 0.13 * headR[1],
    skin: lin(spec.skin),
  };
}

// ---------- torso ----------
const TORSO_M: ReadonlyArray<readonly [number, number]> = [
  [-0.25, 0.07], [-0.2, 0.12], [-0.12, 0.15], [-0.03, 0.165], [0.15, 0.155], [0.32, 0.135], [0.52, 0.15], [0.72, 0.168], [0.84, 0.182], [0.9, 0.186], [0.95, 0.172], [0.985, 0.125], [1.03, 0.063],
];
const TORSO_M_Z: ReadonlyArray<readonly [number, number]> = [
  [-0.25, 0.06], [-0.2, 0.09], [-0.12, 0.105], [-0.03, 0.113], [0.15, 0.106], [0.32, 0.098], [0.52, 0.106], [0.72, 0.116], [0.88, 0.104], [0.95, 0.088], [0.99, 0.075], [1.03, 0.064],
];
const TORSO_F: ReadonlyArray<readonly [number, number]> = [
  [-0.25, 0.07], [-0.2, 0.125], [-0.12, 0.16], [-0.03, 0.178], [0.15, 0.165], [0.32, 0.118], [0.52, 0.13], [0.72, 0.147], [0.84, 0.158], [0.9, 0.162], [0.95, 0.148], [0.985, 0.108], [1.03, 0.058],
];
const TORSO_F_Z: ReadonlyArray<readonly [number, number]> = [
  [-0.25, 0.06], [-0.2, 0.092], [-0.12, 0.108], [-0.03, 0.118], [0.15, 0.11], [0.32, 0.09], [0.52, 0.098], [0.72, 0.112], [0.88, 0.098], [0.95, 0.084], [0.99, 0.07], [1.03, 0.058],
];

const TORSO_C: ReadonlyArray<readonly [number, number]> = [
  [-0.25, 0.1], [-0.2, 0.15], [-0.12, 0.178], [-0.03, 0.19], [0.15, 0.183], [0.32, 0.17], [0.52, 0.176], [0.72, 0.184], [0.84, 0.19], [0.9, 0.186], [0.95, 0.165], [0.985, 0.118], [1.03, 0.072],
];
const TORSO_CF: ReadonlyArray<readonly [number, number]> = [
  [-0.25, 0.1], [-0.2, 0.15], [-0.12, 0.18], [-0.03, 0.195], [0.15, 0.178], [0.32, 0.155], [0.52, 0.165], [0.72, 0.176], [0.84, 0.18], [0.9, 0.176], [0.95, 0.158], [0.985, 0.114], [1.03, 0.07],
];
const zOf = (t: ReadonlyArray<readonly [number, number]>, k: number): ReadonlyArray<readonly [number, number]> => t.map(([h, r]) => [h, r * k] as const);
const TORSO_C_Z = zOf(TORSO_C, 0.84);
const TORSO_CF_Z = zOf(TORSO_CF, 0.84);

export function torsoRings(f: Frame, count = 36, from = -0.25, to = 1.03): Ring[] {
  const rx = f.clay ? (f.female ? TORSO_CF : TORSO_C) : f.female ? TORSO_F : TORSO_M;
  const rz = f.clay ? (f.female ? TORSO_CF_Z : TORSO_C_Z) : f.female ? TORSO_F_Z : TORSO_M_Z;
  const rings: Ring[] = [];
  for (let i = 0; i < count; i++) {
    const h = count > 1 ? from + ((to - from) * i) / (count - 1) : from;
    const belly = f.spec.build === 'heavy' ? 0.03 : f.spec.build === 'broad' ? 0.012 : 0;
    const bellyShape = belly * gauss(h - 0.22, 0.2);
    rings.push({
      c: [0, f.lm.hipY + h * f.d.torso, bellyShape * 0.5 * f.hs],
      rx: spline(rx, h) * f.hs * f.bw,
      rz: (spline(rz, h) + bellyShape) * f.hs * f.bd,
      v: (h - from) / (to - from),
      t: h,
    });
  }
  return rings;
}

export function torsoWeights(f: Frame): (r: Ring) => Influence {
  const defs = skeletonFor(f.d);
  const chain = [
    { bone: B.hips, start: -9 },
    { bone: B.spine, start: (defs[B.spine] as { joint: V3 }).joint[1] },
    { bone: B.chest, start: (defs[B.chest] as { joint: V3 }).joint[1] },
    { bone: B.neck, start: (defs[B.neck] as { joint: V3 }).joint[1] },
  ];
  return (r) => chainWeights(chain, r.c[1], 0.07 * f.hs);
}

/** Bust, belly, glutes and chest shaping applied to torso (and clothing) vertices. */
export function torsoShape(f: Frame): (p: V3) => V3 {
  if (f.clay) return (p) => p;
  const yb = f.lm.hipY + 0.74 * f.d.torso;
  const ybelly = f.lm.hipY + 0.24 * f.d.torso;
  const yglute = f.lm.hipY - 0.05 * f.d.torso;
  const bust = (f.female ? 0.034 : 0.012) * f.hs * (f.spec.build === 'heavy' ? 1.35 : f.spec.build === 'slim' ? 0.8 : 1);
  const belly = f.spec.build === 'heavy' ? 0.04 : f.spec.build === 'broad' ? 0.018 : f.female ? 0.006 : 0.004;
  const glute = (f.female ? 0.03 : 0.02) * f.hs;
  const xs = (f.female ? 0.078 : 0.09) * f.hs * f.bw;
  return (p) => {
    let [x, y, z] = p;
    const ax = Math.abs(x);
    if (z > 0) {
      z += bust * gauss(y - yb, 0.055 * f.hs) * gauss(ax - xs, 0.05 * f.hs);
      z += belly * f.hs * gauss(y - ybelly, 0.09 * f.hs) * gauss(ax, 0.12 * f.hs);
    } else {
      z -= glute * gauss(y - yglute, 0.07 * f.hs) * gauss(ax - 0.075 * f.hs, 0.06 * f.hs);
      z -= 0.01 * f.hs * gauss(y - (f.lm.hipY + 0.6 * f.d.torso), 0.12 * f.hs) * gauss(ax, 0.1 * f.hs);
    }
    return [x, y, z];
  };
}

// ---------- legs ----------
const LEG_X: ReadonlyArray<readonly [number, number]> = [
  [0, 0.095], [0.1, 0.092], [0.25, 0.078], [0.42, 0.056], [0.5, 0.05], [0.6, 0.052], [0.68, 0.054], [0.85, 0.036], [1, 0.028],
];
const LEG_Z: ReadonlyArray<readonly [number, number]> = [
  [0, 0.105], [0.1, 0.1], [0.25, 0.088], [0.42, 0.062], [0.5, 0.056], [0.6, 0.06], [0.68, 0.064], [0.85, 0.042], [1, 0.032],
];

const LEG_CX: ReadonlyArray<readonly [number, number]> = [
  [0, 0.1], [0.1, 0.098], [0.25, 0.088], [0.42, 0.07], [0.5, 0.066], [0.6, 0.068], [0.68, 0.072], [0.85, 0.058], [1, 0.05],
];
const LEG_CZ: ReadonlyArray<readonly [number, number]> = LEG_CX.map(([a, r]) => [a, r * 1.04] as const);

export function legRings(f: Frame, sign: number, count = 26, f0 = 0, f1 = 1): Ring[] {
  const top = f.lm.hipY + 0.03 * f.hs;
  const bottom = f.lm.ankleY;
  const span = top - bottom;
  const fem = f.female ? 0.93 : 1;
  const rings: Ring[] = [];
  for (let i = 0; i < count; i++) {
    const fr = f0 + ((f1 - f0) * i) / (count - 1);
    const y = top - fr * span;
    rings.push({
      c: [sign * f.lm.hipX * (1 - 0.1 * fr), y, f.hs * (-0.012 * gauss(fr - 0.66, 0.1) + 0.004 * gauss(fr - 0.5, 0.1))],
      rx: spline(f.clay ? LEG_CX : LEG_X, fr) * f.hs * f.bl * fem,
      rz: spline(f.clay ? LEG_CZ : LEG_Z, fr) * f.hs * f.bl * fem,
      v: fr,
      t: fr,
    });
  }
  return rings;
}

export function legWeights(f: Frame, sign: number): (r: Ring) => Influence {
  const t = sign > 0 ? B.thighL : B.thighR;
  const defs = skeletonFor(f.d);
  const chain = [
    { bone: B.hips, start: -9 },
    { bone: t, start: -(defs[t] as { joint: V3 }).joint[1] + 0.02 },
    { bone: t + 1, start: -(defs[t + 1] as { joint: V3 }).joint[1] },
    { bone: t + 2, start: -(defs[t + 2] as { joint: V3 }).joint[1] + 0.01 },
  ];
  // Coordinate is -y so that it increases downward.
  return (r) => chainWeights(chain, -r.c[1], 0.045 * f.hs);
}

// ---------- arms ----------
const ARM_X: ReadonlyArray<readonly [number, number]> = [
  [0, 0.047], [0.12, 0.045], [0.38, 0.036], [0.5, 0.032], [0.58, 0.036], [0.75, 0.03], [1, 0.021],
];
const ARM_Z: ReadonlyArray<readonly [number, number]> = [
  [0, 0.047], [0.12, 0.045], [0.38, 0.037], [0.5, 0.034], [0.58, 0.038], [0.75, 0.03], [1, 0.016],
];

const ARM_CX: ReadonlyArray<readonly [number, number]> = [
  [0, 0.068], [0.12, 0.066], [0.38, 0.058], [0.5, 0.056], [0.58, 0.058], [0.75, 0.052], [1, 0.044],
];

export function armRings(f: Frame, sign: number, count = 22, f0 = 0, f1 = 1, withCap = true): Ring[] {
  const length = f.d.upperArm + f.d.foreArm;
  const sy = f.lm.shoulderY;
  const thin = f.clay ? 1 : f.female ? 0.88 : 1;
  const rings: Ring[] = [];
  const px = (fr: number): number => sign * (f.lm.shoulderX + f.d.height * 0.02 * fr);
  if (withCap && f0 === 0) {
    for (const [dy, k] of [[0.02, 0.4], [0.014, 0.75], [0.006, 0.96]] as const) {
      rings.push({ c: [px(0), sy + dy * f.hs, 0], rx: (f.clay ? 0.068 : 0.047) * f.hs * f.bl * thin * k, rz: (f.clay ? 0.068 : 0.047) * f.hs * f.bl * thin * k, v: -0.05, t: -0.05 });
    }
  }
  for (let i = 0; i < count; i++) {
    const fr = f0 + ((f1 - f0) * i) / (count - 1);
    rings.push({
      c: [px(fr), sy - fr * length, 0],
      rx: spline(f.clay ? ARM_CX : ARM_X, fr) * f.hs * f.bl * thin,
      rz: spline(f.clay ? ARM_CX : ARM_Z, fr) * f.hs * f.bl * thin,
      v: fr,
      t: fr,
    });
  }
  return rings;
}

export function armWeights(f: Frame, sign: number): (r: Ring) => Influence {
  const u = sign > 0 ? B.uArmL : B.uArmR;
  const defs = skeletonFor(f.d);
  const sy = (defs[u] as { joint: V3 }).joint[1];
  const chain = [
    { bone: B.chest, start: -9 },
    { bone: u, start: 0.0 },
    { bone: u + 1, start: sy - (defs[u + 1] as { joint: V3 }).joint[1] },
    { bone: u + 2, start: sy - (defs[u + 2] as { joint: V3 }).joint[1] },
  ];
  return (r) => chainWeights(chain, sy - r.c[1], (f.clay ? 0.055 : 0.03) * f.hs);
}

// ---------- skin colour with subtle variation ----------
export function skinColor(f: Frame, p: V3, extra = 1): V3 {
  if (f.clay) {
    // Clay is evenly coloured with a soft light-to-shadow drift, no freckled variation.
    const n = fbm3(p[0] * 6, p[1] * 6, p[2] * 6, 3, 2);
    return mulc(f.skin, extra * (0.97 + 0.07 * n));
  }
  const n = fbm3(p[0] * 40, p[1] * 40, p[2] * 40, 3, 2);
  const warm = mixc(f.skin, mulc(f.skin, 1.18), n);
  return mulc(warm, extra);
}

export interface BodyParts {
  skin: MeshData;
  eyes: MeshData;
  shoes: MeshData;
}

export function buildBody(spec: PersonSpec, d: Dims): BodyParts {
  const f = makeFrame(spec, d);
  const skin = newMesh();
  const eyes = newMesh();
  const shoes = newMesh();
  const color = (p: V3, k = 1): V3 => skinColor(f, p, k);

  // Torso.
  const tw = torsoWeights(f);
  loft(skin, torsoRings(f), {
    radial: 28, roundness: 2.3, cap: 'both',
    color: (_r, _i, _a, p) => color(p),
    weights: (r) => tw(r),
    shape: torsoShape(f),
  });

  // Neck.
  const neckRings: Ring[] = [];
  const nr = (f.clay ? 0.064 : f.female ? 0.039 : 0.047) * f.hs * f.bw;
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const y = f.lm.neckBaseY - 0.03 * f.hs + t * (d.neck + (f.clay ? 0.07 : 0.05) * f.hs);
    neckRings.push({ c: [0, y, -0.004 * f.hs - 0.004 * f.hs * t], rx: nr * (1 - 0.1 * t), rz: nr * 1.05 * (1 - 0.1 * t), v: t, t });
  }
  loft(skin, neckRings, {
    radial: 16, cap: 'none',
    color: (_r, _i, _a, p) => color(p),
    weights: (r) => chainWeights([{ bone: B.chest, start: -9 }, { bone: B.neck, start: f.lm.neckBaseY - 0.04 }, { bone: B.head, start: f.lm.headBaseY }], r.c[1], 0.04 * f.hs),
  });

  // Legs and arms.
  for (const sign of [1, -1]) {
    const lw = legWeights(f, sign);
    loft(skin, legRings(f, sign), {
      radial: 20, cap: 'start',
      color: (_r, _i, _a, p) => color(p),
      weights: (r) => lw(r),
      displace: (_p, r, _i, a) => 0.008 * f.hs * gauss(r.t - 0.5, 0.03) * Math.max(0, Math.sin(a)),
    });
    const aw = armWeights(f, sign);
    loft(skin, armRings(f, sign), {
      radial: 16, cap: 'start',
      color: (_r, _i, _a, p) => color(p),
      weights: (r) => aw(r),
    });
    buildHand(f, skin, sign);
    buildEar(f, skin, sign);
    buildShoe(f, shoes, sign);
  }

  if (f.clay) buildHeadClay(f, skin, eyes);
  else buildHead(f, skin, eyes);
  return { skin, eyes, shoes };
}

// ---------- hand ----------
function buildHand(f: Frame, m: MeshData, sign: number): void {
  const hs = f.hs;
  const hand = sign > 0 ? B.handL : B.handR;
  const fing = sign > 0 ? B.fingL : B.fingR;
  const x0 = sign * (f.lm.shoulderX + f.d.height * 0.02);
  const wy = f.lm.wristY;
  const ky = f.lm.knuckleY;
  const col = (p: V3, k = 1): V3 => skinColor(f, p, k);
  const hk = f.clay ? 1.45 : 1; // chunky toy hands

  // Palm: a flattened tube from wrist to knuckles.
  const palm: Ring[] = [];
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    palm.push({
      c: [x0, lerp(wy + 0.006 * hs, ky, t), 0.002 * hs],
      rx: lerp(0.019, 0.0215, Math.sin(t * Math.PI * 0.5)) * hs * f.bl * (f.female && !f.clay ? 0.9 : 1) * hk,
      rz: lerp(0.0165, 0.0115, t) * hs * f.bl * hk,
      v: t, t,
    });
  }
  // Palm rx is across the hand: the hand hangs with its flat side toward the leg, so swap axes.
  for (const r of palm) {
    const a = r.rx;
    r.rx = r.rz * 1.15;
    r.rz = a;
  }
  loft(m, palm, {
    radial: 12, cap: 'both', roundness: 2.4,
    color: (_r, _i, a, p) => col(p, Math.cos(a) * sign < -0.3 ? 1.22 : 1),
    weights: (r) => two(B.fArmL + (sign > 0 ? 0 : 4), hand, smoothstep(0, 0.35, r.t)),
  });

  // Fingers: index to little finger, curled gently toward the palm. They sit across z.
  const lens = [0.038, 0.042, 0.039, 0.031].map((v) => v * (f.clay ? 1.1 : 1));
  const zs = [0.0135, 0.0045, -0.0045, -0.0135].map((v) => v * hk);
  for (let k = 0; k < 4; k++) {
    const rings: Ring[] = [];
    let px = x0;
    let py = ky;
    let ang = 0;
    const L = (lens[k] as number) * hs;
    const curls = [0.16, 0.45, 0.55];
    const segs = 3;
    for (let sgi = 0; sgi < segs; sgi++) {
      ang += (curls[sgi] as number) * 0.55;
      for (let s = 0; s < 2; s++) {
        const seg = L / segs / 2;
        px += -sign * Math.sin(ang) * seg;
        py -= Math.cos(ang) * seg;
        if (sgi === 0 && s === 0) rings.push({ c: [x0, ky, (zs[k] as number) * hs], rx: 0.0088 * hs * hk, rz: 0.0088 * hs * hk, u: [0, 0, 1], w: [1, 0, 0], v: 0, t: 0 });
        const tt = (sgi * 2 + s + 1) / (segs * 2);
        rings.push({
          c: [px, py, (zs[k] as number) * hs],
          rx: lerp(0.0088, 0.0066, tt) * hs * hk,
          rz: lerp(0.0086, 0.0062, tt) * hs * hk,
          u: [0, 0, 1],
          w: [Math.cos(ang), -sign * Math.sin(ang), 0],
          v: tt, t: tt,
        });
      }
    }
    loft(m, rings, {
      radial: 7, cap: 'end',
      color: (_r, _i, _a, p) => col(p, 0.97),
      weights: () => single(fing),
    });
  }

  // Thumb: two segments on the inner-front of the hand, fixed to the hand bone.
  const th: Ring[] = [];
  const tz = 0.018 * hs * hk;
  let tx = x0 - sign * 0.008 * hs * hk;
  let ty = wy - 0.012 * hs;
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    tx += -sign * 0.0014 * hs;
    ty -= 0.0098 * hs;
    th.push({ c: [tx, ty, tz + 0.006 * hs * t], rx: lerp(0.0105, 0.0075, t) * hs * hk, rz: lerp(0.0105, 0.0075, t) * hs * hk, v: t, t });
  }
  loft(m, th, { radial: 7, cap: 'end', color: (_r, _i, _a, p) => col(p, 0.98), weights: () => single(hand) });
}

// ---------- ear ----------
function buildEar(f: Frame, m: MeshData, sign: number): void {
  const [rx, ry, rz] = f.headR;
  const cx = sign * (rx + 0.002 * f.hs);
  const cy = f.headCentre[1] - (f.clay ? 0.02 : 0.012) * f.hs;
  const cz = f.headCentre[2] - 0.006 * f.hs;
  const col = (p: V3): V3 => skinColor(f, p, 1.06);
  surface(
    m, 10, 8,
    (u, v) => {
      const th = u * Math.PI * 2;
      const ph = v * Math.PI;
      const dx = Math.sin(ph) * Math.cos(th);
      const dy = Math.cos(ph);
      const dz = Math.sin(ph) * Math.sin(th);
      const rim = 1 + 0.18 * gauss(dx, 0.2) * (dx > 0 ? 1 : 0);
      const ek = f.clay ? 1.25 : 1;
      return [cx + sign * dx * 0.0085 * f.hs * rim * ek, cy + dy * 0.031 * f.hs * ek, cz + dz * 0.0185 * f.hs * ek];
    },
    (_u, _v, p) => col(p),
    () => single(B.head),
    sign < 0,
  );
  void ry;
  void rz;
}

// ---------- shoes ----------
function buildShoe(f: Frame, m: MeshData, sign: number): void {
  const hs = f.hs;
  const color = lin(f.spec.shoes);
  const sole = mulc(lin(0xe8e4da), 0.8);
  const footBone = sign > 0 ? B.footL : B.footR;
  const shinBone = sign > 0 ? B.shinL : B.shinR;
  const cx = sign * f.lm.hipX * 0.9;
  const rings: Ring[] = [];
  const prof: ReadonlyArray<readonly [number, number, number]> = f.clay ? [
    [-0.085, 0.04, 0.04], [-0.072, 0.054, 0.062], [-0.045, 0.06, 0.068], [0, 0.064, 0.064],
    [0.05, 0.068, 0.056], [0.1, 0.07, 0.046], [0.15, 0.066, 0.036], [0.19, 0.052, 0.026], [0.212, 0.03, 0.016],
  ] : [
    // z, half width, half height (shoe sits on the ground, so centre y = half height)
    [-0.075, 0.026, 0.034], [-0.062, 0.034, 0.05], [-0.04, 0.038, 0.052], [0, 0.04, 0.05],
    [0.05, 0.043, 0.042], [0.1, 0.046, 0.032], [0.15, 0.042, 0.022], [0.185, 0.03, 0.016], [0.2, 0.014, 0.01],
  ];
  const n = prof.length;
  for (let i = 0; i < n; i++) {
    const [z, w, h] = prof[i] as readonly [number, number, number];
    const hh = h * hs * (f.clay ? 1.0 : 1.1);
    rings.push({ c: [cx, hh + 0.004 * hs, z * hs], rx: w * hs * f.bl, rz: hh, u: [1, 0, 0], w: [0, 1, 0], v: i / (n - 1), t: i / (n - 1) });
  }
  loft(m, rings, {
    radial: 14, cap: 'both', roundness: 2.4,
    color: (_r, _i, a, p) => {
      const base = fbm3(p[0] * 60, p[1] * 60, p[2] * 60, 9, 2);
      return Math.sin(a) < (f.clay ? -0.5 : -0.72) ? sole : mulc(color, 0.85 + 0.3 * base);
    },
    weights: (r) => (r.t < 0.12 ? two(shinBone, footBone, r.t / 0.12 * 0.5 + 0.5) : single(footBone)),
  });
}

// ---------- head and face ----------
function buildHead(f: Frame, m: MeshData, eyes: MeshData): void {
  const hs = f.hs;
  const [rx, ry, rz] = f.headR;
  const c = f.headCentre;
  const face = f.spec.face;
  const lipTone = mixc(f.skin, lin(f.female ? 0x7a2f3a : 0x5a2a2a), 0.5);
  const brow = lin(0x120c08);
  const eyeX = 0.036 * hs;
  const eyeY = c[1] + 0.13 * ry;

  const dirOf = (u: number, v: number): V3 => {
    const th = u * Math.PI * 2 + Math.PI / 2;
    const ph = v * Math.PI;
    return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
  };

  const displacement = (dir: V3): number => {
    const X = (dir[0] * rx) / rx;
    const Y = dir[1];
    const front = Math.max(0, dir[2]);
    const ax = Math.abs(X);
    const side = Math.sign(X) || 1;
    let d = 0;
    d += 0.009 * face.brow * hs * gauss(Y - 0.3, 0.09) * Math.max(0, 1 - ax * 1.1) * front;
    d += 0.0035 * hs * gauss(Y - 0.2, 0.18) * gauss(ax - 0.55, 0.25) * front;
    d += 0.0065 * hs * gauss(Y + 0.05, 0.14) * gauss(ax - 0.55, 0.14) * front;
    const nose = 0.0175 * face.nose * hs;
    d += nose * gauss(X, 0.075 * face.nose) * gauss(Y + 0.02, 0.26) * front * (0.5 + 0.5 * smoothstep(0.35, -0.2, Y));
    d += 0.0125 * face.nose * hs * gauss(X, 0.09 * face.nose) * gauss(Y + 0.2, 0.07) * front;
    d += 0.0065 * face.nose * hs * gauss(ax - 0.15 * face.nose, 0.055) * gauss(Y + 0.2, 0.06) * front;
    d -= 0.006 * hs * gauss(ax - 0.07, 0.04) * gauss(Y + 0.25, 0.04) * front;
    d += 0.012 * face.lips * hs * gauss(X, 0.2) * gauss(Y + 0.4, 0.04) * front;
    d += 0.014 * face.lips * hs * gauss(X, 0.18) * gauss(Y + 0.51, 0.045) * front;
    d -= 0.006 * hs * gauss(X, 0.22) * gauss(Y + 0.455, 0.012) * front;
    d += 0.012 * hs * gauss(X, 0.2) * gauss(Y + 0.83, 0.1) * front;
    d += 0.004 * hs * gauss(ax - 0.7, 0.14) * gauss(Y + 0.5, 0.18) * front;
    void side;
    return d;
  };

  const eyeDisp = (x: number, y: number, z: number): number => {
    if (z < 0) return 0;
    let d = 0;
    for (const s of [-1, 1]) {
      const dx = x - s * eyeX;
      const dy = y - eyeY;
      const r = Math.hypot(dx * 1.1, dy * 1.5);
      d -= 0.0095 * hs * gauss(r, 0.0105 * hs);
      d += 0.0042 * hs * gauss(r - 0.0155 * hs, 0.0045 * hs);
    }
    return d;
  };

  const point = (u: number, v: number): V3 => {
    const dir = dirOf(u, v);
    const Y = dir[1];
    // Jaw taper and slightly flattened back of head.
    const jaw = 1 - 0.24 * smoothstep(0.05, -0.9, Y) * (2 - face.jaw);
    const crown = 1 + 0.03 * smoothstep(0.2, 0.9, Y);
    let px = c[0] + dir[0] * rx * jaw;
    const py = c[1] + dir[1] * ry * (Y < 0 ? 1 - 0.08 * smoothstep(0, -1, Y) : crown);
    let pz = c[2] + dir[2] * rz * (dir[2] < 0 ? 0.96 : 1) * (1 - 0.1 * smoothstep(-0.3, -0.95, Y) * (dir[2] > 0 ? 1 : 0));
    const d = displacement(dir) + eyeDisp(px, py, dir[2]);
    px += dir[0] * d * 0.3;
    pz += d * Math.max(0.6, dir[2]);
    return [px, py, pz];
  };

  surface(
    m, 72, 56, point,
    (u, v, p) => {
      const dir = dirOf(u, v);
      const X = dir[0];
      const Y = dir[1];
      const front = dir[2] > 0.05;
      let col = skinColor(f, p, 1);
      if (front) {
        const lipW = gauss(X, 0.24) * (gauss(Y + 0.4, 0.05) + gauss(Y + 0.51, 0.055));
        col = mixc(col, lipTone, clamp(lipW * 1.1, 0, 0.9));
        const browW = gauss(Math.abs(X) - 0.32, 0.17) * gauss(Y - 0.33, 0.055);
        col = mixc(col, brow, clamp(browW * 1.4, 0, 0.9));
        col = mulc(col, 1 - 0.06 * gauss(Math.abs(X) - 0.3, 0.1) * gauss(Y - 0.0, 0.05));
        for (const sg of [-1, 1]) {
          const dd = Math.hypot((p[0] - sg * eyeX) * 1.1, (p[1] - eyeY) * 1.5) / hs;
          col = mulc(col, 1 - 0.18 * gauss(dd, 0.02));
          col = mixc(col, brow, 0.75 * gauss(dd - 0.0165, 0.0022));
        }
        col = mulc(col, 1 - 0.45 * gauss(Math.abs(X) - 0.08, 0.035) * gauss(Y + 0.25, 0.03));
      }
      return col;
    },
    () => single(B.head),
  );

  // Eyeballs: sclera, iris and pupil painted on the vertices of a sphere.
  const eyeColor = lin(face.eyeColor);
  for (const s of [-1, 1]) {
    const r = 0.0128 * hs;
    const cz = c[2] + rz * Math.sqrt(Math.max(0, 1 - (eyeX / rx) ** 2 - ((eyeY - c[1]) / ry) ** 2)) - 0.0118 * hs;
    surface(
      eyes, 24, 18,
      (u, v) => {
        const th = u * Math.PI * 2;
        const ph = v * Math.PI;
        return [s * eyeX + Math.sin(ph) * Math.cos(th) * r, eyeY + Math.cos(ph) * r, cz + Math.sin(ph) * Math.sin(th) * r];
      },
      (u, v) => {
        const th = u * Math.PI * 2;
        const ph = v * Math.PI;
        const nx = Math.sin(ph) * Math.cos(th);
        const ny = Math.cos(ph);
        const nz = Math.sin(ph) * Math.sin(th);
        const ang = Math.acos(clamp(nz, -1, 1));
        if (ang < 0.3) return lin(0x050403);
        if (ang < 0.62) {
          const ring = 0.8 + 0.4 * fbm3(nx * 14, ny * 14, nz * 14, 5, 2);
          return mulc(eyeColor, ring * (ang > 0.56 ? 0.7 : 1.0));
        }
        const vein = 0.94 + 0.06 * fbm3(nx * 9, ny * 9, nz * 9, 2, 2);
        return mulc(lin(0xf1ece4), vein * (1 - 0.1 * smoothstep(1.5, 2.2, ang)));
      },
      () => single(B.head),
    );
  }
  void pushVertex;
}


// ---------- clay head: big, round, friendly ----------
function buildHeadClay(f: Frame, m: MeshData, eyes: MeshData): void {
  const hs = f.hs;
  const [rx, ry, rz] = f.headR;
  const c = f.headCentre;
  const face = f.spec.face;
  const dark = lin(0x0b0807);
  const browCol = mulc(lin(f.spec.hairColor), 1.0);
  const mouthCol = lin(f.female ? 0x5e1f26 : 0x4a1c1c);
  const blush = mixc(f.skin, lin(0xd0504a), 0.45);

  const dirOf = (u: number, v: number): V3 => {
    const th = u * Math.PI * 2 + Math.PI / 2;
    const ph = v * Math.PI;
    return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
  };
  const point = (u: number, v: number): V3 => {
    const dir = dirOf(u, v);
    const Y = dir[1];
    const front = Math.max(0, dir[2]);
    const ax = Math.abs(dir[0]);
    // Round cheeks, soft chin.
    const cheek = 1 + 0.045 * gauss(Y + 0.3, 0.32);
    const chin = 1 - 0.1 * smoothstep(-0.25, -1, Y);
    let px = c[0] + dir[0] * rx * cheek * chin;
    const py = c[1] + dir[1] * ry * (Y < 0 ? 1 - 0.04 * smoothstep(0, -1, Y) : 1);
    let pz = c[2] + dir[2] * rz * (dir[2] < 0 ? 0.97 : 1) * chin;
    let d = 0;
    // Small soft nose, a hint of cheek roundness and a gentle brow.
    d += 0.0185 * face.nose * hs * gauss(dir[0], 0.11 * face.nose) * gauss(Y + 0.14, 0.14) * front;
    d += 0.006 * hs * gauss(ax - 0.5, 0.2) * gauss(Y + 0.28, 0.2) * front;
    d += 0.0035 * hs * gauss(Y - 0.28, 0.12) * Math.max(0, 1 - ax * 1.3) * front;
    // Shallow groove for the smile.
    d -= 0.0028 * hs * gauss(dir[0], 0.34) * gauss(Y + 0.5 - 0.07 * (dir[0] / 0.34) ** 2, 0.03) * front;
    px += dir[0] * d * 0.2;
    pz += d * Math.max(0.6, dir[2]);
    return [px, py, pz];
  };
  surface(
    m, 56, 40, point,
    (u, v, p) => {
      const dir = dirOf(u, v);
      let col = skinColor(f, p, 1);
      if (dir[2] > 0) {
        const cheeks = gauss(Math.abs(dir[0]) - 0.52, 0.17) * gauss(dir[1] + 0.3, 0.17);
        col = mixc(col, blush, clamp(0.55 * cheeks, 0, 0.5));
      }
      return col;
    },
    () => single(B.head),
  );

  // A point on the front of the head at (x, y), nudged out by `lift`.
  const onFace = (x: number, y: number, lift: number): V3 => {
    const nx = (x - c[0]) / rx;
    const ny = (y - c[1]) / ry;
    const zz = Math.sqrt(Math.max(0.04, 1 - nx * nx - ny * ny));
    const chin = 1 - 0.1 * smoothstep(-0.25, -1, ny);
    return [x, y, c[2] + rz * zz * chin + lift];
  };
  const head = (): Influence => single(B.head);

  // Eyes: glossy dark ovals with a bright highlight, the signature of the style.
  for (const s of [-1, 1]) {
    const ex = c[0] + s * f.eyeX;
    const ey = f.eyeY;
    const base = onFace(ex, ey, -0.004 * hs);
    const er: V3 = [0.155 * rx, 0.205 * ry, 0.055 * rz];
    surface(
      eyes, 20, 14,
      (u, v) => {
        const th = u * Math.PI * 2;
        const ph = v * Math.PI;
        return [base[0] + Math.sin(ph) * Math.cos(th) * er[0], base[1] + Math.cos(ph) * er[1], base[2] + Math.sin(ph) * Math.sin(th) * er[2]];
      },
      () => dark,
      head,
    );
    // Highlight.
    const hl = onFace(ex - s * 0.03 * rx, ey + 0.07 * ry, 0.013 * hs);
    addSphere(eyes, hl, [0.042 * rx, 0.05 * ry, 0.012 * rz], () => lin(0xffffff), head(), 8, 6);
  }

  // Eyebrows: short chunky arcs.
  for (const s of [-1, 1]) {
    const pts: Array<{ p: V3; r: number }> = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = c[0] + s * (f.eyeX + (t - 0.5) * 0.26 * rx);
      const y = f.eyeY + 0.3 * ry + 0.035 * ry * Math.sin(t * Math.PI) - 0.02 * ry * (s > 0 ? t : 1 - t) * 0;
      pts.push({ p: onFace(x, y, 0.004 * hs), r: 0.021 * ry * (0.6 + 0.4 * Math.sin(t * Math.PI)) });
    }
    tubeAlong(m, pts, { radial: 6, cap: 'both', up: [0, 0, 1], color: () => browCol, weights: head });
  }

  // Smile.
  const smile: Array<{ p: V3; r: number }> = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const x = c[0] + (t - 0.5) * 0.52 * rx;
    const k = (t - 0.5) / 0.5;
    const y = c[1] - 0.46 * ry + 0.065 * ry * k * k;
    smile.push({ p: onFace(x, y, 0.0015 * hs), r: 0.021 * ry * (0.7 + 0.3 * Math.cos(k * 1.4)) });
  }
  tubeAlong(m, smile, { radial: 6, cap: 'both', up: [0, 0, 1], color: () => mouthCol, weights: head });
}
