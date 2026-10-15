import type { Dims, PersonSpec } from '../spec';
import { type Frame, lin, makeFrame, mixc, mulc } from './body';
import {
  type Influence, type MeshData, type Ring, addBox, chainWeights, loft, newMesh, single, surface, tubeAlong,
} from './mesh';
import { type V3, clamp, fbm3, gauss, lerp, norm, seeded, smoothstep } from './math';
import { B } from './skeleton';

export interface HairParts {
  /** Hair itself. */
  hair: MeshData;
  /** Head wraps and scarves: patterned fabric, same material as the main garment. */
  wrap: MeshData;
  /** Caps, glasses, baskets, straps: flat or textured accessories. */
  gear: MeshData;
  /** Flat dark colour for glasses lenses and similar. */
  glass: MeshData;
}

const head = (): Influence => single(B.head);
let CLAY_HAIR = false;

/** Where the hair stops, as the height (-1..1 in head space) of the lowest covered point at an angle. */
function hairlineY(dirX: number, dirZ: number): number {
  const front = Math.max(0, dirZ);
  const back = Math.max(0, -dirZ);
  const side = Math.abs(dirX);
  // Forehead hairline high at the front, ears keep it up at the sides, nape low at the back.
  return lerp(lerp(0.12, 0.55, front), -0.3, back) - 0 * side + (side > 0.75 ? 0.08 * (side - 0.75) * 4 : 0);
}

/** A hair-like colour: strand streaks along the surface, darker toward the roots. */
function hairColor(base: V3, p: V3, seed: number, streak = 1): V3 {
  // Clay hair is a smooth sculpted shape: barely any streaking.
  if (CLAY_HAIR) streak *= 0.25;
  const n = fbm3(p[0] * 220, p[1] * 40, p[2] * 220, seed, 2);
  const m = 0.8 + 0.4 * n * streak;
  return mulc(base, clamp(m, 0.55, 1.35));
}

export function buildHair(spec: PersonSpec, d: Dims): HairParts {
  const f = makeFrame(spec, d);
  CLAY_HAIR = f.clay;
  const out: HairParts = { hair: newMesh(), wrap: newMesh(), gear: newMesh(), glass: newMesh() };
  const base = lin(spec.hairColor);
  const seed = spec.seed % 977;
  switch (spec.hair) {
    case 'lowcut': cap(f, out.hair, base, seed, 0.0035, 1.0); break;
    case 'afro': afro(f, out.hair, base, seed); break;
    case 'cornrows': cornrows(f, out.hair, base, seed); break;
    case 'braids': braids(f, out.hair, base, seed); break;
    case 'wrap': headWrap(f, out.wrap, out.hair, base, seed); break;
    case 'scarf': scarf(f, out.wrap, out.hair, base, seed); break;
    default: break;
  }
  accessories(f, out, base, seed);
  return out;
}

/** The head shape the hair sits on: an ellipsoid a little bigger than the skull, with a hairline. */
function cap(f: Frame, m: MeshData, base: V3, seed: number, thick0: number, bulk: number, bumpy = 0): void {
  const hs = f.hs;
  const thick = thick0 * (f.clay ? 3.4 : 1);
  const [rx, ry, rz] = f.headR;
  const c = f.headCentre;
  const point = (u: number, v: number): V3 => {
    const th = u * Math.PI * 2 + Math.PI / 2;
    const sx = Math.cos(th);
    const sz = Math.sin(th);
    const lineY = hairlineY(sx, sz);
    // v = 0 at the crown, 1 at the hairline.
    const phiMax = Math.acos(clamp(lineY, -1, 1));
    const ph = v * phiMax;
    const dir: V3 = [Math.sin(ph) * sx, Math.cos(ph), Math.sin(ph) * sz];
    const edge = smoothstep(0.78, 1, v);
    // Lowered thickness at the edge so the hairline sits on the skin.
    const grow = thick * hs * (1 - 0.55 * edge) + (bulk - 1) * 0.01 * hs * (1 - edge);
    const bump = bumpy * hs * (fbm3(dir[0] * 9, dir[1] * 9, dir[2] * 9, seed, 3) - 0.4);
    const jaw = 1 - 0.1 * smoothstep(0.1, -0.6, dir[1]);
    return [
      c[0] + dir[0] * (rx * jaw + grow + bump),
      c[1] + dir[1] * (ry * (dir[1] > 0 ? 1.03 : 1) + grow + bump),
      c[2] + dir[2] * ((dir[2] < 0 ? 0.96 : 1) * rz + grow + bump),
    ];
  };
  surface(m, 56, 28, point, (_u, v, p) => mixc(hairColor(base, p, seed), mulc(f.skin, 0.55), f.clay ? 0 : (thick0 < 0.005 ? 0.75 : 0.35) * smoothstep(0.7, 1, v)), () => head(), true);
}

