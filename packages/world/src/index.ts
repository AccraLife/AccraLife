import * as THREE from 'three';
import {
  type GameContext,
  type GameModule,
  type Heading,
  type Landmark,
  type PointOfInterest,
  type RenderService,
  type SurfaceKind,
  type TravelKind,
  type Vec2,
  type Waypoint,
  type WorldService,
  Rng,
  defineModule,
} from '@accra/core';
import { type BuiltChunk, type WorldMaterials, chunkJob } from './chunk';
import {
  type Aabb,
  CHUNK_SIZE,
  EDGE,
  SIDEWALK_OUTER,
  SLAB_Y,
  chunkIndex,
  chunkKey,
  chunkValid,
  clamp,
  distToLine,
  isRoadAt,
  nextWaypoint as gridNextWaypoint,
  pushOutOfBoxes,
  randomLanePoint as gridRandomLanePoint,
} from './grid';
import { LANDMARKS, LANDMARK_RADIUS, allPois } from './layout';
import { LabelFactory, createWindowTextures } from './textures';

export * from './grid';
export * from './layout';

/**
 * WLD: world and map (SRS section 5).
 * Streams chunks of a procedural street grid around the player. Real map data (OpenStreetMap)
 * will replace `layout.ts` later; the service contract stays the same.
 */

interface Job {
  chunk: BuiltChunk;
  gen: Generator<void, void, void>;
}

const DISTRICT = { id: 'central', name: 'Accra Central (prototype)' };
const SPAWN: Vec2 = { x: -20, z: 7.2 };
const JOB_BUDGET_MS = 6;

