import * as THREE from 'three';
import { Rng, hashCoords } from '@accra/core';
import { MeshBuilder } from './builder';
import {
  type Aabb,
  CHUNK_BLOCKS,
  CHUNK_MAX,
  NODE_MAX,
  NODE_MIN,
  PITCH,
  SLAB_Y,
} from './grid';
import { type BlockLayout, layoutBlock } from './layout';
import type { LabelFactory } from './textures';

export interface WorldMaterials {
  walls: THREE.Material;
  plain: THREE.Material;
  glow: THREE.Material;
  beacon: THREE.Material;
  labels: LabelFactory;
}

export interface BuiltChunk {
  key: string;
  cx: number;
  cz: number;
  group: THREE.Group;
  colliders: Aabb[];
  geometries: THREE.BufferGeometry[];
  sprites: THREE.Sprite[];
}

interface Builders {
  walls: MeshBuilder;
  plain: MeshBuilder;
  glow: MeshBuilder;
  beacon: MeshBuilder;
}

const ASPHALT = 0x3b3c40;
const MARK = 0xe9e7dc;
const SIDEWALK = 0xbdb7aa;
const KERB = 0xd3cdc1;
const POLE = 0x55585c;
const LAMP = 0xffe2a0;

export const POI_COLORS: Record<string, number> = {
  chopbar: 0xff8a2b,
  kiosk: 0x2bb3ff,
  work: 0xffd23b,
  home: 0xb67bff,
  trotro: 0x35e08a,
};

const GROUND_BY_KIND: Record<string, number> = {
  generic: 0x9a8460,
  park: 0x5f9146,
  arch: 0xc9c2b4,
  market: 0xb9b0a0,
  lighthouse: 0x8fa66f,
  station: 0x45474b,
};

const TREE_GREENS = [0x3f7d3a, 0x4b8c3f, 0x35702f, 0x5a9a45];
const CANOPY_COLORS = [0xd9482f, 0xf2c230, 0x2f6fb5, 0x2f9e5b, 0xe8e2d0, 0xb5479a];
const GOODS_COLORS = [0xe8602c, 0xf2c230, 0x4b9a3a, 0xc8372d, 0x8a5a3a, 0xe9d9a8];
const BUS_COLORS = [0xf2c230, 0x2f6fb5, 0xd9482f, 0xf5f5f0];

export function* chunkJob(
  cx: number,
  cz: number,
  seed: number,
  mats: WorldMaterials,
  out: BuiltChunk,
): Generator<void, void, void> {
  const b: Builders = {
    walls: new MeshBuilder(),
    plain: new MeshBuilder(),
    glow: new MeshBuilder(),
    beacon: new MeshBuilder(),
  };
  const i0 = cx * CHUNK_BLOCKS;
  const j0 = cz * CHUNK_BLOCKS;
  const iMax = cx === CHUNK_MAX ? i0 + CHUNK_BLOCKS : i0 + CHUNK_BLOCKS - 1;
  const jMax = cz === CHUNK_MAX ? j0 + CHUNK_BLOCKS : j0 + CHUNK_BLOCKS - 1;

  // 1. Roads, markings and street lamps.
  for (let j = j0; j <= jMax; j++) {
    for (let i = i0; i <= iMax; i++) addNode(i, j, b);
  }
  yield;

  // 2. Blocks, one per step so no single step is expensive.
  for (let j = j0; j < j0 + CHUNK_BLOCKS; j++) {
    for (let i = i0; i < i0 + CHUNK_BLOCKS; i++) {
      const layout = layoutBlock(i, j, seed);
      addBlock(layout, b, out, mats, new Rng(hashCoords(seed ^ 0x51, i, j)));
      yield;
    }
  }

  // 3. Turn the builders into meshes.
  const make = (builder: MeshBuilder, material: THREE.Material, shadows: boolean, order = 0): void => {
    const g = builder.build();
    if (!g) return;
    out.geometries.push(g);
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = order;
    out.group.add(mesh);
  };
  make(b.walls, mats.walls, true);
  make(b.plain, mats.plain, true);
  make(b.glow, mats.glow, false);
  make(b.beacon, mats.beacon, false, 2);
}

// ---------------------------------------------------------------- roads

function lamp(x: number, z: number, b: Builders): void {
  b.plain.box(x - 0.1, SLAB_Y, z - 0.1, x + 0.1, SLAB_Y + 6.2, z + 0.1, POLE);
  b.glow.box(x - 0.45, SLAB_Y + 6.1, z - 0.45, x + 0.45, SLAB_Y + 6.4, z + 0.45, LAMP);
}