function afro(f: Frame, m: MeshData, base: V3, seed: number): void {
  const hs = f.hs;
  const [rx, ry, rz] = f.headR;
  const c = f.headCentre;
  const big = (f.clay ? 0.1 : 0.08) * hs;
  const point = (u: number, v: number): V3 => {
    const th = u * Math.PI * 2 + Math.PI / 2;
    const sx = Math.cos(th);
    const sz = Math.sin(th);
    const lineY = hairlineY(sx, sz) - 0.05;
    const phiMax = Math.acos(clamp(lineY, -1, 1));
    const ph = v * phiMax;
    const dir: V3 = [Math.sin(ph) * sx, Math.cos(ph), Math.sin(ph) * sz];
    const edge = smoothstep(0.75, 1, v);
    const curl = 0.012 * hs * (fbm3(dir[0] * 16, dir[1] * 16, dir[2] * 16, seed, 3) - 0.4);
    const grow = big * (1 - 0.8 * edge) + curl;
    return [c[0] + dir[0] * (rx + grow), c[1] + dir[1] * (ry + grow * 0.95) + 0.006 * hs, c[2] + dir[2] * (rz + grow * 0.95)];
  };
  surface(m, 64, 30, point, (_u, _v, p) => hairColor(base, p, seed, 1.6), () => head(), true);
}

function cornrows(f: Frame, m: MeshData, base: V3, seed: number): void {
  const hs = f.hs;
  cap(f, m, mulc(base, 0.9), seed, 0.0025, 1);
  const [rx, ry, rz] = f.headR;
  const c = f.headCentre;
  const lines = 9;
  for (let k = 0; k < lines; k++) {
    const x0 = (k / (lines - 1) - 0.5) * 1.5;
    const pts = [];
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const th = lerp(0.62 + 0.5 * Math.abs(x0) * 0.4, 2.95, i / n);
      const dir = norm([x0 * (1 + 0.15 * Math.sin(i * 0.8)), Math.sin(th), Math.cos(th)]);
      // Rows curve slightly toward the middle at the back.
      pts.push({
        p: [c[0] + dir[0] * (rx + 0.003 * hs), c[1] + dir[1] * (ry * 1.03 + 0.003 * hs), c[2] + dir[2] * (rz + 0.003 * hs)] as V3,
        r: 0.0042 * hs * (f.clay ? 1.6 : 1) * (1 - 0.4 * smoothstep(0.7, 1, i / n)),
      });
    }
    tubeAlong(m, pts, {
      radial: 6, cap: 'end',
      color: (i, p) => mulc(mixc(base, [0.02, 0.016, 0.014], 0.2), (i % 2 ? 0.8 : 1.1) * (0.9 + 0.2 * fbm3(p[0] * 90, p[1] * 90, p[2] * 90, seed, 1))),
      weights: () => head(),
    });
  }
}

function braids(f: Frame, m: MeshData, base: V3, seed: number): void {
  const hs = f.hs;
  const rng = seeded(seed + 17);
  cap(f, m, mulc(base, 0.9), seed, 0.004, 1.2);
  const [rx, ry, rz] = f.headR;
  const c = f.headCentre;
  const count = 13;
  const length = (f.female ? 0.2 : 0.12) * hs;
  for (let k = 0; k < count; k++) {
    const a = lerp(-0.95, 0.95, k / (count - 1)) + (rng() - 0.5) * 0.06;
    // Roots around the back and sides of the head at the hairline.
    const rootY = lerp(0.12, -0.2, Math.abs(Math.sin(a * 1.2)) * 0.7 + rng() * 0.15);
    const ring = Math.sqrt(1 - rootY * rootY);
    const rootDir: V3 = [Math.sin(a) * ring, rootY, -Math.cos(a) * ring];
    const root: V3 = [c[0] + rootDir[0] * (rx * 0.98), c[1] + rootDir[1] * ry, c[2] + rootDir[2] * rz];
    const pts = [];
    const n = 16;
    const lenK = length * (0.8 + 0.4 * rng());
    const nape = f.lm.headBaseY - 0.03 * hs;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const y = lerp(root[1], Math.max(f.lm.neckBaseY + 0.01 * hs, root[1] - lenK - 0.06 * hs), t);
      // Hang down and stay outside the neck and upper back.
      const backZ = -(0.07 + 0.03 * smoothstep(0, 1, t)) * hs - 0.02 * hs * Math.abs(Math.sin(a));
      const z = lerp(root[2], Math.min(root[2], backZ), smoothstep(0, 0.35, t));
      const x = lerp(root[0], root[0] * 0.9 + Math.sin(a) * 0.012 * hs, t);
      void nape;
      pts.push({ p: [x, y, z] as V3, r: 0.0078 * hs * (f.clay ? 1.4 : 1) * (1 - 0.3 * t) * (1 + 0.14 * Math.sin(i * 2.1)), r2: 0.0078 * hs * (f.clay ? 1.4 : 1) * (1 - 0.3 * t) });
    }
    const ys = f.lm.neckBaseY;
    tubeAlong(m, pts, {
      radial: 8, cap: 'both', up: [1, 0, 0],
      color: (i, p) => mulc(base, (i % 2 ? 0.75 : 1.1) * (0.9 + 0.2 * fbm3(p[0] * 90, p[1] * 90, p[2] * 90, seed, 1))),
      weights: (_i, p) => chainWeights([{ bone: B.head, start: -9 }, { bone: B.neck, start: f.lm.headBaseY - 0.01 }, { bone: B.chest, start: ys - 0.02 }], p[1], 0.05 * hs),
    });
  }
}

