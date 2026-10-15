/** Small vector, matrix and curve helpers. Pure, no three.js, so the sculpting code can run in Node for previews and tests. */
export type V3 = [number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const smooth = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
/** Smoothly 0 below a, 1 above b. */
export const smoothstep = (a: number, b: number, v: number): number => smooth((v - a) / (b - a || 1));
export const gauss = (d: number, sigma: number): number => Math.exp(-(d * d) / (2 * sigma * sigma));

/** Sign-preserving power, for superellipse cross sections. */
export const spow = (v: number, p: number): number => Math.sign(v) * Math.abs(v) ** p;

/** Catmull-Rom through scalar keys (t ascending). Clamps outside the range. */
export function spline(keys: ReadonlyArray<readonly [number, number]>, t: number): number {
  const n = keys.length;
  if (t <= (keys[0] as readonly [number, number])[0]) return (keys[0] as readonly [number, number])[1];
  if (t >= (keys[n - 1] as readonly [number, number])[0]) return (keys[n - 1] as readonly [number, number])[1];
  let i = 0;
  while (i < n - 2 && t > (keys[i + 1] as readonly [number, number])[0]) i++;
  const k0 = keys[Math.max(0, i - 1)] as readonly [number, number];
  const k1 = keys[i] as readonly [number, number];
  const k2 = keys[i + 1] as readonly [number, number];
  const k3 = keys[Math.min(n - 1, i + 2)] as readonly [number, number];
  const u = (t - k1[0]) / (k2[0] - k1[0]);
  const m1 = ((k2[1] - k0[1]) / (k2[0] - k0[0])) * (k2[0] - k1[0]);
  const m2 = ((k3[1] - k1[1]) / (k3[0] - k1[0])) * (k2[0] - k1[0]);
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * k1[1] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * k2[1] + (u3 - u2) * m2;
}

// ---------- noise ----------
function hash(ix: number, iy: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 3D, range 0..1. */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const fz = smooth(z - iz);
  let acc = 0;
  for (let dx = 0; dx < 2; dx++)
    for (let dy = 0; dy < 2; dy++)
      for (let dz = 0; dz < 2; dz++) {
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
        acc += w * hash(ix + dx, iy + dy, iz + dz, seed);
      }
  return acc;
}

export function fbm3(x: number, y: number, z: number, seed = 0, octaves = 3): number {
  let amp = 0.5;
  let f = 1;
  let sum = 0;
  let norm_ = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x * f, y * f, z * f, seed + o * 17);
    norm_ += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm_;
}

// ---------- 4x4 matrices (column-major, like three.js) ----------
export type M4 = number[];
export const identity = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mul(a: M4, b: M4): M4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
      out[c * 4 + r] = s;
    }
  return out;
}

/** Translation and Euler XYZ rotation (same convention as three.js: R = Rx * Ry * Rz). */
export function compose(t: V3, e: V3): M4 {
  const [x, y, z] = e;
  const a = Math.cos(x), b = Math.sin(x);
  const c = Math.cos(y), d = Math.sin(y);
  const f = Math.cos(z), g = Math.sin(z);
  const ae = a * f, af = a * g, be = b * f, bf = b * g;
  return [
    c * f, af + be * d, bf - ae * d, 0,
    -c * g, ae - bf * d, be + af * d, 0,
    d, -b * c, a * c, 0,
    t[0], t[1], t[2], 1,
  ];
}

export function invertRigid(m: M4): M4 {
  // Rotation + translation only (no scale): transpose the rotation, rotate the translation back.
  const r = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]] as number[];
  const t: V3 = [m[12] as number, m[13] as number, m[14] as number];
  const nt: V3 = [
    -((r[0] as number) * t[0] + (r[3] as number) * t[1] + (r[6] as number) * t[2]),
    -((r[1] as number) * t[0] + (r[4] as number) * t[1] + (r[7] as number) * t[2]),
    -((r[2] as number) * t[0] + (r[5] as number) * t[1] + (r[8] as number) * t[2]),
  ];
  return [
    r[0] as number, r[1] as number, r[2] as number, 0,
    r[3] as number, r[4] as number, r[5] as number, 0,
    r[6] as number, r[7] as number, r[8] as number, 0,
    nt[0], nt[1], nt[2], 1,
  ];
}

export function transformPoint(m: M4, p: V3): V3 {
  return [
    (m[0] as number) * p[0] + (m[4] as number) * p[1] + (m[8] as number) * p[2] + (m[12] as number),
    (m[1] as number) * p[0] + (m[5] as number) * p[1] + (m[9] as number) * p[2] + (m[13] as number),
    (m[2] as number) * p[0] + (m[6] as number) * p[1] + (m[10] as number) * p[2] + (m[14] as number),
  ];
}

export function transformDir(m: M4, p: V3): V3 {
  return [
    (m[0] as number) * p[0] + (m[4] as number) * p[1] + (m[8] as number) * p[2],
    (m[1] as number) * p[0] + (m[5] as number) * p[1] + (m[9] as number) * p[2],
    (m[2] as number) * p[0] + (m[6] as number) * p[1] + (m[10] as number) * p[2],
  ];
}

/** Seeded random for generators (mulberry32). */
export function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
