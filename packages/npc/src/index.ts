import * as THREE from 'three';
import {
  type GameContext,
  type GameModule,
  type Heading,
  type PointOfInterest,
  type Rng,
  defineModule,
  isOpen,
} from '@accra/core';
import {
  BodyPhysics,
  type Person,
  type PersonSpec,
  type PersonTemplate,
  type Role,
  buildDetailedTemplate,
  buildTemplate,
  headLoadArms,
  idlePose,
  lerpPose,
  lookAt,
  phaseRate,
  randomSpec,
  startlePose,
  talkPose,
  umbrellaArm,
  walkPose,
  wavePose,
  wrapAngle,
} from '@accra/characters';
import { type Brain, type Intent, newBrain, paceFor, stepBrain, streetActivity } from './behavior';

export * from './behavior';

/**
 * NPC: the crowd (SRS section 8).
 * - Walkers follow the right-hand sidewalks, spawn near the player and recycle when far away.
 * - Some spawn as chatting pairs; shop and stall staff stand at their posts while open.
 * - People near the player are full animated figures (a limited number, by graphics tier). Everyone
 *   further out is drawn as a cheap instanced figure with the same colours.
 * - Reactions: glances, waves, stepping aside, flinching at horns, umbrellas and hurrying in rain.
 * - Crowd size and pace follow the time of day.
 */

const MAX_WALKERS = 90;
const MAX_VENDORS = 16;
const POOL = MAX_WALKERS + MAX_VENDORS;
const SPAWN_MIN = 40;
const SPAWN_MAX = 150;
const DESPAWN = 190;
const FULL_RADIUS = 32;
const FULL_BY_TIER = { low: 8, medium: 6, high: 10 } as const;
const VENDOR_KINDS: Record<string, Role> = { chopbar: 'vendor', kiosk: 'vendor', work: 'worker' };
const ARCHETYPES: Array<{ role: Role; count: number }> = [
  { role: 'commuter', count: 28 },
  { role: 'trader', count: 6 },
  { role: 'vendor', count: 8 },
  { role: 'worker', count: 6 },
];

interface Npc {
  active: boolean;
  x: number;
  z: number;
  heading: Heading;
  tx: number;
  tz: number;
  facing: number;
  /** For stationary staff: the way they face. */
  postFacing: number;
  speed: number;
  arch: number;
  brain: Brain;
  phase: number;
  seed: number;
  partner: number;
  post: string | null;
  postKind: string;
  person: Person | null;
  intent: Intent;
  relYaw: number;
  dist: number;
  arrived: boolean;
  /** Present only once the person has been knocked about. */
  body: BodyPhysics | null;
  locked: boolean;
  pdx: number;
  pdz: number;
  hitCd: number;
  lastHit: 'bump' | 'shove' | 'wall' | 'vehicle' | 'slip';
}

const IDLE_INTENT: Intent = { move: 0, lookAtPlayer: false, wave: false, startle: 0, umbrella: false, talking: false };

