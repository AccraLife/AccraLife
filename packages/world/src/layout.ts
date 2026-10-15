import { type Landmark, type PointOfInterest, PRICES, Rng, hashCoords } from '@accra/core';
import { BLOCK_MAX, BLOCK_MIN, LOT_INSET, PITCH } from './grid';

/**
 * Block layout (SRS WLD-030 to WLD-033): deterministic from the world seed.
 * Pure data, so POIs and landmarks are known for the whole district without building any meshes.
 * All names are fictional; landmarks are stylised placeholders awaiting cultural review (CUL-001).
 */

export type BlockKind = 'generic' | 'park' | 'arch' | 'market' | 'lighthouse' | 'station';

export interface Lot {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  floors: number;
  height: number;
  wall: number;
  roof: number;
  tank: boolean;
}

export interface TreeSpec {
  x: number;
  z: number;
  h: number;
}

export interface BlockLayout {
  i: number;
  j: number;
  kind: BlockKind;
  /** Block corner (the road centre line of its north-west corner). */
  bx: number;
  bz: number;
  lots: Lot[];
  trees: TreeSpec[];
  pois: PointOfInterest[];
}

export const FLOOR_HEIGHT = 3.2;

const WALLS = [0xe9dcc2, 0xd9c7a3, 0xf2efe6, 0xc9d9e8, 0xe6b89c, 0xb7c9a8, 0xd8a47f, 0xf0d68a, 0x9fb8c8, 0xe8c9c0];
const ROOFS = [0x7a6a5d, 0x8a4b3a, 0x5d6870, 0x6a5a4a, 0x7d7f84];

const CHOP_NAMES = [
  "Auntie Ama's Chop Bar",
  "Mama Esi's Waakye",
  "Kofi's Kitchen",
  "Nana's Banku Spot",
  "Sister Efua's Joint",
  "Papa Yaw's Grill",
  'Akos Food Corner',
];
const KIOSK_NAMES = ['Kwesi Kiosk', 'Water and Airtime Corner', "Abena's Provisions", 'Fiifi Mini-Mart', 'Corner Store'];
const WORK_NAMES = ['Adwoa Provisions', 'Kojo Hardware', "Yaa's Fabrics", 'Mensah Electricals', 'Ama Pharmacy Stand'];

const SPECIAL: Record<string, BlockKind> = {
  '0,0': 'arch',
  '1,0': 'market',
  '-2,-2': 'lighthouse',
  '0,-1': 'station',
  '-4,3': 'station',
};

/** The two trotro stops, each the other's destination. */
export const STATIONS = [
  { block: '0,-1', name: 'Central Station' },
  { block: '-4,3', name: 'Western Terminal' },
] as const;

export const LANDMARKS: readonly Landmark[] = [
  { id: 'arch', name: 'Independence Arch', x: 40, z: 40 },
  { id: 'market', name: 'Central Market', x: PITCH + 40, z: 40 },
  { id: 'lighthouse', name: 'The Lighthouse', x: -2 * PITCH + 40, z: -2 * PITCH + 40 },
];

/** How close the player must get to discover each landmark. */
export const LANDMARK_RADIUS = 38;

function makePoi(
  kind: string,
  name: string,
  x: number,
  z: number,
  prompt: string,
  i: number,
  j: number,
  n: number,
): PointOfInterest {
  return { id: `${kind}:${i},${j}:${n}`, kind, name, x, z, prompt };
}

function stationPoi(i: number, j: number): PointOfInterest {
  const idx = STATIONS.findIndex((s) => s.block === `${i},${j}`);
  const here = STATIONS[idx] as (typeof STATIONS)[number];
  const other = STATIONS[1 - idx] as (typeof STATIONS)[number];
  return makePoi(
    'trotro',
    `${here.name} (trotro)`,
    i * PITCH + 40,
    j * PITCH + 7.2,
    `Ride a trotro to ${other.name} (GHS ${PRICES.fare})`,
    i,
    j,
    0,
  );
}

function commercialPoi(rng: Rng, kind: string, i: number, j: number, n: number, x: number): PointOfInterest {
  const z = j * PITCH + 7.2;
  if (kind === 'chopbar') {
    const name = rng.pick(CHOP_NAMES);
    return makePoi(kind, name, x, z, `Eat at ${name} (GHS ${PRICES.chopbar})`, i, j, n);
  }
  if (kind === 'kiosk') {
    const name = rng.pick(KIOSK_NAMES);
    return makePoi(kind, name, x, z, `Buy water at ${name} (GHS ${PRICES.water})`, i, j, n);
  }
  const name = rng.pick(WORK_NAMES);
  return makePoi(kind, name, x, z, `Work a shift at ${name} (earn GHS ${PRICES.shiftPay})`, i, j, n);
}

