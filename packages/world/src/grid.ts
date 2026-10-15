import { type Heading, type TravelKind, type Vec2, type Waypoint, Rng } from '@accra/core';

/**
 * The street grid (SRS WLD-020). Pure maths, no rendering, so other modules and tests can use it.
 *
 * Coordinates: x east, z south, y up, metres. Roads run along every multiple of PITCH.
 * Heading: 0 = +x (east), 1 = +z (south), 2 = -x (west), 3 = -z (north).
 */

export const PITCH = 80;
export const ROAD_HALF = 6;
export const SIDEWALK_OUTER = 9;
export const LOT_INSET = 11;

/** Road intersections exist for indices NODE_MIN..NODE_MAX on both axes. */
export const NODE_MIN = -8;
export const NODE_MAX = 8;
/** Blocks (the city squares between roads) exist for indices BLOCK_MIN..BLOCK_MAX. */
export const BLOCK_MIN = -8;
export const BLOCK_MAX = 7;

export const CHUNK_BLOCKS = 2;
export const CHUNK_SIZE = PITCH * CHUNK_BLOCKS;
export const CHUNK_MIN = -4;
export const CHUNK_MAX = 3;

/** The player may walk anywhere inside +/- EDGE. */
export const EDGE = 638;
/** Height of the raised pavement slab above the road. */
export const SLAB_Y = 0.12;

export const VEHICLE_LANE = 3;
export const WALK_LANE = 7.2;

export const DIRS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
];

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** The unit vector pointing to the right-hand side when facing `heading`. */
export function rightOf(heading: Heading): { x: number; z: number } {
  return DIRS[(heading + 1) % 4] as { x: number; z: number };
}

export function distToLine(v: number): number {
  const m = ((v % PITCH) + PITCH) % PITCH;
  return Math.min(m, PITCH - m);
}

export function isRoadAt(x: number, z: number): boolean {
  return distToLine(x) <= ROAD_HALF || distToLine(z) <= ROAD_HALF;
}

export function chunkIndex(v: number): number {
  return Math.floor(v / CHUNK_SIZE);
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function chunkValid(cx: number, cz: number): boolean {
  return cx >= CHUNK_MIN && cx <= CHUNK_MAX && cz >= CHUNK_MIN && cz <= CHUNK_MAX;
}

export function nodeValid(i: number, j: number): boolean {
  return i >= NODE_MIN && i <= NODE_MAX && j >= NODE_MIN && j <= NODE_MAX;
}

export function laneOffset(kind: TravelKind): number {
  return kind === 'vehicle' ? VEHICLE_LANE : WALK_LANE;
}

function lanePoint(i: number, j: number, heading: Heading, kind: TravelKind): Waypoint {
  const r = rightOf(heading);
  const off = laneOffset(kind);
  return { x: i * PITCH + r.x * off, z: j * PITCH + r.z * off, heading };
}

/** Headings that lead to a real intersection from node (i, j). */
function validHeadings(i: number, j: number): Heading[] {
  const out: Heading[] = [];
  for (let h = 0; h < 4; h++) {
    const d = DIRS[h] as { x: number; z: number };
    if (nodeValid(i + d.x, j + d.z)) out.push(h as Heading);
  }
  return out;
}

/**
 * The next place to steer for when moving along the street grid.
 * Walks to the intersection ahead, then picks the heading to leave it with
 * (straight 60%, left 20%, right 20%; a U-turn only at a dead end).
 * The returned point is in the lane for the NEW heading (vehicles keep right; pedestrians use the right sidewalk).
 */
export function nextWaypoint(from: Vec2, heading: Heading, kind: TravelKind, rng: Rng): Waypoint {
  const d = DIRS[heading] as { x: number; z: number };
  const horizontal = d.x !== 0;
  const along = horizontal ? from.x : from.z;
  const perp = horizontal ? from.z : from.x;
  const step = horizontal ? d.x : d.z;

  let idx = step > 0 ? Math.floor((along + 1e-3) / PITCH) + 1 : Math.ceil((along - 1e-3) / PITCH) - 1;
  idx = clamp(idx, NODE_MIN, NODE_MAX);
  const line = clamp(Math.round(perp / PITCH), NODE_MIN, NODE_MAX);
  const i = horizontal ? idx : line;
  const j = horizontal ? line : idx;

  const candidates: Heading[] = [heading, ((heading + 3) % 4) as Heading, ((heading + 1) % 4) as Heading];
  const weights = [0.6, 0.2, 0.2];
  const options: Heading[] = [];
  const optionWeights: number[] = [];
  candidates.forEach((h, n) => {
    const dir = DIRS[h] as { x: number; z: number };
    if (nodeValid(i + dir.x, j + dir.z)) {
      options.push(h);
      optionWeights.push(weights[n] as number);
    }
  });

  let next: Heading;
  if (options.length > 0) {
    next = rng.pickWeighted(options, optionWeights);
  } else {
    next = ((heading + 2) % 4) as Heading;
  }
  return lanePoint(i, j, next, kind);
}

/** A random lane point near an intersection between minDist and maxDist from (x, z). */
export function randomLanePoint(
  x: number,
  z: number,
  minDist: number,
  maxDist: number,
  kind: TravelKind,
  rng: Rng,
): Waypoint | null {
  for (let attempt = 0; attempt < 14; attempt++) {
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(minDist, maxDist);
    const tx = x + Math.cos(angle) * dist;
    const tz = z + Math.sin(angle) * dist;
    const i = clamp(Math.round(tx / PITCH), NODE_MIN, NODE_MAX);
    const j = clamp(Math.round(tz / PITCH), NODE_MIN, NODE_MAX);
    const nx = i * PITCH;
    const nz = j * PITCH;
    const actual = Math.hypot(nx - x, nz - z);
    if (actual < minDist * 0.8 || actual > maxDist * 1.2) continue;
    const headings = validHeadings(i, j);
    if (headings.length === 0) continue;
    return lanePoint(i, j, rng.pick(headings), kind);
  }
  return null;
}

export interface Aabb {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Push a circle (x, z, r) out of the given boxes. Two passes settle corners. */
export function pushOutOfBoxes(x: number, z: number, r: number, boxes: readonly Aabb[]): Vec2 {
  let px = x;
  let pz = z;
  for (let pass = 0; pass < 2; pass++) {
    for (const box of boxes) {
      const nx = clamp(px, box.x0, box.x1);
      const nz = clamp(pz, box.z0, box.z1);
      const dx = px - nx;
      const dz = pz - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = r - d;
        px += (dx / d) * push;
        pz += (dz / d) * push;
      } else {
        // The centre is inside the box: leave through the nearest face.
        const left = px - box.x0;
        const right = box.x1 - px;
        const up = pz - box.z0;
        const down = box.z1 - pz;
        const m = Math.min(left, right, up, down);
        if (m === left) px = box.x0 - r;
        else if (m === right) px = box.x1 + r;
        else if (m === up) pz = box.z0 - r;
        else pz = box.z1 + r;
      }
    }
  }
  return { x: px, z: pz };
}