export function createNpcModule(): GameModule {
  let ctx: GameContext;
  let rng: Rng;
  let torso: THREE.InstancedMesh;
  let legs: THREE.InstancedMesh;
  let heads: THREE.InstancedMesh;
  const npcs: Npc[] = [];
  const archSpecs: PersonSpec[] = [];
  const templates = new Map<number, PersonTemplate>();
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const offs: Array<() => void> = [];
  let spawnTimer = 0;
  let vendorTimer = 0;
  let promoteTimer = 0;
  let clock = 0;
  let px = 0;
  let pz = 0;
  let pvx = 0;
  let pvz = 0;
  let pendingHonk: { x: number; z: number } | null = null;
  let scene: THREE.Scene;

  const archIndexFor = (role: Role): number => {
    let start = 0;
    for (const a of ARCHETYPES) {
      if (a.role === role) return start + rng.int(0, a.count - 1);
      start += a.count;
    }
    return 0;
  };

  const templateFor = (arch: number): PersonTemplate => {
    let t = templates.get(arch);
    if (!t) {
      // Phones on the low tier keep the light rigid figures; everyone else gets the detailed skinned ones.
      const spec = archSpecs[arch] as PersonSpec;
      t = ctx.services.get('render').tier() === 'low' ? buildTemplate(spec) : buildDetailedTemplate(spec, { textureSize: 128 });
      templates.set(arch, t);
    }
    return t;
  };

  const freeSlot = (): Npc | undefined => npcs.find((n) => !n.active);

  const reset = (n: Npc): void => {
    n.person?.detach();
    n.person = null;
    n.body = null;
    n.locked = false;
    n.active = false;
    n.partner = -1;
    n.post = null;
  };

  const place = (n: Npc, x: number, z: number, heading: Heading, role: Role): void => {
    n.active = true;
    n.x = x;
    n.z = z;
    n.heading = heading;
    n.arch = archIndexFor(role);
    n.brain = newBrain(rng);
    n.speed = 0;
    n.phase = rng.range(0, 6.28);
    n.seed = rng.range(0, 100);
    n.partner = -1;
    n.post = null;
    n.person = null;
    n.body = null;
    n.locked = false;
    n.pdx = n.pdz = n.hitCd = 0;
    n.intent = IDLE_INTENT;
    n.arrived = false;
  };

  const setNext = (n: Npc, from: { x: number; z: number }): void => {
    const world = ctx.services.get('world');
    const next = world.nextWaypoint(from, n.heading, 'pedestrian', rng);
    n.heading = next.heading;
    n.tx = next.x;
    n.tz = next.z;
  };

  const walkerCount = (): number => npcs.reduce((c, n) => c + (n.active && !n.post ? 1 : 0), 0);

  const spawnWalkers = (): void => {
    const world = ctx.services.get('world');
    const wp = world.randomLanePoint(px, pz, SPAWN_MIN, SPAWN_MAX, 'pedestrian', rng);
    if (!wp || !world.isLoaded(wp.x, wp.z)) return;
    const first = freeSlot();
    if (!first) return;
    const role: Role = rng.chance(0.08) ? 'trader' : 'commuter';
    place(first, wp.x, wp.z, wp.heading, role);
    setNext(first, wp);
    first.facing = Math.atan2(first.tx - first.x, first.tz - first.z);

    // Sometimes a pair stops to talk. Both leave together afterwards.
    if (role === 'commuter' && rng.chance(0.25)) {
      const second = freeSlot();
      if (!second) return;
      const dir = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ][first.heading] as [number, number];
      place(second, wp.x - dir[0] * 0.95, wp.z - dir[1] * 0.95, first.heading, 'commuter');
      second.tx = first.tx;
      second.tz = first.tz;
      const dur = rng.range(25, 70);
      for (const [a, b] of [[first, second], [second, first]] as const) {
        a.brain.mode = 'chat';
        a.brain.timer = dur;
      }
      first.partner = npcs.indexOf(second);
      second.partner = npcs.indexOf(first);
      first.facing = Math.atan2(second.x - first.x, second.z - first.z);
      second.facing = Math.atan2(first.x - second.x, first.z - second.z);
    }
  };

  const streetFacing = (x: number, z: number): { x: number; z: number; alongX: boolean } => {
    const pitch = ctx.services.get('world').chunkSize / 2;
    const dx = Math.abs(x - Math.round(x / pitch) * pitch);
    const dz = Math.abs(z - Math.round(z / pitch) * pitch);
    // The street runs along x when the point is close to a z road line.
    return dz < dx ? { x: 0, z: Math.sign(Math.round(z / pitch) * pitch - z) || 1, alongX: true } : { x: Math.sign(Math.round(x / pitch) * pitch - x) || 1, z: 0, alongX: false };
  };

  const spawnStaff = (hour: number): void => {
    const world = ctx.services.get('world');
    const staffed = new Set(npcs.filter((n) => n.active && n.post).map((n) => n.post as string));
    if (staffed.size >= MAX_VENDORS) return;
    for (const kind of Object.keys(VENDOR_KINDS)) {
      if (!isOpen(kind, hour)) continue;
      for (const poi of world.pointsOfInterest(kind) as readonly PointOfInterest[]) {
        if (staffed.has(poi.id)) continue;
        if (Math.hypot(poi.x - px, poi.z - pz) > 120) continue;
        if (!world.isLoaded(poi.x, poi.z)) continue;
        const slot = freeSlot();
        if (!slot) return;
        const face = streetFacing(poi.x, poi.z);
        // Stand a couple of metres along the pavement from the counter, facing the street.
        const sx = poi.x + (face.alongX ? 2 : 0);
        const sz = poi.z + (face.alongX ? 0 : 2);
        place(slot, sx, sz, 0, VENDOR_KINDS[kind] as Role);
        slot.post = poi.id;
        slot.postKind = kind;
        slot.brain = newBrain(rng, 'stand');
        slot.postFacing = Math.atan2(face.x, face.z);
        slot.facing = slot.postFacing;
        slot.tx = sx;
        slot.tz = sz;
        staffed.add(poi.id);
        if (staffed.size >= MAX_VENDORS) return;
      }
    }
  };

  const demote = (n: Npc): void => {
    n.person?.detach();
    n.person = null;
    n.body = null;
    n.locked = false;
  };

  const updatePromotion = (): void => {
    const maxFull = FULL_BY_TIER[ctx.services.get('render').tier()];
    let count = 0;
    for (const n of npcs) {
      if (!n.person) continue;
      if (!n.active || n.dist > FULL_RADIUS + 8) demote(n);
      else if (n.locked) continue;
      else count++;
    }
    let nearest: Npc | null = null;
    for (const n of npcs) {
      if (n.active && !n.person && n.dist < FULL_RADIUS && (!nearest || n.dist < nearest.dist)) nearest = n;
    }
    if (!nearest) return;
    if (count >= maxFull) {
      let farthest: Npc | null = null;
      for (const n of npcs) if (n.person && (!farthest || n.dist > farthest.dist)) farthest = n;
      if (!farthest || nearest.dist + 6 >= farthest.dist) return;
      demote(farthest);
    }
    const person = templateFor(nearest.arch).instantiate();
    nearest.person = person;
    scene.add(person.root);
  };

  /** Knock a pedestrian about. Makes them a full figure on the spot so the fall can be seen. */
  const knock = (n: Npc, dirX: number, dirZ: number, strength: number, kind: 'bump' | 'shove' | 'wall' | 'vehicle' | 'slip'): void => {
    if (n.hitCd > 0 && kind !== 'vehicle') return;
    if (!n.person) {
      const person = templateFor(n.arch).instantiate();
      n.person = person;
      scene.add(person.root);
    }
    const person = n.person;
    if (!n.body) n.body = new BodyPhysics(person.dims.hipY);
    n.hitCd = 0.8;
    n.lastHit = kind;
    n.body.hit({ dirX, dirZ, strength, kind }, n.facing);
    n.locked = true;
    n.speed = 0;
    pendingHonk = { x: n.x, z: n.z };
    ctx.events.emit('npcImpact', { x: n.x, z: n.z, strength, kind, thud: false });
  };

  const collisions = (n: Npc, dt: number): void => {
    n.hitCd -= dt;
    if (n.dist > 45 || n.locked) return;
    const veh = ctx.services.tryGet('vehicles')?.collide(n.x, n.z, 0.3);
    if (veh) return knock(n, veh.dirX, veh.dirZ, 3.5 + veh.speed * 0.85, 'vehicle');
    // The player running into a pedestrian.
    if (n.dist < 0.9) {
      const playerSvc = ctx.services.get('player');
      if (playerSvc.isDown()) return;
      const ux = (n.x - px) / (n.dist || 1);
      const uz = (n.z - pz) / (n.dist || 1);
      const rel = pvx * ux + pvz * uz;
      if (rel > 2.6) {
        knock(n, ux, uz, rel * 0.95, rel > 5.4 ? 'shove' : 'bump');
        if (rel > 5) playerSvc.applyImpact({ dirX: -ux, dirZ: -uz, strength: rel * 0.55, kind: 'bump' });
      }
    }
  };

  const simulate = (n: Npc, dt: number, hour: number, raining: boolean): void => {
    const world = ctx.services.get('world');
    const dx = px - n.x;
    const dz = pz - n.z;
    n.dist = Math.hypot(dx, dz);

    if (n.dist > DESPAWN || !world.isLoaded(n.x, n.z)) return reset(n);
    if (n.post && !isOpen(n.postKind, hour)) return reset(n);

    collisions(n, dt);
    if (n.locked) {
      // On the floor or reeling: the body physics moves them; the brain waits.
      const world2 = ctx.services.get('world');
      const r = world2.resolveCollision(n.x + n.pdx, n.z + n.pdz, 0.3);
      n.x = r.x;
      n.z = r.z;
      n.pdx = n.pdz = 0;
      n.speed = 0;
      return;
    }
    n.relYaw = wrapAngle(Math.atan2(dx, dz) - n.facing);
    const toNpcX = -dx;
    const toNpcZ = -dz;
    const approaching = pvx * toNpcX + pvz * toNpcZ > 0;
    const playerSpeed = Math.hypot(pvx, pvz);
    const ahead = approaching && Math.abs(n.relYaw) < 0.7 ? n.dist : Infinity;
    const honkDist = pendingHonk ? Math.hypot(pendingHonk.x - n.x, pendingHonk.z - n.z) : Infinity;

    const intent = stepBrain(
      n.brain,
      {
        dt,
        hour,
        raining,
        distToPlayer: n.dist,
        playerRelYaw: n.relYaw,
        playerSpeed,
        playerAhead: ahead,
        honkDist,
        arrived: n.arrived,
      },
      rng,
    );
    n.arrived = false;
    n.intent = intent;

    const wanted = n.brain.baseSpeed * paceFor(hour) * intent.move;
    const accel = 3 * dt;
    n.speed += Math.max(-accel * 1.5, Math.min(accel, wanted - n.speed));
    if (n.speed < 0.02) n.speed = 0;

    let desired = n.facing;
    if (n.post) {
      desired = n.postFacing;
      const p = npcs[n.partner];
      if (p?.active) desired = Math.atan2(p.x - n.x, p.z - n.z);
    } else {
      desired = Math.atan2(n.tx - n.x, n.tz - n.z);
    }
    n.facing += wrapAngle(desired - n.facing) * Math.min(1, dt * 7);

    if (n.post || n.speed <= 0) return;
    const mx = n.tx - n.x;
    const mz = n.tz - n.z;
    const dist = Math.hypot(mx, mz);
    const step = n.speed * dt;
    if (dist <= step + 0.2) {
      n.x = n.tx;
      n.z = n.tz;
      setNext(n, n);
      n.arrived = true;
    } else {
      n.x += (mx / dist) * step;
      n.z += (mz / dist) * step;
    }
  };

  const poseFor = (n: Npc, person: Person, dt: number): void => {
    const t = clock + n.seed;
    const it = n.intent;
    n.phase += n.speed * dt * phaseRate(1.5);
    let pose;
    if (n.speed > 0.15) {
      pose = walkPose({ phase: n.phase, speed: n.speed, walkSpeed: 1.4, runSpeed: 3.8 });
    } else if (it.talking || n.post) {
      const w = n.post ? 0.2 + 0.2 * Math.sin(t * 0.4) : 0.5 + 0.5 * Math.sin(t * 0.5);
      pose = lerpPose(idlePose(t, n.seed), talkPose(t, n.seed), Math.max(0, Math.min(1, w)));
    } else {
      pose = idlePose(t, n.seed);
    }
    if (it.umbrella) umbrellaArm(pose);
    else if (person.spec.accessory === 'headLoad') headLoadArms(pose);
    else if (it.wave) {
      const w = wavePose(t);
      pose.rShRoll = w.rShRoll;
      pose.rSh = w.rSh;
      pose.rEl = w.rEl;
    }
    if (it.startle > 0) startlePose(pose, it.startle);
    if (it.lookAtPlayer) lookAt(pose, n.relYaw);
    person.umbrella.visible = it.umbrella;
    if (n.body) {
      const out = n.body.step(Math.min(dt, 0.05), pose);
      n.pdx += out.dx;
      n.pdz += out.dz;
      const was = n.locked;
      n.locked = out.locked;
      if (out.thud > 0) ctx.events.emit('npcImpact', { x: n.x, z: n.z, strength: out.thud * 9, kind: n.lastHit, thud: true });
      if (was && !out.locked) n.brain.startle = 1;
      person.animate(out.pose, dt, out.mode === 'ok' ? 12 : out.mode === 'stagger' ? 24 : 60);
      if (!n.locked && out.mode === 'ok') n.body = null;
      return;
    }
    person.animate(pose, dt, 12);
  };

  const draw = (dt: number): void => {
    const world = ctx.services.get('world');
    let far = 0;
    for (const n of npcs) {
      if (!n.active) continue;
      const gy = world.groundHeightAt(n.x, n.z);
      if (n.person) {
        n.person.root.position.set(n.x, gy, n.z);
        n.person.root.rotation.y = n.facing;
        poseFor(n, n.person, dt);
        continue;
      }
      const spec = archSpecs[n.arch] as PersonSpec;
      const s = spec.height / 1.75;
      dummy.rotation.set(0, n.facing, 0);
      dummy.scale.set(s, s, s);
      dummy.position.set(n.x, gy + 0.43 * s, n.z);
      dummy.updateMatrix();
      legs.setMatrixAt(far, dummy.matrix);
      legs.setColorAt(far, color.setHex(spec.outfit === 'dress' || spec.outfit === 'kaftan' || spec.outfit === 'workwear' ? spec.top : spec.bottom));
      dummy.position.set(n.x, gy + 1.15 * s, n.z);
      dummy.updateMatrix();
      torso.setMatrixAt(far, dummy.matrix);
      torso.setColorAt(far, color.setHex(spec.top));
      dummy.position.set(n.x, gy + 1.58 * s, n.z);
      dummy.updateMatrix();
      heads.setMatrixAt(far, dummy.matrix);
      heads.setColorAt(far, color.setHex(spec.skin));
      far++;
    }
    for (const mesh of [torso, legs, heads]) {
      mesh.count = far;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  };

  return defineModule({
    id: 'npc',
    version: '0.3.0',
    dependsOn: ['world', 'env', 'player', 'perf'],

    init(context) {
      ctx = context;
      rng = ctx.rng.fork('npc');
      scene = ctx.services.get('render').scene;

      for (const { role, count } of ARCHETYPES) {
        const r = ctx.rng.fork(`npc-arch-${role}`);
        for (let i = 0; i < count; i++) {
          archSpecs.push(randomSpec(r, role));
        }
      }

      const mat = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ roughness: 0.85 });
      torso = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.6, 0.26), mat(), POOL);
      legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.86, 0.2), mat(), POOL);
      heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 10, 8), mat(), POOL);
      for (const mesh of [torso, legs, heads]) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3);
        mesh.frustumCulled = false;
        mesh.count = 0;
        scene.add(mesh);
      }

      for (let i = 0; i < POOL; i++) {
        npcs.push({
          active: false, x: 0, z: 0, heading: 0, tx: 0, tz: 0, facing: 0, postFacing: 0, speed: 0, arch: 0,
          brain: newBrain(rng), phase: 0, seed: 0, partner: -1, post: null, postKind: '', person: null,
          intent: IDLE_INTENT, relYaw: 0, dist: 1e9, arrived: false,
          body: null, locked: false, pdx: 0, pdz: 0, hitCd: 0, lastHit: 'bump',
        });
      }

      ctx.onRender(500, (dt) => draw(dt));
      offs.push(
        ctx.events.on('honk', ({ x, z }) => (pendingHonk = { x, z })),
        ctx.events.on('impact', ({ x, z, strength, thud }) => {
          if (!thud && strength >= 4.2) pendingHonk = { x, z };
        }),
      );
    },

    start() {
      for (const n of npcs) reset(n);
    },

    update(dt) {
      clock += dt;
      const env = ctx.services.get('env');
      const hour = env.now().hour;
      const w = env.weather();
      const raining = w === 'lightRain' || w === 'heavyRain' || w === 'thunderstorm';
      const player = ctx.services.get('player').position();
      pvx = (player.x - px) / dt;
      pvz = (player.z - pz) / dt;
      if (Math.abs(pvx) > 20 || Math.abs(pvz) > 20) {
        // A teleport (trotro, fainting), not walking.
        pvx = 0;
        pvz = 0;
      }
      px = player.x;
      pz = player.z;

      for (const n of npcs) if (n.active) simulate(n, dt, hour, raining);
      pendingHonk = null;

      spawnTimer -= dt;
      const target = Math.round(MAX_WALKERS * ctx.config.crowdDensity * streetActivity(hour));
      if (spawnTimer <= 0 && walkerCount() < target) {
        spawnTimer = 0.15;
        spawnWalkers();
      }
      vendorTimer -= dt;
      if (vendorTimer <= 0) {
        vendorTimer = 1;
        spawnStaff(hour);
      }
      promoteTimer -= dt;
      if (promoteTimer <= 0) {
        promoteTimer = 0.2;
        updatePromotion();
      }
    },

    dispose() {
      for (const off of offs) off();
      for (const n of npcs) n.person?.detach();
      for (const t of templates.values()) t.dispose();
      for (const mesh of [torso, legs, heads]) {
        if (!mesh) continue;
        mesh.removeFromParent();
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.dispose();
      }
    },
  });
}
