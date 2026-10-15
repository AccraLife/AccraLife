import { type V3, fbm3, gauss, seeded, smoothstep } from './math';

/**
 * Procedural fabric textures as raw RGBA bytes. Pure arrays so they can be previewed in Node
 * and turned into DataTextures in the browser. Every texture tiles seamlessly.
 */
export type FabricKind = 'plain' | 'wax' | 'kente' | 'stripe' | 'check' | 'denim' | 'canvas';

export interface Bitmap {
  size: number;
  rgba: Uint8Array;
}

const hex3 = (h: number): V3 => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mixv = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function brighten(c: V3, k: number): V3 {
  return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
}

/** Woven thread look: fine alternating over/under shading. Returns 0.85..1.1. */
function weave(x: number, y: number, period: number): number {
  const a = Math.sin((x / period) * Math.PI * 2);
  const b = Math.sin((y / period) * Math.PI * 2);
  return 1 + 0.05 * a * b + 0.025 * (a + b) * 0.5;
}

function palette(main: number, accent: number, seed: number): V3[] {
  const rng = seeded(seed);
  const m = hex3(main);
  const a = hex3(accent);
  const extra: V3[] = [
    [235, 190, 60], [200, 50, 40], [30, 120, 70], [25, 25, 30], [240, 235, 220], [30, 80, 150], [220, 110, 30],
  ];
  const pick = (): V3 => extra[Math.floor(rng() * extra.length)] as V3;
  return [m, a, pick(), pick(), [244, 240, 230]];
}

/** One tile of wax print: staggered rings with petals, dots and outlines. */
function waxPixel(x: number, y: number, size: number, pal: V3[], seed: number): V3 {
  const cell = size / 2;
  const row = Math.floor(y / cell);
  const ox = row % 2 === 0 ? 0 : cell / 2;
  const cx = (((x + ox) % cell) + cell) % cell - cell / 2;
  const cy = ((y % cell) + cell) % cell - cell / 2;
  const d = Math.hypot(cx, cy);
  const ang = Math.atan2(cy, cx);
  const petals = 6 + (seed % 3) * 2;
  const R = cell * 0.46;
  const bg = pal[0] as V3;
  let col = bg;
  if (d < R) {
    const petal = Math.abs(Math.sin(ang * petals * 0.5));
    if (d < R * 0.16) col = pal[2] as V3;
    else if (d < R * 0.26) col = pal[4] as V3;
    else if (d < R * 0.5 + petal * R * 0.18) col = pal[1] as V3;
    else if (d < R * 0.66 + petal * R * 0.12) col = pal[3] as V3;
    else if (d < R * 0.82) col = pal[4] as V3;
    else col = pal[2] as V3;
    // dark outlines between rings
    const edges = [0.16, 0.26, 0.82];
    for (const e of edges) if (Math.abs(d / R - e) < 0.018) col = [25, 20, 20];
  } else {
    // small dots in the gaps
    const dx = ((((x + ox) % (cell / 2)) + cell / 2) % (cell / 2)) - cell / 4;
    const dy = (((y % (cell / 2)) + cell / 2) % (cell / 2)) - cell / 4;
    const dd = Math.hypot(dx - cell / 4 * 0, dy);
    if (Math.hypot(cx, cy) > R * 1.15 && dd < cell * 0.05) col = pal[4] as V3;
  }
  return col;
}

function kentePixel(x: number, y: number, size: number, pal: V3[], seed: number): V3 {
  const bands = 8;
  const bh = size / bands;
  const b = Math.floor(y / bh);
  const lx = x % (size / 4);
  const ly = y % bh;
  const kind = (b + seed) % 4;
  const cols = [pal[0] as V3, pal[2] as V3, pal[3] as V3, pal[1] as V3];
  const c0 = cols[b % 4] as V3;
  const c1 = cols[(b + 1) % 4] as V3;
  const c2 = cols[(b + 2) % 4] as V3;
  const u = lx / (size / 4);
  const v = ly / bh;
  if (kind === 0) return c0;
  if (kind === 1) return (Math.floor(u * 4) + Math.floor(v * 2)) % 2 === 0 ? c0 : c1;
  if (kind === 2) return Math.abs(u - 0.5) + Math.abs(v - 0.5) < 0.45 ? c1 : c2;
  return Math.floor(u * 6) % 2 === 0 ? c2 : c0;
}

