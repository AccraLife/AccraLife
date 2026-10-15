import { type V3, clamp, cross, norm, smoothstep, spow, sub, len } from './math';

/**
 * Mesh data in plain arrays, plus the builders that generate it. Every vertex carries four bone
 * influences, so the same data drives a SkinnedMesh in three.js and the software preview.
 */
export interface MeshData {
  pos: number[];
  nrm: number[];
  uv: number[];
  col: number[];
  idx: number[];
  bi: number[];
  bw: number[];
}

export const newMesh = (): MeshData => ({ pos: [], nrm: [], uv: [], col: [], idx: [], bi: [], bw: [] });
export const vertexCount = (m: MeshData): number => m.pos.length / 3;

export type Influence = { b: [number, number, number, number]; w: [number, number, number, number] };

export function single(bone: number): Influence {
  return { b: [bone, 0, 0, 0], w: [1, 0, 0, 0] };
}

/** Blend between two bones: t = 0 is all `a`, t = 1 is all `b`. */
export function two(a: number, b: number, t: number): Influence {
  const k = clamp(t, 0, 1);
  if (k <= 0.001) return single(a);
  if (k >= 0.999) return single(b);
  return { b: [a, b, 0, 0], w: [1 - k, k, 0, 0] };
}

/**
 * Weights for a point at coordinate `s` along a chain of bones. `chain[i].start` is where bone i takes over,
 * and the hand-over is smoothed over `width` either side of each boundary.
 */
export function chainWeights(chain: ReadonlyArray<{ bone: number; start: number }>, s: number, width: number): Influence {
  for (let i = 1; i < chain.length; i++) {
    const at = (chain[i] as { start: number }).start;
    if (s < at + width) {
      const t = smoothstep(at - width, at + width, s);
      return two((chain[i - 1] as { bone: number }).bone, (chain[i] as { bone: number }).bone, t);
    }
  }
  return single((chain[chain.length - 1] as { bone: number }).bone);
}

export function pushVertex(m: MeshData, p: V3, n: V3, uv: [number, number], col: V3, inf: Influence): number {
  const i = m.pos.length / 3;
  m.pos.push(p[0], p[1], p[2]);
  m.nrm.push(n[0], n[1], n[2]);
  m.uv.push(uv[0], uv[1]);
  m.col.push(col[0], col[1], col[2]);
  m.bi.push(inf.b[0], inf.b[1], inf.b[2], inf.b[3]);
  m.bw.push(inf.w[0], inf.w[1], inf.w[2], inf.w[3]);
  return i;
}

export function mergeInto(target: MeshData, src: MeshData): void {
  const base = target.pos.length / 3;
  for (const k of ['pos', 'nrm', 'uv', 'col', 'bi', 'bw'] as const) for (const v of src[k]) target[k].push(v);
  for (const i of src.idx) target.idx.push(i + base);
}

export interface Ring {
  c: V3;
  rx: number;
  rz: number;
  /** Basis vectors of the ring plane. Default: u = +x, w = +z (rings are horizontal). */
  u?: V3;
  w?: V3;
  /** Texture coordinate along the loft, 0..1. */
  v: number;
  /** Free-form tag passed to callbacks (for example a height fraction). */
  t: number;
}

export interface LoftOptions {
  radial: number;
  /** Superellipse exponent: 2 is an ellipse, higher is squarer. */
  roundness?: number;
  color: (ring: Ring, ringIndex: number, angle: number, p: V3) => V3;
  weights: (ring: Ring, ringIndex: number, angle: number, p: V3) => Influence;
  /** Push the surface along its outward direction by this many metres. */
  displace?: (p: V3, ring: Ring, ringIndex: number, angle: number) => number;
  /** Move a point after displacement (for bust, belly shape). */
  shape?: (p: V3, ring: Ring, ringIndex: number, angle: number) => V3;
  cap?: 'none' | 'start' | 'end' | 'both';
  uScale?: number;
  /** Flip winding (for inner surfaces). */
  flip?: boolean;
}

