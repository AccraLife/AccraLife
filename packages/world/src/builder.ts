import * as THREE from 'three';

export type V3 = [number, number, number];

const tmp = new THREE.Color();

/** Window texture tile size in metres (8 x 6 window cells of 3.5 m x 3.2 m). */
export const TILE_W = 28;
export const TILE_H = 19.2;

/**
 * Collects flat-shaded, vertex-coloured geometry into one BufferGeometry.
 * Merging a whole chunk's buildings into a few meshes keeps draw calls low (SRS PRF-002).
 */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uvs: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  get empty(): boolean {
    return this.idx.length === 0;
  }

  /**
   * Add a quad. The winding is fixed automatically so the visible face points along `hint`
   * (or along the right-hand-rule normal of a, b, c when there is no hint).
   */
  quad(a: V3, b: V3, c: V3, d: V3, hex: number, hint?: V3, uvFn?: (p: V3) => [number, number]): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    let q: V3[] = [a, b, c, d];
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      q = [a, d, c, b];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    tmp.set(hex);
    const base = this.pos.length / 3;
    for (const p of q) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(tmp.r, tmp.g, tmp.b);
      const uv = uvFn ? uvFn(p) : [0, 0];
      this.uvs.push(uv[0] as number, uv[1] as number);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  tri(a: V3, b: V3, c: V3, hex: number, hint?: V3): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    let q: V3[] = [a, b, c];
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      q = [a, c, b];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    tmp.set(hex);
    const base = this.pos.length / 3;
    for (const p of q) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(tmp.r, tmp.g, tmp.b);
      this.uvs.push(0, 0);
    }
    this.idx.push(base, base + 1, base + 2);
  }

  /** A horizontal quad facing up. */
  top(x0: number, z0: number, x1: number, z1: number, y: number, hex: number): void {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], hex, [0, 1, 0]);
  }

  /** A box with a top and four sides (no bottom), vertex-coloured, no texture. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number, sideHex?: number): void {
    const s = sideHex ?? hex;
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], s, [1, 0, 0]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], s, [-1, 0, 0]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], s, [0, 0, 1]);
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], s, [0, 0, -1]);
    this.top(x0, z0, x1, z1, y1, hex);
  }

  /** Four sides of a building with window-texture UVs (the roof is added separately). */
  wallBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number): void {
    const uvX = (p: V3): [number, number] => [p[2] / TILE_W, p[1] / TILE_H];
    const uvZ = (p: V3): [number, number] => [p[0] / TILE_W, p[1] / TILE_H];
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], hex, [1, 0, 0], uvX);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], hex, [-1, 0, 0], uvX);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], hex, [0, 0, 1], uvZ);
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], hex, [0, 0, -1], uvZ);
  }

  /** A four-sided pyramid (tree tops, small roofs). */
  pyramid(cx: number, cz: number, y0: number, y1: number, hx: number, hz: number, hex: number): void {
    const apex: V3 = [cx, y1, cz];
    const c: V3[] = [
      [cx - hx, y0, cz - hz],
      [cx + hx, y0, cz - hz],
      [cx + hx, y0, cz + hz],
      [cx - hx, y0, cz + hz],
    ];
    const mid = (y0 + y1) / 2;
    for (let k = 0; k < 4; k++) {
      const p = c[k] as V3;
      const q = c[(k + 1) % 4] as V3;
      const hint: V3 = [(p[0] + q[0]) / 2 - cx, (p[1] + q[1]) / 2 - mid + 0.5, (p[2] + q[2]) / 2 - cz];
      this.tri(p, q, apex, hex, hint);
    }
  }

  /** A tapered cylinder with `sides` flat faces (lighthouse, poles). */
  frustum(cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, sides: number, hex: number, capHex?: number): void {
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * Math.PI * 2;
      const a1 = ((k + 1) / sides) * Math.PI * 2;
      const p00: V3 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0];
      const p01: V3 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
      const p11: V3 = [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1];
      const p10: V3 = [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1];
      const am = (a0 + a1) / 2;
      this.quad(p00, p01, p11, p10, hex, [Math.cos(am), 0, Math.sin(am)]);
      if (r1 > 0.01) {
        this.tri([cx, y1, cz], p10, p11, capHex ?? hex, [0, 1, 0]);
      }
    }
  }

  /** A flat star-like polygon (given in x, y) extruded along z. Used for the star on the arch. */
  prismXY(points: Array<[number, number]>, z0: number, z1: number, hex: number): void {
    let cx = 0;
    let cy = 0;
    for (const p of points) {
      cx += p[0];
      cy += p[1];
    }
    cx /= points.length;
    cy /= points.length;
    for (let k = 0; k < points.length; k++) {
      const p = points[k] as [number, number];
      const q = points[(k + 1) % points.length] as [number, number];
      this.tri([cx, cy, z1], [p[0], p[1], z1], [q[0], q[1], z1], hex, [0, 0, 1]);
      this.tri([cx, cy, z0], [p[0], p[1], z0], [q[0], q[1], z0], hex, [0, 0, -1]);
      const mx = (p[0] + q[0]) / 2 - cx;
      const my = (p[1] + q[1]) / 2 - cy;
      this.quad([p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1], hex, [mx, my, 0]);
    }
  }

  build(): THREE.BufferGeometry | null {
    if (this.idx.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