/** Gele: a big folded wrap standing above the head. */
function headWrap(f: Frame, wrap: MeshData, hair: MeshData, base: V3, seed: number): void {
  const hs = f.hs;
  const [rx, ry, rz] = f.headR;
  const c = f.headCentre;
  // A little hair at the front under the cloth (clay: the cloth covers it all).
  if (!f.clay) cap(f, hair, base, seed, 0.003, 1);
  const rings: Ring[] = [];
  const n = 26;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = c[1] + ry * lerp(0.12, 1.25, t);
    const dome = Math.sqrt(Math.max(0, 1 - ((y - c[1]) / (ry * 1.6)) ** 2));
    const swell = 1 + (f.clay ? 0.2 : 0.32) * gauss(t - 0.62, 0.3) + 0.08 * Math.sin(t * 17);
    rings.push({
      c: [c[0], y, c[2] - 0.004 * hs],
      rx: rx * (1.05 + 0.1) * dome * swell,
      rz: rz * (1.08 + 0.1) * dome * swell,
      v: t * 2.4, t,
    });
  }
  loft(wrap, rings, {
    radial: 40, roundness: 2.1, cap: 'end', uScale: 3,
    color: (_r, _i, _a, p) => mulc([1, 1, 1], 0.92 + 0.14 * fbm3(p[0] * 40, p[1] * 40, p[2] * 40, seed, 2)),
    weights: () => head(),
    displace: (p, r, _i, a) => {
      // Diagonal folds and a gathered knot at the front-right.
      const fold = Math.sin(a * 4 + r.t * 12 + fbm3(p[0] * 20, p[1] * 20, 0, seed, 2) * 3);
      const knot = gauss(a - Math.PI * 0.35, 0.45) * gauss(r.t - 0.5, 0.25) * 0.02 * hs;
      return 0.0045 * hs * fold + knot;
    },
  });
}

/** Headscarf: hugs the skull, tied behind with a knot and two tails. */
function scarf(f: Frame, wrap: MeshData, hair: MeshData, base: V3, seed: number): void {
  const hs = f.hs;
  const [rx, ry, rz] = f.headR;
  const c = f.headCentre;
  const th = 0.0045 * hs;
  const point = (u: number, v: number): V3 => {
    const t = u * Math.PI * 2 + Math.PI / 2;
    const sx = Math.cos(t);
    const sz = Math.sin(t);
    const lineY = lerp(0.52, -0.38, Math.max(0, -sz)) * 1 + (sz > 0 ? 0 : 0);
    const edgeY = sz > 0 ? 0.5 + 0.02 * Math.abs(sx) : lineY;
    const ph = v * Math.acos(clamp(edgeY, -1, 1));
    const dir: V3 = [Math.sin(ph) * sx, Math.cos(ph), Math.sin(ph) * sz];
    const fold = 0.0035 * hs * Math.sin(Math.atan2(sx, sz) * 9 + v * 6 + fbm3(dir[0] * 6, dir[1] * 6, dir[2] * 6, seed, 2) * 4) * smoothstep(0.2, 1, v);
    return [c[0] + dir[0] * (rx + th + fold), c[1] + dir[1] * (ry * 1.03 + th + fold), c[2] + dir[2] * (rz + th + fold)];
  };
  surface(wrap, 56, 22, point, (_u, _v, p) => mulc([1, 1, 1], 0.92 + 0.14 * fbm3(p[0] * 40, p[1] * 40, p[2] * 40, seed, 2)), () => head(), true);
  // Knot and tails behind.
  const kx = c[0];
  const ky = c[1] - ry * 0.3;
  const kz = c[2] - rz - 0.012 * hs;
  const tailPts = (s: number): { p: V3; r: number }[] => {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push({ p: [kx + s * 0.02 * hs * t, ky - 0.1 * hs * t, kz - 0.015 * hs * t] as V3, r: 0.011 * hs * (1 - 0.6 * t) });
    }
    return pts;
  };
  for (const s of [-1, 1]) {
    tubeAlong(wrap, tailPts(s), {
      radial: 8, cap: 'end',
      color: () => [0.95, 0.95, 0.95], weights: (_i, p) => chainWeights([{ bone: B.head, start: -9 }, { bone: B.neck, start: f.lm.headBaseY }], p[1], 0.03 * hs),
    });
  }
  tubeAlong(wrap, [{ p: [kx - 0.012 * hs, ky, kz], r: 0.015 * hs }, { p: [kx + 0.012 * hs, ky, kz], r: 0.015 * hs }], { radial: 8, cap: 'both', color: () => [1, 1, 1], weights: () => head() });
  if (!f.clay) cap(f, hair, base, seed, 0.001, 1);
}