/** Skin a tube through a list of rings. Normals come from the grid, so they are smooth with no seam. */
export function loft(m: MeshData, rings: readonly Ring[], o: LoftOptions): void {
  const R = rings.length;
  const S = o.radial;
  const round = o.roundness ?? 2;
  const grid: V3[][] = [];
  const outward: V3[][] = [];
  for (let r = 0; r < R; r++) {
    const ring = rings[r] as Ring;
    const u = ring.u ?? [1, 0, 0];
    const w = ring.w ?? [0, 0, 1];
    const row: V3[] = [];
    const out: V3[] = [];
    for (let s = 0; s < S; s++) {
      const a = (s / S) * Math.PI * 2;
      const cx = spow(Math.cos(a), 2 / round);
      const cz = spow(Math.sin(a), 2 / round);
      let p: V3 = [
        ring.c[0] + u[0] * cx * ring.rx + w[0] * cz * ring.rz,
        ring.c[1] + u[1] * cx * ring.rx + w[1] * cz * ring.rz,
        ring.c[2] + u[2] * cx * ring.rx + w[2] * cz * ring.rz,
      ];
      const dir = norm([u[0] * cx * ring.rz + w[0] * cz * ring.rx, u[1] * cx * ring.rz + w[1] * cz * ring.rx, u[2] * cx * ring.rz + w[2] * cz * ring.rx]);
      if (o.displace) {
        const d = o.displace(p, ring, r, a);
        p = [p[0] + dir[0] * d, p[1] + dir[1] * d, p[2] + dir[2] * d];
      }
      if (o.shape) p = o.shape(p, ring, r, a);
      row.push(p);
      out.push(dir);
    }
    grid.push(row);
    outward.push(out);
  }

  const base = m.pos.length / 3;
  for (let r = 0; r < R; r++) {
    const ring = rings[r] as Ring;
    const prev = grid[Math.max(0, r - 1)] as V3[];
    const next = grid[Math.min(R - 1, r + 1)] as V3[];
    for (let s = 0; s <= S; s++) {
      const si = s % S;
      const p = (grid[r] as V3[])[si] as V3;
      const along = sub((next[si] as V3), (prev[si] as V3));
      const around = sub((grid[r] as V3[])[(si + 1) % S] as V3, (grid[r] as V3[])[(si + S - 1) % S] as V3);
      let n = norm(cross(around, along));
      const hint = (outward[r] as V3[])[si] as V3;
      if (n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) n = [-n[0], -n[1], -n[2]];
      const angle = (s / S) * Math.PI * 2;
      pushVertex(m, p, n, [(s / S) * (o.uScale ?? 1), ring.v], o.color(ring, r, angle, p), o.weights(ring, r, angle, p));
    }
  }
  const stride = S + 1;
  for (let r = 0; r < R - 1; r++) {
    for (let s = 0; s < S; s++) {
      const a = base + r * stride + s;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      if (o.flip) m.idx.push(a, b, c, b, d, c);
      else m.idx.push(a, c, b, b, c, d);
    }
  }

  const capRing = (r: number, up: boolean): void => {
    const ring = rings[r] as Ring;
    const row = grid[r] as V3[];
    let centre: V3 = [0, 0, 0];
    for (const p of row) centre = [centre[0] + p[0] / S, centre[1] + p[1] / S, centre[2] + p[2] / S];
    const adj = (grid[up ? Math.min(R - 1, r + 1) : Math.max(0, r - 1)] as V3[])[0] as V3;
    let n = norm(sub(centre, adj));
    if (len(n) === 0) n = [0, up ? 1 : -1, 0];
    const ci = pushVertex(m, centre, n, [0.5, ring.v], o.color(ring, r, 0, centre), o.weights(ring, r, 0, centre));
    const first = m.pos.length / 3;
    for (let s = 0; s < S; s++) {
      const p = row[s] as V3;
      pushVertex(m, p, n, [s / S, ring.v], o.color(ring, r, (s / S) * Math.PI * 2, p), o.weights(ring, r, (s / S) * Math.PI * 2, p));
    }
    for (let s = 0; s < S; s++) {
      const a = first + s;
      const b = first + ((s + 1) % S);
      if (up !== !!o.flip) m.idx.push(ci, b, a);
      else m.idx.push(ci, a, b);
    }
  };
  const cap = o.cap ?? 'none';
  if (cap === 'start' || cap === 'both') capRing(0, false);
  if (cap === 'end' || cap === 'both') capRing(R - 1, true);
}

/** A grid surface from a function of (u, v). Used for the head and other sculpted shapes. */
export function surface(
  m: MeshData,
  nu: number,
  nv: number,
  point: (u: number, v: number) => V3,
  color: (u: number, v: number, p: V3) => V3,
  weights: (u: number, v: number, p: V3) => Influence,
  flip = false,
): void {
  const base = m.pos.length / 3;
  const pts: V3[][] = [];
  for (let j = 0; j <= nv; j++) {
    const row: V3[] = [];
    for (let i = 0; i <= nu; i++) row.push(point(i / nu, j / nv));
    pts.push(row);
  }
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const p = (pts[j] as V3[])[i] as V3;
      const l = (pts[j] as V3[])[(i + nu - 1) % nu] as V3;
      const r = (pts[j] as V3[])[(i + 1) % nu] as V3;
      const up = (pts[Math.max(0, j - 1)] as V3[])[i] as V3;
      const dn = (pts[Math.min(nv, j + 1)] as V3[])[i] as V3;
      let n = norm(cross(sub(r, l), sub(dn, up)));
      if (len(n) === 0) n = [0, 1, 0];
      pushVertex(m, p, n, [i / nu, j / nv], color(i / nu, j / nv, p), weights(i / nu, j / nv, p));
    }
  }
  const stride = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = base + j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      if (flip) m.idx.push(a, c, b, b, c, d);
      else m.idx.push(a, b, c, b, d, c);
    }
  }
}

