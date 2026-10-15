/**
 * Seeded random number generation (SRS SAV-010).
 * Gameplay code must never call Math.random: use an Rng so runs are reproducible.
 */

/** FNV-1a style hash of a string to an unsigned 32-bit integer. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hash a seed and two integer coordinates to an unsigned 32-bit integer. */
export function hashCoords(seed: number, a: number, b: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (a | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (b | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic noise in [0, 1) for integer lattice coordinates. */
export function noise2(seed: number, x: number, z: number): number {
  return hashCoords(seed, x, z) / 4294967296;
}

/** Smooth value noise in [0, 1) at real coordinates (bilinear over the lattice). */
export function valueNoise2(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const n00 = noise2(seed, x0, z0);
  const n10 = noise2(seed, x0 + 1, z0);
  const n01 = noise2(seed, x0, z0 + 1);
  const n11 = noise2(seed, x0 + 1, z0 + 1);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sz;
}

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** mulberry32: returns a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Pick an item by weight. Weights must be non-negative and not all zero. */
  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i] as number;
      if (r <= 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  /** Create an independent generator derived from this one's seed and a label. */
  fork(label: string): Rng {
    return new Rng(hashString(label) ^ this.state);
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}