export function blockKindAt(i: number, j: number, seed: number): BlockKind {
  const special = SPECIAL[`${i},${j}`];
  if (special) return special;
  return new Rng(hashCoords(seed, i * 31 + 7, j * 17 + 3)).chance(0.1) ? 'park' : 'generic';
}

export function layoutBlock(i: number, j: number, seed: number): BlockLayout {
  const rng = new Rng(hashCoords(seed, i, j));
  const bx = i * PITCH;
  const bz = j * PITCH;
  const kind = blockKindAt(i, j, seed);
  const layout: BlockLayout = { i, j, kind, bx, bz, lots: [], trees: [], pois: [] };
  const key = `${i},${j}`;

  // Points of interest first (they never depend on the building rolls below).
  if (kind === 'station') {
    layout.pois.push(stationPoi(i, j));
  } else if (key === '1,0') {
    layout.pois.push(commercialPoi(rng, 'kiosk', i, j, 0, bx + 22));
    layout.pois.push(commercialPoi(rng, 'chopbar', i, j, 1, bx + 58));
  } else if (key === '-1,0') {
    layout.pois.push(makePoi('home', 'Your room', bx + 40, bz + 7.2, 'Rest at home (sleep)', i, j, 0));
  } else if (key === '-2,0') {
    layout.pois.push(commercialPoi(rng, 'work', i, j, 0, bx + 40));
  } else if (key === '-1,-1') {
    layout.pois.push(commercialPoi(rng, 'kiosk', i, j, 0, bx + 40));
  } else if (kind === 'generic' && rng.chance(0.5)) {
    const roll = rng.pickWeighted(['chopbar', 'kiosk', 'work'], [0.4, 0.4, 0.2]);
    layout.pois.push(commercialPoi(rng, roll, i, j, 0, bx + rng.range(20, 60)));
  }

  if (kind === 'generic') {
    buildLots(layout, rng);
  } else if (kind === 'park') {
    const count = rng.int(14, 22);
    for (let n = 0; n < count; n++) {
      layout.trees.push({
        x: bx + rng.range(15, PITCH - 15),
        z: bz + rng.range(15, PITCH - 15),
        h: rng.range(5, 9),
      });
    }
  }
  return layout;
}

function buildLots(layout: BlockLayout, rng: Rng): void {
  const { bx, bz, i, j } = layout;
  const columns = rng.pickWeighted([1, 2], [0.35, 0.65]);
  const rows = rng.pickWeighted([1, 2], [0.35, 0.65]);
  const gap = 7;
  const inner = PITCH - 2 * LOT_INSET;
  const lotW = (inner - gap * (columns - 1)) / columns;
  const lotD = (inner - gap * (rows - 1)) / rows;
  // Taller near the centre of the district.
  const dist = Math.hypot(i + 0.5, j + 0.5);
  const maxFloors = Math.max(2, Math.round((38 - dist * 4.2) / FLOOR_HEIGHT));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const lx0 = bx + LOT_INSET + c * (lotW + gap);
      const lz0 = bz + LOT_INSET + r * (lotD + gap);
      if (rng.chance(0.2)) {
        const count = rng.int(2, 4);
        for (let n = 0; n < count; n++) {
          layout.trees.push({
            x: lx0 + rng.range(2, lotW - 2),
            z: lz0 + rng.range(2, lotD - 2),
            h: rng.range(5, 8),
          });
        }
        continue;
      }
      const inset = () => rng.range(0.5, 2.5);
      const floors = rng.int(1, maxFloors);
      layout.lots.push({
        x0: lx0 + inset(),
        z0: lz0 + inset(),
        x1: lx0 + lotW - inset(),
        z1: lz0 + lotD - inset(),
        floors,
        height: floors * FLOOR_HEIGHT,
        wall: rng.pick(WALLS),
        roof: rng.pick(ROOFS),
        tank: floors >= 3 && rng.chance(0.4),
      });
    }
  }
}

/** Every point of interest in the district (computed once; no meshes needed). */
export function allPois(seed: number): PointOfInterest[] {
  const out: PointOfInterest[] = [];
  for (let j = BLOCK_MIN; j <= BLOCK_MAX; j++) {
    for (let i = BLOCK_MIN; i <= BLOCK_MAX; i++) {
      out.push(...layoutBlock(i, j, seed).pois);
    }
  }
  return out;
}