/** Recompute smooth normals from triangles. Used after merging pieces that do not share a grid. */
export function recomputeNormals(m: MeshData): void {
  const n = new Array<number>(m.pos.length).fill(0);
  for (let t = 0; t < m.idx.length; t += 3) {
    const ia = m.idx[t] as number, ib = m.idx[t + 1] as number, ic = m.idx[t + 2] as number;
    const a: V3 = [m.pos[ia * 3] as number, m.pos[ia * 3 + 1] as number, m.pos[ia * 3 + 2] as number];
    const b: V3 = [m.pos[ib * 3] as number, m.pos[ib * 3 + 1] as number, m.pos[ib * 3 + 2] as number];
    const c: V3 = [m.pos[ic * 3] as number, m.pos[ic * 3 + 1] as number, m.pos[ic * 3 + 2] as number];
    const f = cross(sub(b, a), sub(c, a));
    for (const i of [ia, ib, ic]) {
      n[i * 3] = (n[i * 3] as number) + f[0];
      n[i * 3 + 1] = (n[i * 3 + 1] as number) + f[1];
      n[i * 3 + 2] = (n[i * 3 + 2] as number) + f[2];
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const v = norm([n[i] as number, n[i + 1] as number, n[i + 2] as number]);
    m.nrm[i] = v[0];
    m.nrm[i + 1] = v[1];
    m.nrm[i + 2] = v[2];
  }
}

/** An axis-aligned box. Good for pockets, buckles, bag bodies. */
export function addBox(m: MeshData, c: V3, hx: number, hy: number, hz: number, col: V3, inf: Influence): void {
  const faces: Array<[V3, V3, V3]> = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  const h: V3 = [hx, hy, hz];
  for (const [n, a, b] of faces) {
    const base = m.pos.length / 3;
    for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const p: V3 = [
        c[0] + (n[0] + a[0] * sa + b[0] * sb) * h[0],
        c[1] + (n[1] + a[1] * sa + b[1] * sb) * h[1],
        c[2] + (n[2] + a[2] * sa + b[2] * sb) * h[2],
      ];
      pushVertex(m, p, n, [(sa + 1) / 2, (sb + 1) / 2], col, inf);
    }
    m.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    m.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
}

/** A small UV sphere. */
export function addSphere(m: MeshData, c: V3, r: V3 | number, col: (p: V3) => V3, inf: Influence, nu = 10, nv = 8): void {
  const rr: V3 = typeof r === 'number' ? [r, r, r] : r;
  surface(
    m, nu, nv,
    (u, v) => {
      const th = u * Math.PI * 2;
      const ph = v * Math.PI;
      return [c[0] + Math.sin(ph) * Math.cos(th) * rr[0], c[1] + Math.cos(ph) * rr[1], c[2] + Math.sin(ph) * Math.sin(th) * rr[2]];
    },
    (_u, _v, p) => col(p),
    () => inf,
  );
}

export interface TubePoint {
  p: V3;
  /** Radius across and along the local frame. */
  r: number;
  r2?: number;
}

/** A tube following a polyline, with a stable frame (no twisting). */
export function tubeAlong(
  m: MeshData,
  pts: readonly TubePoint[],
  o: {
    radial: number;
    color: (i: number, p: V3, angle: number) => V3;
    weights: (i: number, p: V3) => Influence;
    cap?: 'none' | 'start' | 'end' | 'both';
    up?: V3;
    displace?: (p: V3, i: number, angle: number) => number;
  },
): void {
  const rings: Ring[] = [];
  let up: V3 = o.up ?? [0, 0, 1];
  for (let i = 0; i < pts.length; i++) {
    const a = (pts[Math.max(0, i - 1)] as TubePoint).p;
    const b = (pts[Math.min(pts.length - 1, i + 1)] as TubePoint).p;
    const t = norm(sub(b, a));
    let u = cross(up, t);
    if (len(u) < 1e-4) u = cross([1, 0, 0], t);
    u = norm(u);
    const w = norm(cross(t, u));
    up = w;
    const pt = pts[i] as TubePoint;
    rings.push({ c: pt.p, rx: pt.r, rz: pt.r2 ?? pt.r, u, w, v: i / Math.max(1, pts.length - 1), t: i / Math.max(1, pts.length - 1) });
  }
  loft(m, rings, {
    radial: o.radial,
    cap: o.cap ?? 'end',
    color: (_r, i, a, p) => o.color(i, p, a),
    weights: (_r, i, _a, p) => o.weights(i, p),
    displace: o.displace ? (p, _r, i, a) => (o.displace as (p: V3, i: number, a: number) => number)(p, i, a) : undefined,
  });
}