export function makeFabric(kind: FabricKind, main: number, accent: number, seed: number, size = 256): { color: Bitmap; normal: Bitmap } {
  const color = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  const pal = palette(main, accent, seed);
  const m = hex3(main);
  const a = hex3(accent);
  const period = size / 64;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c: V3;
      switch (kind) {
        case 'wax': c = waxPixel(x, y, size, pal, seed); break;
        case 'kente': c = kentePixel(x, y, size, pal, seed); break;
        case 'stripe': c = Math.floor(y / (size / 12)) % 3 === 0 ? a : m; break;
        case 'check': {
          const cx = Math.floor(x / (size / 8)) % 2;
          const cy = Math.floor(y / (size / 8)) % 2;
          c = cx && cy ? mixv(m, a, 0.65) : cx || cy ? mixv(m, a, 0.3) : m;
          break;
        }
        case 'denim': {
          const diag = ((x + y) / period) % 2 < 1 ? 1.05 : 0.93;
          c = brighten(m, diag * (0.92 + 0.16 * fbm3(x * 0.3, y * 0.3, 0, seed, 2)));
          break;
        }
        case 'canvas': c = brighten(m, 0.94 + 0.12 * fbm3(x * 0.5, y * 0.5, 0, seed, 2)); break;
        default: c = m;
      }
      const wv = weave(x, y, period);
      const speck = 0.96 + 0.08 * fbm3(x * 0.8, y * 0.8, 1, seed + 3, 2);
      const k = wv * speck;
      const i = (y * size + x) * 4;
      color[i] = Math.min(255, (c[0] as number) * k);
      color[i + 1] = Math.min(255, (c[1] as number) * k);
      color[i + 2] = Math.min(255, (c[2] as number) * k);
      color[i + 3] = 255;
      height[y * size + x] = wv + (kind === 'denim' ? (((x + y) / period) % 2 < 1 ? 0.06 : 0) : 0);
    }
  }
  // Normal map from the height of the weave.
  const normal = new Uint8Array(size * size * 4);
  const at = (x: number, y: number): number => height[((y + size) % size) * size + ((x + size) % size)] as number;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.5;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.5;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      normal[i] = (-dx / l * 0.5 + 0.5) * 255;
      normal[i + 1] = (-dy / l * 0.5 + 0.5) * 255;
      normal[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }
  void gauss;
  void smoothstep;
  return { color: { size, rgba: color }, normal: { size, rgba: normal } };
}

/** Seamless hair texture: grey multiplier (the vertex colour carries the hair colour) plus a normal map. */
export function makeHair(kind: 'straight' | 'curly', seed: number, size = 128): { color: Bitmap; normal: Bitmap } {
  const hash = (x: number, y: number): number => {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed + 1, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const wrap = (v: number, n: number): number => ((v % n) + n) % n;
  // Periodic value noise with cell counts (cx, cy).
  const vnoise = (x: number, y: number, cx: number, cy: number): number => {
    const fx = (x / size) * cx;
    const fy = (y / size) * cy;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = smoothstep(0, 1, fx - ix);
    const ty = smoothstep(0, 1, fy - iy);
    const g = (a: number, b: number): number => hash(wrap(a, cx), wrap(b, cy));
    const top = g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx;
    const bot = g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx;
    return top * (1 - ty) + bot * ty;
  };
  const height = new Float32Array(size * size);
  const color = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let h: number;
      if (kind === 'straight') {
        // Long strands: very fine across, stretched along y.
        h = 0.55 * vnoise(x, y, 48, 3) + 0.3 * vnoise(x, y, 96, 6) + 0.15 * hash(x, 0);
      } else {
        // Tight coils: a cloud of small bumps.
        const a = vnoise(x, y, 28, 28);
        const b = vnoise(x, y, 56, 56);
        h = 0.6 * Math.abs(a - 0.5) * 2 + 0.4 * b;
      }
      height[y * size + x] = h;
      const v = Math.max(0, Math.min(255, 150 + (h - 0.5) * (kind === 'curly' ? 220 : 160)));
      const i = (y * size + x) * 4;
      color[i] = v;
      color[i + 1] = v;
      color[i + 2] = v;
      color[i + 3] = 255;
    }
  }
  const normal = new Uint8Array(size * size * 4);
  const at = (x: number, y: number): number => height[wrap(y, size) * size + wrap(x, size)] as number;
  const strength = kind === 'curly' ? 3.2 : 2.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      normal[i] = (-dx / l * 0.5 + 0.5) * 255;
      normal[i + 1] = (-dy / l * 0.5 + 0.5) * 255;
      normal[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }
  return { color: { size, rgba: color }, normal: { size, rgba: normal } };
}
