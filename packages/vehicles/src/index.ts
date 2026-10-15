import * as THREE from 'three';
import {
  type GameContext,
  type GameModule,
  type Heading,
  PRICES,
  type Rng,
  type VehicleHit,
  type VehicleService,
  TROTRO_MINUTES,
  defineModule,
} from '@accra/core';

/**
 * VEH: traffic and the trotro (SRS section 9, first slice).
 * Instanced cars and trotros keep right on the street grid, slow for whatever is ahead and honk at the player.
 * There are no traffic lights yet: vehicles only queue behind others going the same way.
 * Riding a trotro between the two stations costs a fare and moves the clock forward.
 */

const MAX_VEHICLES = 36;
const SPAWN_MIN = 60;
const SPAWN_MAX = 190;
const DESPAWN = 230;
const CRUISE = 9;
const LOOK_AHEAD = 11;
const CAR_COLOURS = [0xd9d9d9, 0x1f1f23, 0xb02a2a, 0x2a5db0, 0xe8e2c8, 0x3a7d44, 0x8a8f99];
const TROTRO_COLOUR = 0xf2c230;

interface Vehicle {
  active: boolean;
  trotro: boolean;
  x: number;
  z: number;
  heading: Heading;
  tx: number;
  tz: number;
  speed: number;
  colour: number;
  blockedFor: number;
  /** Seconds left of braking hard after hitting someone. */
  halt: number;
}