function addNode(i: number, j: number, b: Builders): void {
  const nx = i * PITCH;
  const nz = j * PITCH;
  const hasEast = i < NODE_MAX;
  const hasSouth = j < NODE_MAX;
  const hasWest = i > NODE_MIN;
  const hasNorth = j > NODE_MIN;

  // Intersection and the two road segments this node owns.
  b.plain.top(nx - 6, nz - 6, nx + 6, nz + 6, 0, ASPHALT);
  if (hasEast) {
    b.plain.top(nx + 6, nz - 6, nx + PITCH - 6, nz + 6, 0, ASPHALT);
    for (let x = nx + 14; x < nx + PITCH - 16; x += 7) b.plain.top(x, nz - 0.15, x + 3, nz + 0.15, 0.03, MARK);
    lamp(nx + 40, nz - 8.6, b);
  }
  if (hasSouth) {
    b.plain.top(nx - 6, nz + 6, nx + 6, nz + PITCH - 6, 0, ASPHALT);
    for (let z = nz + 14; z < nz + PITCH - 16; z += 7) b.plain.top(nx - 0.15, z, nx + 0.15, z + 3, 0.03, MARK);
    lamp(nx + 8.6, nz + 40, b);
  }

  // Zebra crossings on every arm that exists (SRS WLD-022).
  for (let k = 0; k < 8; k++) {
    const o = -5 + k * 1.4;
    if (hasEast) b.plain.top(nx + 7, nz + o, nx + 10, nz + o + 0.75, 0.03, MARK);
    if (hasWest) b.plain.top(nx - 10, nz + o, nx - 7, nz + o + 0.75, 0.03, MARK);
    if (hasSouth) b.plain.top(nx + o, nz + 7, nx + o + 0.75, nz + 10, 0.03, MARK);
    if (hasNorth) b.plain.top(nx + o, nz - 10, nx + o + 0.75, nz - 7, 0.03, MARK);
  }

  // Corner lamps. Only the south-east corner is owned by this node, so lamps never double up.
  if (hasEast && hasSouth) lamp(nx + 8.6, nz + 8.6, b);
}

// ---------------------------------------------------------------- blocks

function addTree(x: number, z: number, h: number, rng: Rng, b: Builders, out: BuiltChunk): void {
  b.plain.box(x - 0.2, SLAB_Y, z - 0.2, x + 0.2, SLAB_Y + h * 0.4, z + 0.2, 0x6b4a2f);
  const green = rng.pick(TREE_GREENS);
  b.plain.pyramid(x, z, SLAB_Y + h * 0.3, SLAB_Y + h, 1.9, 1.9, green);
  b.plain.pyramid(x, z, SLAB_Y + h * 0.58, SLAB_Y + h * 1.15, 1.35, 1.35, rng.pick(TREE_GREENS));
  out.colliders.push({ x0: x - 0.35, z0: z - 0.35, x1: x + 0.35, z1: z + 0.35 });
}

function addPoiVisual(
  layout: BlockLayout,
  b: Builders,
  out: BuiltChunk,
  mats: WorldMaterials,
): void {
  for (const poi of layout.pois) {
    const color = POI_COLORS[poi.kind] ?? 0xffffff;
    b.beacon.box(poi.x - 0.18, SLAB_Y, poi.z - 0.18, poi.x + 0.18, SLAB_Y + 8, poi.z + 0.18, color);
    const sprite = new THREE.Sprite(mats.labels.get(poi.name, color));
    sprite.position.set(poi.x, SLAB_Y + 9.6, poi.z);
    sprite.scale.set(11, 2.75, 1);
    sprite.userData.poi = poi.id;
    out.group.add(sprite);
    out.sprites.push(sprite);
  }
}

