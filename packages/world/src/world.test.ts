import { describe, expect, it } from 'vitest';
import { type Heading, Rng } from '@accra/core';
import {
  DIRS,
  EDGE,
  NODE_MAX,
  NODE_MIN,
  PITCH,
  chunkIndex,
  isRoadAt,
  nextWaypoint,
  pushOutOfBoxes,
  randomLanePoint,
  rightOf,
} from './grid';
import { LANDMARKS, STATIONS, allPois, layoutBlock } from './layout';

const SEED = 20261013;

describe('grid', () => {
  it('knows where the roads are', () => {
    expect(isRoadAt(0, 40)).toBe(true);
    expect(isRoadAt(40, 0)).toBe(true);
    expect(isRoadAt(5.9, 40)).toBe(true);
    expect(isRoadAt(40, 40)).toBe(false);
    expect(isRoadAt(-80, -40)).toBe(true);
  });

  it('right-hand vectors turn clockwise seen from above', () => {
    // Facing east (+x) the right-hand side is south (+z); facing south it is west (-x).
    expect(rightOf(0)).toEqual({ x: 0, z: 1 });
    expect(rightOf(1)).toEqual({ x: -1, z: 0 });
    expect(rightOf(2)).toEqual({ x: 0, z: -1 });
    expect(rightOf(3)).toEqual({ x: 1, z: 0 });
  });

  it('chunks tile the world', () => {
    expect(chunkIndex(0)).toBe(0);
    expect(chunkIndex(159.9)).toBe(0);
    expect(chunkIndex(160)).toBe(1);
    expect(chunkIndex(-0.1)).toBe(-1);
  });

  it('waypoints always lead to a real intersection and stay in the world', () => {
    const rng = new Rng(5);
    for (const kind of ['vehicle', 'pedestrian'] as const) {
      let p = randomLanePoint(0, 0, 50, 120, kind, rng);
      expect(p).not.toBeNull();
      if (!p) continue;
      for (let n = 0; n < 500; n++) {
        const next = nextWaypoint(p, p.heading as Heading, kind, rng);
        expect(Math.abs(next.x)).toBeLessThanOrEqual(NODE_MAX * PITCH + 8);
        expect(Math.abs(next.z)).toBeLessThanOrEqual(NODE_MAX * PITCH + 8);
        // Always on or beside a road line.
        const onLineX = Math.abs(next.x / PITCH - Math.round(next.x / PITCH)) * PITCH <= 7.5;
        const onLineZ = Math.abs(next.z / PITCH - Math.round(next.z / PITCH)) * PITCH <= 7.5;
        expect(onLineX && onLineZ).toBe(true);
        p = next;
      }
    }
  });

  it('is deterministic for a seed', () => {
    const a = new Rng(11);
    const b = new Rng(11);
    let pa = randomLanePoint(100, 100, 40, 90, 'vehicle', a);
    let pb = randomLanePoint(100, 100, 40, 90, 'vehicle', b);
    for (let n = 0; n < 40 && pa && pb; n++) {
      expect(pa).toEqual(pb);
      pa = nextWaypoint(pa, pa.heading, 'vehicle', a);
      pb = nextWaypoint(pb, pb.heading, 'vehicle', b);
    }
  });

  it('never routes off the map from a corner', () => {
    const rng = new Rng(3);
    // North-west corner node, heading west (off the map): must turn back inside.
    const corner = { x: NODE_MIN * PITCH, z: NODE_MIN * PITCH };
    for (let h = 0; h < 4; h++) {
      const next = nextWaypoint(corner, h as Heading, 'vehicle', rng);
      expect(Math.abs(next.x)).toBeLessThanOrEqual(NODE_MAX * PITCH + 8);
      expect(Math.abs(next.z)).toBeLessThanOrEqual(NODE_MAX * PITCH + 8);
    }
    expect(DIRS.length).toBe(4);
  });

  it('pushes a circle out of a box and keeps it out', () => {
    const box = { x0: 0, z0: 0, x1: 10, z1: 10 };
    const out = pushOutOfBoxes(-0.2, 5, 0.5, [box]);
    expect(out.x).toBeLessThanOrEqual(-0.5 + 1e-6);
    const inside = pushOutOfBoxes(5, 5, 0.5, [box]);
    const dx = Math.max(box.x0 - inside.x, 0, inside.x - box.x1);
    const dz = Math.max(box.z0 - inside.z, 0, inside.z - box.z1);
    expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(0.5 - 1e-6);
  });
});

describe('layout', () => {
  it('is deterministic', () => {
    expect(layoutBlock(3, -2, SEED)).toEqual(layoutBlock(3, -2, SEED));
    expect(layoutBlock(3, -2, SEED)).not.toEqual(layoutBlock(3, -2, SEED + 1));
  });

  it('keeps buildings inside their block, off the pavement', () => {
    for (let j = -8; j <= 7; j++) {
      for (let i = -8; i <= 7; i++) {
        const b = layoutBlock(i, j, SEED);
        for (const lot of b.lots) {
          expect(lot.x0).toBeGreaterThanOrEqual(b.bx + 11);
          expect(lot.z0).toBeGreaterThanOrEqual(b.bz + 11);
          expect(lot.x1).toBeLessThanOrEqual(b.bx + PITCH - 11);
          expect(lot.z1).toBeLessThanOrEqual(b.bz + PITCH - 11);
          expect(lot.x1).toBeGreaterThan(lot.x0 + 3);
          expect(lot.z1).toBeGreaterThan(lot.z0 + 3);
        }
      }
    }
  });

  it('has everything the first-day missions need near the start', () => {
    const pois = allPois(SEED);
    const kinds = new Set(pois.map((p) => p.kind));
    for (const k of ['home', 'chopbar', 'kiosk', 'work', 'trotro']) expect(kinds.has(k)).toBe(true);
    expect(pois.filter((p) => p.kind === 'trotro').length).toBe(STATIONS.length);
    // Unique ids.
    expect(new Set(pois.map((p) => p.id)).size).toBe(pois.length);
    // A chop bar, a kiosk and a work place within a short walk of the spawn point.
    const near = (kind: string) => pois.some((p) => p.kind === kind && Math.hypot(p.x + 20, p.z - 7.2) < 150);
    expect(near('chopbar') && near('kiosk') && near('work')).toBe(true);
  });

  it('places every POI on a sidewalk, never in the road', () => {
    for (const p of allPois(SEED)) {
      expect(isRoadAt(p.x, p.z)).toBe(false);
      expect(Math.abs(p.x)).toBeLessThan(EDGE);
    }
  });

  it('lists landmarks inside the district', () => {
    expect(LANDMARKS.map((l) => l.id)).toEqual(['arch', 'market', 'lighthouse']);
  });
});