export function createVehiclesModule(): GameModule {
  let ctx: GameContext;
  let body: THREE.InstancedMesh;
  let cabin: THREE.InstancedMesh;
  let rng: Rng;
  const vehicles: Vehicle[] = [];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let spawnTimer = 0;
  let hornCooldown = 0;
  let riding = false;
  const offs: Array<() => void> = [];

  const target = (): number => {
    const night = ctx.services.get('env').nightFactor();
    return Math.round(MAX_VEHICLES * ctx.config.trafficDensity * (1 - 0.7 * night));
  };

  const spawn = (v: Vehicle, px: number, pz: number): void => {
    const world = ctx.services.get('world');
    const wp = world.randomLanePoint(px, pz, SPAWN_MIN, SPAWN_MAX, 'vehicle', rng);
    if (!wp || !world.isLoaded(wp.x, wp.z)) return;
    // Do not spawn on top of another vehicle.
    for (const o of vehicles) {
      if (o.active && Math.hypot(o.x - wp.x, o.z - wp.z) < 12) return;
    }
    const next = world.nextWaypoint(wp, wp.heading, 'vehicle', rng);
    v.active = true;
    v.trotro = rng.chance(0.2);
    v.x = wp.x;
    v.z = wp.z;
    v.heading = next.heading;
    v.tx = next.x;
    v.tz = next.z;
    v.speed = 0;
    v.colour = v.trotro ? TROTRO_COLOUR : (CAR_COLOURS[rng.int(0, CAR_COLOURS.length - 1)] as number);
    v.blockedFor = 0;
    v.halt = 0;
  };

  /** Distance to the nearest thing ahead that we should stop for, or Infinity. */
  const obstacleAhead = (v: Vehicle, fx: number, fz: number, px: number, pz: number): number => {
    let best = Infinity;
    const check = (ox: number, oz: number, lateralLimit: number): void => {
      const rx = ox - v.x;
      const rz = oz - v.z;
      const along = rx * fx + rz * fz;
      if (along <= 0 || along > LOOK_AHEAD) return;
      const lateral = Math.abs(rx * -fz + rz * fx);
      if (lateral < lateralLimit && along < best) best = along;
    };
    check(px, pz, 2.2);
    for (const o of vehicles) {
      if (o === v || !o.active || o.heading !== v.heading) continue;
      check(o.x, o.z, 1.8);
    }
    return best;
  };

  const service: VehicleService = {
    collide(x, z, radius): VehicleHit | null {
      for (const v of vehicles) {
        if (!v.active || v.speed < 0.8) continue;
        const dx = v.tx - v.x;
        const dz = v.tz - v.z;
        const len = Math.hypot(dx, dz) || 1;
        const fx = dx / len;
        const fz = dz / len;
        const sl = v.trotro ? 1.25 : 1;
        const rx = x - v.x;
        const rz = z - v.z;
        const along = rx * fx + rz * fz;
        const lateral = rx * -fz + rz * fx;
        if (Math.abs(along) < 2.1 * sl + radius && Math.abs(lateral) < 0.95 + radius) {
          const speed = v.speed;
          v.halt = 2;
          v.speed *= 0.4;
          return { dirX: fx, dirZ: fz, speed };
        }
      }
      return null;
    },
  };

  const draw = (): void => {
    const world = ctx.services.get('world');
    let n = 0;
    for (const v of vehicles) {
      if (!v.active) continue;
      const yaw = Math.atan2(v.tz - v.z, v.tx - v.x);
      const gy = world.groundHeightAt(v.x, v.z);
      const sl = v.trotro ? 1.25 : 1;
      const sh = v.trotro ? 1.45 : 1;
      dummy.rotation.set(0, -yaw, 0);
      dummy.position.set(v.x, gy + 0.75 * sh, v.z);
      dummy.scale.set(sl, sh, 1);
      dummy.updateMatrix();
      body.setMatrixAt(n, dummy.matrix);
      color.setHex(v.colour);
      body.setColorAt(n, color);
      // Cabin sits on top and slightly back; on a trotro it is nearly full length.
      const back = v.trotro ? 0 : -0.25;
      const cabinLen = v.trotro ? 0.9 : 0.5;
      dummy.position.set(
        v.x + Math.cos(yaw) * back * 4.2 * sl,
        gy + 1.5 * sh + (v.trotro ? 0.15 : 0),
        v.z + Math.sin(yaw) * back * 4.2 * sl,
      );
      dummy.scale.set(sl * cabinLen, sh * (v.trotro ? 0.9 : 1), 0.92);
      dummy.updateMatrix();
      cabin.setMatrixAt(n, dummy.matrix);
      n++;
    }
    body.count = n;
    cabin.count = n;
    body.instanceMatrix.needsUpdate = true;
    cabin.instanceMatrix.needsUpdate = true;
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
  };

  const ride = (stationId: string): void => {
    if (riding) return;
    const world = ctx.services.get('world');
    const stops = world.pointsOfInterest('trotro');
    const here = stops.find((p) => p.id === stationId);
    const there = stops.find((p) => p.id !== stationId);
    if (!here || !there) return;
    const eco = ctx.services.get('economy');
    if (!eco.charge(PRICES.fare, 'Trotro fare')) {
      ctx.events.emit('notify', { text: `The fare is ${eco.format(PRICES.fare)}. You are short of cash.`, kind: 'warn' });
      return;
    }
    riding = true;
    ctx.events.emit('activityStarted', { label: `Riding to ${there.name.replace(' (trotro)', '')}...`, seconds: 3 });
    ctx.services.get('env').advanceMinutes(TROTRO_MINUTES);
    void world
      .ensureLoaded(there.x, there.z, 1)
      .then(() => {
        ctx.services.get('player').teleport(there.x, there.z);
        ctx.events.emit('notify', { text: `You arrived at ${there.name.replace(' (trotro)', '')}. (-${eco.format(PRICES.fare)})`, kind: 'good' });
        ctx.services.get('missions').report('rode');
      })
      .finally(() => {
        riding = false;
      });
  };

  return defineModule({
    id: 'vehicles',
    version: '0.2.0',
    dependsOn: ['world', 'env', 'player', 'economy', 'perf'],

    init(context) {
      ctx = context;
      rng = ctx.rng.fork('vehicles');
      const render = ctx.services.get('render');
      body = new THREE.InstancedMesh(
        new THREE.BoxGeometry(4.2, 1.0, 1.9),
        new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.2 }),
        MAX_VEHICLES,
      );
      cabin = new THREE.InstancedMesh(
        new THREE.BoxGeometry(4.2, 0.6, 1.9),
        new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.3, metalness: 0.4 }),
        MAX_VEHICLES,
      );
      body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_VEHICLES * 3), 3);
      for (const mesh of [body, cabin]) {
        mesh.frustumCulled = false;
        mesh.count = 0;
      }
      for (let i = 0; i < MAX_VEHICLES; i++) {
        vehicles.push({ active: false, trotro: false, x: 0, z: 0, heading: 0, tx: 0, tz: 0, speed: 0, colour: 0xffffff, blockedFor: 0, halt: 0 });
      }
      render.scene.add(body, cabin);
      ctx.services.register('vehicles', service);
      ctx.onRender(500, () => draw());
      offs.push(
        ctx.events.on('interactionStarted', ({ kind, targetId }) => {
          if (kind === 'trotro') ride(targetId);
        }),
      );
    },

    start() {
      for (const v of vehicles) v.active = false;
      riding = false;
    },

    update(dt) {
      const world = ctx.services.get('world');
      const player = ctx.services.get('player').position();
      hornCooldown -= dt;

      let active = 0;
      for (const v of vehicles) {
        if (!v.active) continue;
        if (Math.hypot(v.x - player.x, v.z - player.z) > DESPAWN || !world.isLoaded(v.x, v.z)) {
          v.active = false;
          continue;
        }
        active++;
        const dx = v.tx - v.x;
        const dz = v.tz - v.z;
        const dist = Math.hypot(dx, dz) || 1;
        const fx = dx / dist;
        const fz = dz / dist;

        const gap = obstacleAhead(v, fx, fz, player.x, player.z);
        v.halt = Math.max(0, v.halt - dt);
        const desired = v.halt > 0 || gap < 4 ? 0 : gap < LOOK_AHEAD ? CRUISE * ((gap - 4) / (LOOK_AHEAD - 4)) : CRUISE;
        const rate = desired < v.speed ? 14 : 4;
        v.speed += Math.sign(desired - v.speed) * Math.min(Math.abs(desired - v.speed), rate * dt);

        if (desired === 0 && v.speed < 0.5) {
          v.blockedFor += dt;
          const nearPlayer = Math.hypot(v.x - player.x, v.z - player.z) < 14;
          if (nearPlayer && v.blockedFor > 1.5 && hornCooldown <= 0) {
            hornCooldown = 3;
            v.blockedFor = 0;
            ctx.events.emit('honk', { x: v.x, z: v.z });
          }
        } else {
          v.blockedFor = 0;
        }

        const step = v.speed * dt;
        if (dist <= step + 0.3) {
          v.x = v.tx;
          v.z = v.tz;
          const next = world.nextWaypoint({ x: v.x, z: v.z }, v.heading, 'vehicle', rng);
          v.heading = next.heading;
          v.tx = next.x;
          v.tz = next.z;
        } else {
          v.x += fx * step;
          v.z += fz * step;
        }
      }

      spawnTimer -= dt;
      if (spawnTimer <= 0 && active < target()) {
        spawnTimer = 0.4;
        const free = vehicles.find((v) => !v.active);
        if (free) spawn(free, player.x, player.z);
      }
    },

    dispose() {
      for (const off of offs) off();
      const render = ctx.services.tryGet('render');
      for (const mesh of [body, cabin]) {
        if (!mesh) continue;
        render?.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.dispose();
      }
    },
  });
}