function addBlock(layout: BlockLayout, b: Builders, out: BuiltChunk, mats: WorldMaterials, rng: Rng): void {
  const { bx, bz } = layout;
  const x0 = bx + 6;
  const x1 = bx + PITCH - 6;
  const z0 = bz + 6;
  const z1 = bz + PITCH - 6;

  // Raised pavement ring (3 m wide) with kerbs, then the block interior.
  b.plain.top(x0, z0, x1, z0 + 3, SLAB_Y, SIDEWALK);
  b.plain.top(x0, z1 - 3, x1, z1, SLAB_Y, SIDEWALK);
  b.plain.top(x0, z0 + 3, x0 + 3, z1 - 3, SLAB_Y, SIDEWALK);
  b.plain.top(x1 - 3, z0 + 3, x1, z1 - 3, SLAB_Y, SIDEWALK);
  b.plain.top(x0 + 3, z0 + 3, x1 - 3, z1 - 3, SLAB_Y, GROUND_BY_KIND[layout.kind] ?? 0x9a8460);
  b.plain.quad([x0, 0, z0], [x1, 0, z0], [x1, SLAB_Y, z0], [x0, SLAB_Y, z0], KERB, [0, 0, -1]);
  b.plain.quad([x0, 0, z1], [x1, 0, z1], [x1, SLAB_Y, z1], [x0, SLAB_Y, z1], KERB, [0, 0, 1]);
  b.plain.quad([x0, 0, z0], [x0, 0, z1], [x0, SLAB_Y, z1], [x0, SLAB_Y, z0], KERB, [-1, 0, 0]);
  b.plain.quad([x1, 0, z0], [x1, 0, z1], [x1, SLAB_Y, z1], [x1, SLAB_Y, z0], KERB, [1, 0, 0]);

  switch (layout.kind) {
    case 'arch':
      addArch(bx + 40, bz + 40, b, out);
      break;
    case 'market':
      addMarket(bx, bz, b, out, rng);
      break;
    case 'lighthouse':
      addLighthouse(bx + 40, bz + 40, b, out);
      break;
    case 'station':
      addStation(bx, bz, b, out, rng);
      break;
    default:
      break;
  }

  for (const lot of layout.lots) {
    b.walls.wallBox(lot.x0, SLAB_Y, lot.z0, lot.x1, SLAB_Y + lot.height, lot.z1, lot.wall);
    const top = SLAB_Y + lot.height;
    b.plain.top(lot.x0, lot.z0, lot.x1, lot.z1, top, lot.roof);
    if (lot.tank) {
      const tx = (lot.x0 + lot.x1) / 2;
      const tz = (lot.z0 + lot.z1) / 2;
      b.plain.box(tx - 0.8, top, tz - 0.8, tx + 0.8, top + 1.6, tz + 0.8, 0x3f6e8c);
    }
    out.colliders.push({ x0: lot.x0, z0: lot.z0, x1: lot.x1, z1: lot.z1 });
  }
  for (const tree of layout.trees) addTree(tree.x, tree.z, tree.h, rng, b, out);

  addPoiVisual(layout, b, out, mats);
}

// ---------------------------------------------------------------- landmarks (stylised placeholders)

function addArch(cx: number, cz: number, b: Builders, out: BuiltChunk): void {
  const stone = 0xf3efe4;
  b.plain.box(cx - 24, SLAB_Y, cz - 24, cx + 24, SLAB_Y + 0.35, cz + 24, 0xd8d2c5);
  b.plain.box(cx - 18, SLAB_Y + 0.35, cz - 18, cx + 18, SLAB_Y + 0.7, cz + 18, 0xe2ddd0);
  const base = SLAB_Y + 0.7;
  b.plain.box(cx - 11.5, base, cz - 2.5, cx - 6.5, 15.7, cz + 2.5, stone);
  b.plain.box(cx + 6.5, base, cz - 2.5, cx + 11.5, 15.7, cz + 2.5, stone);
  b.plain.box(cx - 11.5, 15.7, cz - 2.5, cx + 11.5, 19.2, cz + 2.5, stone);
  const bands: Array<[number, number, number]> = [
    [16.4, 17.0, 0xce1126],
    [17.0, 17.6, 0xfcd116],
    [17.6, 18.2, 0x006b3f],
  ];
  for (const [ya, yb, color] of bands) {
    b.plain.box(cx - 9, ya, cz + 2.5, cx + 9, yb, cz + 2.58, color);
    b.plain.box(cx - 9, ya, cz - 2.58, cx + 9, yb, cz - 2.5, color);
  }
  b.plain.box(cx - 0.6, 19.2, cz - 0.4, cx + 0.6, 21.5, cz + 0.4, 0x2a2a2a);
  const star: Array<[number, number]> = [];
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 === 0 ? 4.2 : 1.7;
    star.push([cx + Math.cos(a) * r, 23.6 + Math.sin(a) * r]);
  }
  b.plain.prismXY(star, cz - 0.4, cz + 0.4, 0x111111);
  out.colliders.push({ x0: cx - 11.5, z0: cz - 2.5, x1: cx - 6.5, z1: cz + 2.5 });
  out.colliders.push({ x0: cx + 6.5, z0: cz - 2.5, x1: cx + 11.5, z1: cz + 2.5 });
}