function accessories(f: Frame, out: HairParts, base: V3, seed: number): void {
  const hs = f.hs;
  const [rx, ry, rz] = f.headR;
  const c = f.headCentre;
  const acc = f.spec.accessory;
  const accent = lin(f.spec.accent);
  if (acc === 'cap') {
    const point = (u: number, v: number): V3 => {
      const t = u * Math.PI * 2 + Math.PI / 2;
      const sx = Math.cos(t);
      const sz = Math.sin(t);
      const ph = v * Math.acos(0.22);
      const dir: V3 = [Math.sin(ph) * sx, Math.cos(ph), Math.sin(ph) * sz];
      const g = (f.clay ? 0.022 : 0.011) * hs;
      return [c[0] + dir[0] * (rx + g), c[1] + dir[1] * (ry + g) + 0.004 * hs, c[2] + dir[2] * (rz + g)];
    };
    surface(out.gear, 48, 18, point, (_u, v, p) => mulc(accent, 0.9 + 0.2 * fbm3(p[0] * 60, p[1] * 60, p[2] * 60, seed, 2) - 0.06 * v), () => head(), true);
    // Brim and button.
    const rings: Ring[] = [];
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      rings.push({
        c: [c[0], c[1] + ry * 0.22 + 0.004 * hs - t * 0.004 * hs, c[2] + rz * 0.95 + t * 0.07 * hs],
        rx: rx * 0.98 * (1 - 0.1 * t), rz: 0.004 * hs, u: [1, 0, 0], w: [0, 1, 0], v: t, t,
      });
    }
    addBox(out.gear, [c[0], c[1] + ry * 1.04 + 0.014 * hs, c[2]], 0.004 * hs, 0.003 * hs, 0.004 * hs, mulc(accent, 0.8), head());
    const brim: V3[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = lerp(-1.3, 1.3, i / 10);
      brim.push([c[0] + Math.sin(a) * (rx + 0.01 * hs) * 1.0, c[1] + ry * 0.2, c[2] + Math.cos(a) * (rz + 0.012 * hs) + (f.clay ? 0.075 : 0.04) * hs * Math.cos(a) ** 2] as V3);
    }
    tubeAlong(out.gear, brim.map((p) => ({ p, r: (f.clay ? 0.02 : 0.008) * hs, r2: (f.clay ? 0.005 : 0.0022) * hs })), {
      radial: 8, cap: 'both', up: [0, 1, 0],
      color: () => mulc(accent, 0.75), weights: () => head(),
    });
    void rings;
  }
  if (acc === 'glasses') {
    const eyeY = f.eyeY;
    for (const s of [-1, 1]) {
      const cx = s * f.eyeX;
      const z = f.clay ? c[2] + rz * Math.sqrt(Math.max(0.04, 1 - (cx / rx) ** 2 - ((eyeY - c[1]) / ry) ** 2)) : c[2] + rz * 0.93;
      const ring: { p: V3; r: number }[] = [];
      const rad = f.clay ? rx * 0.17 : 0.0165 * hs;
      for (let i = 0; i <= 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        ring.push({ p: [cx + Math.cos(a) * rad * 1.1, eyeY + Math.sin(a) * rad * 0.85, z + 0.012 * hs] as V3, r: 0.0017 * hs });
      }
      tubeAlong(out.gear, f.clay ? ring.map((q) => ({ p: q.p, r: q.r * 1.7 })) : ring, { radial: 6, cap: 'none', color: () => [0.02, 0.02, 0.025], weights: () => head() });
      // Lens: a thin dark disc.
      const lens: Ring = { c: [cx, eyeY, z + 0.0122 * hs], rx: rad * 1.05, rz: rad * 0.82, u: [1, 0, 0], w: [0, 1, 0], v: 0, t: 0 };
      if (!f.clay) loft(out.glass, [lens, { ...lens, c: [cx, eyeY, z + 0.0127 * hs], v: 1, t: 1 }], {
        radial: 18, cap: 'both', color: () => [0.03, 0.04, 0.05], weights: () => head(),
      });
      // Arm back to the ear.
      tubeAlong(out.gear, [{ p: [s * (rx * 0.97), eyeY + 0.003 * hs, z + 0.008 * hs] as V3, r: 0.0015 * hs }, { p: [s * rx * 1.02, eyeY + 0.003 * hs, c[2]] as V3, r: 0.0015 * hs }], { radial: 5, cap: 'end', color: () => [0.02, 0.02, 0.025], weights: () => head() });
    }
    {
      const bx = f.clay ? f.eyeX - rx * 0.17 * 1.05 : 0.0195 * hs;
      const zb = (f.clay ? c[2] + rz * Math.sqrt(Math.max(0.04, 1 - (bx / rx) ** 2 - ((eyeY - c[1]) / ry) ** 2)) : c[2] + rz * 0.93) + 0.013 * hs;
      tubeAlong(out.gear, [{ p: [-bx, eyeY + 0.006 * hs, zb] as V3, r: 0.0014 * hs }, { p: [0, eyeY + 0.011 * hs, zb + 0.002 * hs] as V3, r: 0.0014 * hs }, { p: [bx, eyeY + 0.006 * hs, zb] as V3, r: 0.0014 * hs }], { radial: 5, cap: 'end', color: () => [0.02, 0.02, 0.025], weights: () => head() });
    }
  }
  if (acc === 'headLoad') {
    // A woven basket bowl on a cloth pad, balanced on the head.
    const rings: Ring[] = [];
    const topY = c[1] + ry * 1.0;
    const n = 14;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const r = lerp(0.11, 0.2, Math.sin(t * Math.PI * 0.5)) * hs;
      rings.push({ c: [c[0], topY + 0.02 * hs + t * 0.1 * hs, c[2]], rx: r, rz: r, v: t * 2, t });
    }
    loft(out.gear, rings, {
      radial: 36, cap: 'start', uScale: 6,
      color: (_r, i, a) => {
        const weave = (Math.floor(a * 6) + i) % 2 === 0 ? 1 : 0.8;
        return mulc(lin(0xb6853d), weave * (0.9 + 0.2 * fbm3(a * 3, i, 0, seed, 1)));
      },
      weights: () => head(),
      displace: (_p, _r, i, a) => 0.0035 * hs * Math.sin(a * 24) * Math.sin(i * 1.7),
    });
    const rim: V3[] = [];
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      rim.push([c[0] + Math.cos(a) * 0.2 * hs, topY + 0.122 * hs, c[2] + Math.sin(a) * 0.2 * hs] as V3);
    }
    tubeAlong(out.gear, rim.map((p) => ({ p, r: 0.007 * hs })), { radial: 8, cap: 'none', color: () => lin(0x8a5f28), weights: () => head() });
    // Cloth pad (kookɔ) under it.
    const pad: Ring[] = [];
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      pad.push({ c: [c[0], topY + t * 0.02 * hs, c[2]], rx: 0.075 * hs * (1 - 0.15 * t), rz: 0.075 * hs * (1 - 0.15 * t), v: t, t });
    }
    loft(out.gear, pad, { radial: 20, cap: 'both', color: () => mulc(accent, 0.9), weights: () => head() });
    // Goods piled in the basket.
    const goods = [0xd9482b, 0xe6a817, 0x4a8a3a, 0xd9482b, 0xe6a817];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const rr = i === 8 ? 0 : 0.08 * hs;
      const g = lin(goods[i % goods.length] as number);
      const cc: V3 = [c[0] + Math.cos(a) * rr, topY + 0.125 * hs + (i === 8 ? 0.03 * hs : 0), c[2] + Math.sin(a) * rr];
      addBox(out.gear, cc, 0.032 * hs, 0.028 * hs, 0.032 * hs, g, head());
    }
  }
  void base;
}
