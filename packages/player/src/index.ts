import * as THREE from 'three';
import {
  type Appearance,
  type GameContext,
  type GameModule,
  type PlayerService,
  type PointOfInterest,
  type RenderService,
  type WorldService,
  defaultAppearance,
  sanitizeAppearance,
  defineModule,
} from '@accra/core';
import {
  BodyPhysics,
  type BodyOutput,
  type Person,
  type PersonTemplate,
  buildDetailedTemplate,
  idlePose,
  jumpPose,
  phaseRate,
  specFromAppearance,
  walkPose,
} from '@accra/characters';

/**
 * PLY: player (SRS section 7). Third-person movement, camera, interaction and the character model.
 * Keys: WASD or arrows move, Shift runs, Space jumps, E interacts, mouse looks.
 */

const WALK_SPEED = 3.4;
const RUN_SPEED = 6.4;
const RADIUS = 0.4;
const INTERACT_RANGE = 3.4;

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function createPlayerModule(): GameModule {
  let ctx: GameContext;
  let render: RenderService;
  let world: WorldService;
  let canvas: HTMLElement | null = null;

  const pos = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const renderPos = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  let vx = 0;
  let vz = 0;
  let vy = 0;
  let onGround = true;
  let speedNow = 0;
  let yaw = Math.PI / 2;
  let pitch = 0.35;
  let camDist = 6.2;
  let facing = Math.PI / 2;
  let walkPhase = 0;
  let stepDist = 0;
  let orbit = 0;
  let camReady = false;

  let appearance: Appearance = defaultAppearance();
  let template: PersonTemplate | null = null;
  let character: Person | null = null;
  let animClock = 0;
  let body = new BodyPhysics(0.95);
  let bodyOut: BodyOutput | null = null;
  let pendDx = 0;
  let pendDz = 0;
  let bodyLocked = false;
  let lastHitKind: 'bump' | 'shove' | 'wall' | 'vehicle' | 'slip' = 'bump';
  let shake = 0;
  let lookY = 1.55;
  let hitCooldown = 0;

  const keys = new Set<string>();
  let interactRequested = false;
  let jumpRequested = false;
  let locked = false;
  let dragging = false;
  let blockUntil = 0;
  let prompt: string | null = null;
  let currentPoi: PointOfInterest | null = null;
  const offs: Array<() => void> = [];

  const playing = (): boolean => ctx.state.phase === 'playing';
  const typing = (e: Event): boolean => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  };

  const mountCharacter = (): void => {
    character?.detach();
    template?.dispose();
    template = buildDetailedTemplate(specFromAppearance(appearance), { textureSize: 256 });
    character = template.instantiate({ castShadow: true });
    render.scene.add(character.root);
    body = new BodyPhysics(character.dims.hipY);
    bodyOut = null;
    bodyLocked = false;
  };

  const emitMoved = (): void => {
    ctx.events.emit('playerMoved', { x: pos.x, z: pos.z, yaw });
  };

  const setPrompt = (text: string | null): void => {
    if (text === prompt) return;
    prompt = text;
    ctx.events.emit('promptChanged', { text });
  };

  const service: PlayerService = {
    position: () => pos,
    yaw: () => yaw,
    speed: () => speedNow,
    teleport(x, z) {
      pos.set(x, world.groundHeightAt(x, z), z);
      prev.copy(pos);
      vx = 0;
      vz = 0;
      vy = 0;
      onGround = true;
      body.reset();
      bodyOut = null;
      bodyLocked = false;
      pendDx = pendDz = 0;
      camReady = false;
      emitMoved();
    },
    isDown: () => bodyLocked,
    applyImpact(i) {
      if (hitCooldown > 0 && i.kind !== 'vehicle') return;
      hitCooldown = 0.6;
      lastHitKind = i.kind;
      body.hit(i, facing);
      bodyLocked = true;
      vx = 0;
      vz = 0;
      const strength = Math.min(14, i.strength);
      shake = Math.max(shake, Math.min(1, strength / 9));
      ctx.events.emit('impact', { x: pos.x, z: pos.z, strength, kind: i.kind, thud: false });
      const life = ctx.services.tryGet('life');
      if (strength >= 4.2) {
        life?.restore('mood', i.kind === 'vehicle' ? -18 : -5);
        ctx.events.emit('notify', {
          text: i.kind === 'vehicle' ? 'A vehicle knocked you down!' : i.kind === 'wall' ? 'You ran into a wall.' : 'You took a tumble.',
          kind: 'warn',
        });
      }
    },
    appearance: () => appearance,
    setAppearance(a) {
      appearance = sanitizeAppearance(a);
      if (character) mountCharacter();
    },
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (typing(e)) return;
    keys.add(e.code);
    if (!playing()) return;
    if (e.code === 'KeyE' && !e.repeat) interactRequested = true;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) jumpRequested = true;
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    keys.delete(e.code);
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!playing()) return;
    if (!locked && !dragging) return;
    const s = 0.0022 * ctx.config.mouseSensitivity;
    yaw -= e.movementX * s;
    pitch = Math.max(-0.3, Math.min(1.15, pitch + e.movementY * s));
  };
  const onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0 && playing() && !locked && e.target === canvas) dragging = true;
  };
  const onMouseUp = (): void => {
    dragging = false;
  };
  const onWheel = (e: WheelEvent): void => {
    if (!playing()) return;
    camDist = Math.max(3, Math.min(10, camDist + Math.sign(e.deltaY) * 0.5));
  };
  const onLockChange = (): void => {
    const was = locked;
    locked = document.pointerLockElement === canvas && canvas !== null;
    if (was && !locked && playing()) ctx.setPhase('paused');
  };
  const onBlur = (): void => {
    keys.clear();
    dragging = false;
    if (playing()) ctx.setPhase('paused');
  };

  return defineModule({
    id: 'player',
    version: '0.2.0',
    dependsOn: ['perf', 'world'],

    init(context) {
      ctx = context;
      render = ctx.services.get('render');
      world = ctx.services.get('world');
      canvas = document.getElementById('game-canvas');

      const spawn = world.spawnPoint();
      pos.set(spawn.x, world.groundHeightAt(spawn.x, spawn.z), spawn.z);
      prev.copy(pos);
      mountCharacter();
      ctx.services.register('player', service);

      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('wheel', onWheel, { passive: true });
      window.addEventListener('blur', onBlur);
      document.addEventListener('pointerlockchange', onLockChange);
      offs.push(
        ctx.events.on('activityStarted', (e) => {
          blockUntil = performance.now() + e.seconds * 1000;
        }),
        ctx.events.on('phaseChanged', (e) => {
          if (e.phase !== 'playing') {
            keys.clear();
            interactRequested = false;
            jumpRequested = false;
            dragging = false;
            speedNow = 0;
          }
        }),
      );

      // Camera and model every rendered frame, smoothed between fixed steps.
      ctx.onRender(100, (dt, alpha) => {
        if (!character) return;
        renderPos.lerpVectors(prev, pos, alpha);
        const g = character.root;
        g.position.set(renderPos.x, renderPos.y, renderPos.z);
        if (!bodyLocked) facing += shortestAngle(facing, Math.atan2(vx, vz)) * Math.min(1, dt * 12) * (speedNow > 0.3 ? 1 : 0);
        g.rotation.y = facing;

        // Animate: walk and run cycles, idle breathing, or a jump pose in the air.
        animClock += dt;
        const run = speedNow > WALK_SPEED * 1.2;
        walkPhase += speedNow * dt * phaseRate(run ? 2.3 : 1.5);
        const basePose = !onGround
          ? jumpPose(vy)
          : speedNow < 0.25
            ? idlePose(animClock)
            : walkPose({ phase: walkPhase, speed: speedNow, walkSpeed: WALK_SPEED, runSpeed: RUN_SPEED });
        if (playing()) {
          // Body physics runs per frame; the movement it asks for is applied in the fixed update.
          const out = body.step(Math.min(dt, 0.05), basePose);
          bodyOut = out;
          pendDx += out.dx;
          pendDz += out.dz;
          bodyLocked = out.locked;
          if (out.thud > 0) {
            shake = Math.max(shake, out.thud * 0.8);
            ctx.events.emit('impact', { x: renderPos.x, z: renderPos.z, strength: out.thud * 9, kind: lastHitKind, thud: true });
          }
          character.animate(out.pose, dt, out.mode === 'ok' ? (onGround ? (speedNow < 0.25 ? 8 : 16) : 10) : out.mode === 'stagger' ? 24 : 60);
        } else {
          character.animate(basePose, dt, 10);
        }
        shake *= Math.exp(-dt * 5);

        const cam = render.camera;
        const phase = ctx.state.phase;
        if (phase === 'playing' || phase === 'paused') {
          const wantY = 1.55 + (bodyOut && bodyOut.mode !== 'ok' ? Math.min(0, bodyOut.pose.hipY) * 0.8 : 0);
          lookY += (wantY - lookY) * Math.min(1, dt * 6);
          lookAt.set(renderPos.x, renderPos.y + lookY, renderPos.z);
          const horizontal = camDist * Math.cos(pitch);
          let cx = lookAt.x - Math.sin(yaw) * horizontal;
          let cz = lookAt.z - Math.cos(yaw) * horizontal;
          const pushed = world.resolveCollision(cx, cz, 0.6);
          cx = pushed.x;
          cz = pushed.z;
          const cy = Math.max(world.groundHeightAt(cx, cz) + 0.5, lookAt.y + Math.sin(pitch) * camDist);
          camPos.set(cx, cy, cz);
          if (!camReady) {
            cam.position.copy(camPos);
            camReady = true;
          } else {
            cam.position.lerp(camPos, 1 - Math.exp(-dt * 20));
          }
          if (shake > 0.01) {
            const k = shake * 0.12;
            cam.position.x += (Math.random() - 0.5) * k;
            cam.position.y += (Math.random() - 0.5) * k;
            cam.position.z += (Math.random() - 0.5) * k;
          }
          cam.lookAt(lookAt);
        } else {
          // Menu and loading: a slow orbit around the start point.
          orbit += dt * 0.07;
          const r = 13;
          camPos.set(renderPos.x + Math.cos(orbit) * r, renderPos.y + 3.4, renderPos.z + Math.sin(orbit) * r);
          cam.position.copy(camPos);
          lookAt.set(renderPos.x, renderPos.y + 1.4, renderPos.z);
          cam.lookAt(lookAt);
          camReady = false;
        }
      });
      emitMoved();
    },

    start() {
      const spawn = world.spawnPoint();
      yaw = Math.PI / 2;
      facing = Math.PI / 2;
      pitch = 0.35;
      service.teleport(spawn.x, spawn.z);
    },

    update(dt) {
      if (!playing()) return;
      const up = keys.has('KeyW') || keys.has('ArrowUp');
      const down = keys.has('KeyS') || keys.has('ArrowDown');
      const left = keys.has('KeyA') || keys.has('ArrowLeft');
      const right = keys.has('KeyD') || keys.has('ArrowRight');
      const f = (up ? 1 : 0) - (down ? 1 : 0);
      const s = (left ? 1 : 0) - (right ? 1 : 0);
      hitCooldown -= dt;
      const input = performance.now() >= blockUntil && !bodyLocked;

      let dx = 0;
      let dz = 0;
      if (input && (f !== 0 || s !== 0)) {
        // Forward is (sin yaw, cos yaw); left is (cos yaw, -sin yaw).
        dx = Math.sin(yaw) * f + Math.cos(yaw) * s;
        dz = Math.cos(yaw) * f - Math.sin(yaw) * s;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
      }
      const running = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && (dx !== 0 || dz !== 0);
      const life = ctx.services.tryGet('life');
      const factor = life ? life.moveFactor() : 1;
      const maxSpeed = (running ? RUN_SPEED : WALK_SPEED) * factor;
      const accel = 30;
      const tx = dx * maxSpeed;
      const tz = dz * maxSpeed;
      vx += Math.max(-accel * dt, Math.min(accel * dt, tx - vx));
      vz += Math.max(-accel * dt, Math.min(accel * dt, tz - vz));

      if (bodyLocked) {
        vx = 0;
        vz = 0;
      }
      prev.copy(pos);
      const wantX = pos.x + vx * dt + pendDx;
      const wantZ = pos.z + vz * dt + pendDz;
      pendDx = pendDz = 0;
      const resolved = world.resolveCollision(wantX, wantZ, RADIUS);
      // Running flat into a wall: the move was almost entirely blocked.
      const intended = Math.hypot(vx, vz) * dt;
      if (!bodyLocked && running && onGround && intended > 0.15 && speedNow > RUN_SPEED * 0.8) {
        const got = Math.hypot(resolved.x - pos.x, resolved.z - pos.z);
        if (got < intended * 0.3) service.applyImpact({ dirX: -vx, dirZ: -vz, strength: speedNow * 0.62, kind: 'wall' });
      }
      pos.x = resolved.x;
      pos.z = resolved.z;

      if (!bodyLocked) {
        const hit = ctx.services.tryGet('vehicles')?.collide(pos.x, pos.z, RADIUS);
        if (hit) service.applyImpact({ dirX: hit.dirX, dirZ: hit.dirZ, strength: 3.5 + hit.speed * 0.85, kind: 'vehicle' });
      }

      const ground = world.groundHeightAt(pos.x, pos.z);
      if (jumpRequested && onGround && input) {
        vy = 6.2;
        onGround = false;
      }
      jumpRequested = false;
      if (!onGround) {
        vy -= 18 * dt;
        pos.y += vy * dt;
        if (pos.y <= ground) {
          pos.y = ground;
          body.land(-vy);
          if (-vy > 5) ctx.events.emit('footstep', { surface: world.surfaceAt(pos.x, pos.z) });
          vy = 0;
          onGround = true;
        }
      } else {
        pos.y += (ground - pos.y) * Math.min(1, 16 * dt);
        if (Math.abs(ground - pos.y) < 0.002) pos.y = ground;
      }

      speedNow = Math.hypot(vx, vz);
      stepDist += speedNow * dt;
      if (stepDist > (running ? 2.1 : 1.45) && onGround && speedNow > 0.5) {
        stepDist = 0;
        ctx.events.emit('footstep', { surface: world.surfaceAt(pos.x, pos.z) });
      }

      currentPoi = world.nearestPoi(pos.x, pos.z, INTERACT_RANGE);
      setPrompt(currentPoi && input ? `E  ${currentPoi.prompt}` : null);
      if (interactRequested && currentPoi && input) {
        ctx.events.emit('interactionStarted', { kind: currentPoi.kind, targetId: currentPoi.id });
      }
      interactRequested = false;

      emitMoved();
    },

    serialize() {
      return { x: pos.x, z: pos.z, yaw, appearance };
    },

    deserialize(data) {
      const d = data as { x?: number; z?: number; yaw?: number; appearance?: Appearance } | null;
      if (!d) return;
      if (d.appearance) service.setAppearance(d.appearance);
      if (typeof d.yaw === 'number') yaw = d.yaw;
      if (typeof d.x === 'number' && typeof d.z === 'number') service.teleport(d.x, d.z);
    },

    dispose() {
      for (const off of offs) off();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onLockChange);
      character?.detach();
      template?.dispose();
    },
  });
}