function addMarket(bx: number, bz: number, b: Builders, out: BuiltChunk, rng: Rng): void {
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 7; col++) {
      const sx = bx + 14 + col * 7.4;
      const sz = bz + 16 + row * 9;
      b.plain.box(sx, SLAB_Y, sz, sx + 3.6, SLAB_Y + 0.9, sz + 2.4, 0x8a6a45);
      b.plain.box(sx + 0.4, SLAB_Y + 0.9, sz + 0.4, sx + 3.2, SLAB_Y + 1.25, sz + 2.0, rng.pick(GOODS_COLORS));
      b.plain.box(sx - 0.05, SLAB_Y, sz - 0.05, sx + 0.1, SLAB_Y + 2.4, sz + 0.1, 0x6b6e72);
      b.plain.box(sx + 3.5, SLAB_Y, sz - 0.05, sx + 3.65, SLAB_Y + 2.4, sz + 0.1, 0x6b6e72);
      b.plain.box(sx - 0.3, SLAB_Y + 2.4, sz - 0.3, sx + 3.9, SLAB_Y + 2.55, sz + 2.7, rng.pick(CANOPY_COLORS));
      out.colliders.push({ x0: sx - 0.3, z0: sz - 0.3, x1: sx + 3.9, z1: sz + 2.7 });
    }
  }
}

function addLighthouse(cx: number, cz: number, b: Builders, out: BuiltChunk): void {
  b.plain.box(cx - 7, SLAB_Y, cz - 7, cx + 7, SLAB_Y + 1.2, cz + 7, 0xcfc8ba);
  const bottom = SLAB_Y + 1.2;
  const topY = 26;
  const segments = 4;
  for (let k = 0; k < segments; k++) {
    const ya = bottom + ((topY - bottom) * k) / segments;
    const yb = bottom + ((topY - bottom) * (k + 1)) / segments;
    const ra = 4.2 - (1.6 * (ya - bottom)) / (topY - bottom);
    const rb = 4.2 - (1.6 * (yb - bottom)) / (topY - bottom);
    b.plain.frustum(cx, cz, ya, yb, ra, rb, 12, k % 2 === 0 ? 0xf5f5f0 : 0xc8372d);
  }
  b.plain.frustum(cx, cz, 26, 27, 3.6, 3.6, 12, 0x33363b);
  b.glow.frustum(cx, cz, 27, 30, 1.7, 1.7, 10, 0xfff1b0, 0xfff1b0);
  b.plain.frustum(cx, cz, 30, 32.6, 2.3, 0, 10, 0xc8372d);
  out.colliders.push({ x0: cx - 7, z0: cz - 7, x1: cx + 7, z1: cz + 7 });
}

function addBus(x: number, z: number, color: number, b: Builders, out: BuiltChunk): void {
  b.plain.box(x, SLAB_Y + 0.45, z, x + 5.8, SLAB_Y + 2.2, z + 2.1, color);
  b.plain.box(x + 0.4, SLAB_Y + 1.3, z - 0.03, x + 5.4, SLAB_Y + 1.9, z, 0x233042);
  b.plain.box(x + 0.4, SLAB_Y + 1.3, z + 2.1, x + 5.4, SLAB_Y + 1.9, z + 2.13, 0x233042);
  for (const wx of [x + 0.9, x + 4.2]) {
    b.plain.box(wx, SLAB_Y, z - 0.05, wx + 0.9, SLAB_Y + 0.75, z + 0.25, 0x1b1b1d);
    b.plain.box(wx, SLAB_Y, z + 1.85, wx + 0.9, SLAB_Y + 0.75, z + 2.15, 0x1b1b1d);
  }
  out.colliders.push({ x0: x, z0: z, x1: x + 5.8, z1: z + 2.1 });
}

function addStation(bx: number, bz: number, b: Builders, out: BuiltChunk, rng: Rng): void {
  for (const px of [bx + 18, bx + 62]) {
    for (const pz of [bz + 12, bz + 18]) {
      b.plain.box(px - 0.15, SLAB_Y, pz - 0.15, px + 0.15, SLAB_Y + 3.6, pz + 0.15, 0x555b61);
    }
  }
  b.plain.box(bx + 16, SLAB_Y + 3.6, bz + 10.5, bx + 64, SLAB_Y + 3.85, bz + 19.5, 0x2e8b57);
  b.plain.box(bx + 22, SLAB_Y, bz + 14, bx + 34, SLAB_Y + 0.5, bz + 15, 0x7a5a3a);
  b.plain.box(bx + 46, SLAB_Y, bz + 14, bx + 58, SLAB_Y + 0.5, bz + 15, 0x7a5a3a);
  for (const [x, z] of [
    [bx + 14, bz + 32],
    [bx + 40, bz + 32],
    [bx + 14, bz + 50],
    [bx + 40, bz + 50],
  ] as Array<[number, number]>) {
    addBus(x, z, rng.pick(BUS_COLORS), b, out);
  }
}