export function createWorldModule(): GameModule {
  let ctx: GameContext;
  let render: RenderService;
  let root: THREE.Group;
  let ground: THREE.Mesh;
  let mats: WorldMaterials;
  let wallMat: THREE.MeshStandardMaterial;
  let plainMat: THREE.MeshStandardMaterial;
  let glowMat: THREE.MeshBasicMaterial;
  let beaconMat: THREE.MeshBasicMaterial;
  let labels: LabelFactory;
  let textures: ReturnType<typeof createWindowTextures>;

  const chunks = new Map<string, BuiltChunk>();
  const jobs = new Map<string, Job>();
  const pois: PointOfInterest[] = [];
  const discovered = new Set<string>();
  const scratch: Aabb[] = [];
  const offs: Array<() => void> = [];

  let focus: Vec2 = { ...SPAWN };
  let inDistrict = false;
  let night = 0;
  let rain = 0;
  let power = true;
  let frame = 0;

  const startJob = (cx: number, cz: number): Job => {
    const key = chunkKey(cx, cz);
    const group = new THREE.Group();
    group.name = `chunk ${key}`;
    const chunk: BuiltChunk = { key, cx, cz, group, colliders: [], geometries: [], sprites: [] };
    const job: Job = { chunk, gen: chunkJob(cx, cz, ctx.config.seed, mats, chunk) };
    jobs.set(key, job);
    return job;
  };

  const finishJob = (job: Job): void => {
    jobs.delete(job.chunk.key);
    root.add(job.chunk.group);
    chunks.set(job.chunk.key, job.chunk);
    ctx.events.emit('chunkLoaded', { key: job.chunk.key });
  };

  const unloadChunk = (c: BuiltChunk): void => {
    root.remove(c.group);
    for (const g of c.geometries) g.dispose();
    chunks.delete(c.key);
    ctx.events.emit('chunkUnloaded', { key: c.key });
  };

  const applyLighting = (): void => {
    const lit = night * (power ? 1 : 0.08);
    wallMat.emissiveIntensity = lit * 1.6;
    glowMat.color.setScalar(0.4 + 0.6 * lit);
    plainMat.color.setScalar(1 - 0.3 * rain);
    plainMat.roughness = 0.95 - 0.45 * rain;
  };

  const service: WorldService = {
    chunkSize: CHUNK_SIZE,
    bounds: { minX: -EDGE, maxX: EDGE, minZ: -EDGE, maxZ: EDGE },
    spawnPoint: () => ({ ...SPAWN }),
    groundHeightAt: (x, z) => (isRoadAt(x, z) ? 0 : SLAB_Y),
    surfaceAt(x, z): SurfaceKind {
      if (isRoadAt(x, z)) return 'road';
      if (distToLine(x) <= SIDEWALK_OUTER || distToLine(z) <= SIDEWALK_OUTER) return 'sidewalk';
      return 'ground';
    },
    resolveCollision(x, z, r) {
      const px = clamp(x, -EDGE + r, EDGE - r);
      const pz = clamp(z, -EDGE + r, EDGE - r);
      scratch.length = 0;
      const m = r + 0.5;
      for (let cj = chunkIndex(pz - m); cj <= chunkIndex(pz + m); cj++) {
        for (let ci = chunkIndex(px - m); ci <= chunkIndex(px + m); ci++) {
          const c = chunks.get(chunkKey(ci, cj));
          if (!c) continue;
          for (const box of c.colliders) {
            if (box.x1 < px - m || box.x0 > px + m || box.z1 < pz - m || box.z0 > pz + m) continue;
            scratch.push(box);
          }
        }
      }
      const out = pushOutOfBoxes(px, pz, r, scratch);
      return { x: clamp(out.x, -EDGE + r, EDGE - r), z: clamp(out.z, -EDGE + r, EDGE - r) };
    },
    districtAt: (x, z) => (Math.abs(x) <= EDGE && Math.abs(z) <= EDGE ? DISTRICT : null),
    isLoaded: (x, z) => chunks.has(chunkKey(chunkIndex(x), chunkIndex(z))),
    loadedChunkCount: () => chunks.size,
    async ensureLoaded(x, z, radiusChunks) {
      const fcx = chunkIndex(x);
      const fcz = chunkIndex(z);
      for (let dz = -radiusChunks; dz <= radiusChunks; dz++) {
        for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
          const cx = fcx + dx;
          const cz = fcz + dz;
          if (!chunkValid(cx, cz) || chunks.has(chunkKey(cx, cz))) continue;
          const job = jobs.get(chunkKey(cx, cz)) ?? startJob(cx, cz);
          for (;;) {
            if (job.gen.next().done) break;
          }
          finishJob(job);
        }
      }
    },
    nextWaypoint: (from: Vec2, heading: Heading, kind: TravelKind, rng: Rng): Waypoint =>
      gridNextWaypoint(from, heading, kind, rng),
    randomLanePoint: (x, z, minDist, maxDist, kind, rng) => gridRandomLanePoint(x, z, minDist, maxDist, kind, rng),
    landmarks: (): readonly Landmark[] => LANDMARKS,
    pointsOfInterest: (kind?: string): readonly PointOfInterest[] =>
      kind ? pois.filter((p) => p.kind === kind) : pois,
    nearestPoi(x, z, maxDist) {
      let best: PointOfInterest | null = null;
      let bestD = maxDist;
      for (const p of pois) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d <= bestD) {
          best = p;
          bestD = d;
        }
      }
      return best;
    },
  };

  return defineModule({
    id: 'world',
    version: '0.1.0',
    dependsOn: ['perf'],
    alwaysUpdate: true,

    async init(context) {
      ctx = context;
      render = ctx.services.get('render');

      textures = createWindowTextures(ctx.config.seed);
      labels = new LabelFactory();
      wallMat = new THREE.MeshStandardMaterial({
        map: textures.map,
        emissiveMap: textures.emissive,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0,
        vertexColors: true,
        roughness: 0.9,
        metalness: 0,
      });
      plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
      glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
      beaconMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      });
      mats = { walls: wallMat, plain: plainMat, glow: glowMat, beacon: beaconMat, labels };

      root = new THREE.Group();
      root.name = 'world';
      render.scene.add(root);

      ground = new THREE.Mesh(
        new THREE.PlaneGeometry(7000, 7000),
        new THREE.MeshStandardMaterial({ color: 0x6e9a52, roughness: 1 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.06;
      root.add(ground);

      pois.push(...allPois(ctx.config.seed));
      ctx.services.register('world', service);

      offs.push(
        ctx.events.on('lightingChanged', (e) => {
          night = e.night;
          rain = e.rain;
          applyLighting();
        }),
        ctx.events.on('powerChanged', (e) => {
          power = e.on;
          applyLighting();
        }),
        ctx.events.on('playerMoved', (e) => {
          focus = { x: e.x, z: e.z };
          const inside = service.districtAt(e.x, e.z) !== null;
          if (inside && !inDistrict) {
            inDistrict = true;
            ctx.events.emit('districtEntered', { id: DISTRICT.id, name: DISTRICT.name });
          } else if (!inside && inDistrict) {
            inDistrict = false;
            ctx.events.emit('districtExited', { id: DISTRICT.id });
          }
          for (const lm of LANDMARKS) {
            if (discovered.has(lm.id)) continue;
            if (Math.hypot(lm.x - e.x, lm.z - e.z) <= LANDMARK_RADIUS) {
              discovered.add(lm.id);
              ctx.events.emit('landmarkDiscovered', { id: lm.id, name: lm.name });
            }
          }
        }),
      );
      applyLighting();

      // Build the area around the spawn point now so the player never sees an empty world.
      await service.ensureLoaded(SPAWN.x, SPAWN.z, 1);

      ctx.onRender(10, () => {
        ground.position.x = focus.x;
        ground.position.z = focus.z;
        frame++;
        if (frame % 10 === 0) {
          const cam = render.camera.position;
          for (const c of chunks.values()) {
            for (const s of c.sprites) {
              s.visible = Math.hypot(s.position.x - cam.x, s.position.z - cam.z) < 130;
            }
          }
        }
      });
    },

    update() {
      const fcx = chunkIndex(focus.x);
      const fcz = chunkIndex(focus.z);
      const r = ctx.config.viewRadius;
      const far = (c: { cx: number; cz: number }): number => Math.max(Math.abs(c.cx - fcx), Math.abs(c.cz - fcz));

      for (const c of [...chunks.values()]) {
        if (far(c) > r + 1) unloadChunk(c);
      }
      for (const [key, job] of [...jobs]) {
        if (far(job.chunk) > r + 1) {
          job.gen.return();
          jobs.delete(key);
        }
      }
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const cx = fcx + dx;
          const cz = fcz + dz;
          const key = chunkKey(cx, cz);
          if (!chunkValid(cx, cz) || chunks.has(key) || jobs.has(key)) continue;
          startJob(cx, cz);
        }
      }

      if (jobs.size === 0) return;
      const list = [...jobs.values()].sort((a, b) => far(a.chunk) - far(b.chunk));
      const start = performance.now();
      outer: for (const job of list) {
        for (;;) {
          const res = job.gen.next();
          if (res.done) {
            finishJob(job);
            break;
          }
          if (performance.now() - start > JOB_BUDGET_MS) break outer;
        }
      }
    },

    serialize() {
      return { discovered: [...discovered] };
    },

    deserialize(data) {
      const d = data as { discovered?: string[] } | null;
      discovered.clear();
      for (const id of d?.discovered ?? []) discovered.add(id);
    },

    dispose() {
      for (const off of offs) off();
      for (const c of chunks.values()) {
        for (const g of c.geometries) g.dispose();
      }
      for (const job of jobs.values()) job.gen.return();
      chunks.clear();
      jobs.clear();
      root.removeFromParent();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      textures.map.dispose();
      textures.emissive.dispose();
      wallMat.dispose();
      plainMat.dispose();
      glowMat.dispose();
      beaconMat.dispose();
      labels.dispose();
    },
  });
}
