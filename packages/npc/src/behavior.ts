import type { Rng } from '@accra/core';

/**
 * Pedestrian behaviour: a small state machine with no rendering in it, so it can be tested.
 * It decides how fast to move and which reactions to show. The NPC module does the moving and drawing.
 */
export type Mode = 'walk' | 'pause' | 'chat' | 'stand';

export interface Brain {
  mode: Mode;
  /** Seconds left in a timed mode (pause, chat). */
  timer: number;
  /** Comfortable walking speed in m/s. */
  baseSpeed: number;
  startle: number;
  startleCooldown: number;
  glance: number;
  greetCooldown: number;
  wave: number;
  yield: number;
  umbrella: boolean;
  rainDecided: boolean;
}

export interface Sense {
  dt: number;
  hour: number;
  raining: boolean;
  distToPlayer: number;
  /** Angle to the player relative to where this person faces, -PI..PI. */
  playerRelYaw: number;
  playerSpeed: number;
  /** Distance to the player if they are right in front of us, otherwise Infinity. */
  playerAhead: number;
  /** Distance to a horn that just sounded this tick, otherwise Infinity. */
  honkDist: number;
  /** True on the tick we reach a waypoint (a street corner). */
  arrived: boolean;
}

export interface Intent {
  /** 0 to 1: how much of baseSpeed to use right now. */
  move: number;
  lookAtPlayer: boolean;
  wave: boolean;
  startle: number;
  umbrella: boolean;
  talking: boolean;
}

export function newBrain(rng: Rng, mode: Mode = 'walk'): Brain {
  return {
    mode,
    timer: 0,
    baseSpeed: rng.range(1.05, 1.6),
    startle: 0,
    startleCooldown: 0,
    glance: 0,
    greetCooldown: rng.range(0, 6),
    wave: 0,
    yield: 0,
    umbrella: false,
    rainDecided: false,
  };
}

/** How busy the street is at an hour, 0 to 1. Used for crowd size and for who is out. */
export function streetActivity(hour: number): number {
  if (hour < 5) return 0.1;
  if (hour < 7) return 0.4;
  if (hour < 10) return 1;
  if (hour < 16) return 0.8;
  if (hour < 20) return 1;
  if (hour < 22) return 0.5;
  return 0.2;
}

/** Rush hours make people walk a little faster. */
export function paceFor(hour: number): number {
  if ((hour >= 6 && hour < 9) || (hour >= 16 && hour < 19)) return 1.1;
  if (hour >= 22 || hour < 5) return 0.88;
  return 1;
}

export const GREET_RANGE = 5;
export const GLANCE_RANGE = 9;
export const YIELD_RANGE = 1.8;
export const HONK_RANGE = 25;

export function stepBrain(b: Brain, s: Sense, rng: Rng): Intent {
  const dt = s.dt;
  b.startle = Math.max(0, b.startle - dt * 1.1);
  b.startleCooldown = Math.max(0, b.startleCooldown - dt);
  b.glance = Math.max(0, b.glance - dt);
  b.greetCooldown = Math.max(0, b.greetCooldown - dt);
  b.wave = Math.max(0, b.wave - dt);
  b.yield = Math.max(0, b.yield - dt);
  if (b.timer > 0) b.timer -= dt;

  // Weather: some people open an umbrella when rain starts, everyone else hurries.
  if (s.raining && !b.rainDecided) {
    b.rainDecided = true;
    b.umbrella = rng.chance(0.45);
  } else if (!s.raining && b.rainDecided) {
    b.rainDecided = false;
    b.umbrella = false;
  }

  // A horn nearby makes people flinch and stop for a moment.
  if (s.honkDist < HONK_RANGE && b.startleCooldown <= 0) {
    b.startle = 1;
    b.startleCooldown = 6;
    b.glance = 1.5;
  }

  if (b.mode === 'pause' || b.mode === 'chat') {
    if (b.timer <= 0) b.mode = 'walk';
  } else if (b.mode === 'walk' && s.arrived) {
    // At a corner, sometimes stop and look around.
    const pauseChance = s.raining ? 0.03 : 0.1;
    if (rng.chance(pauseChance)) {
      b.mode = 'pause';
      b.timer = rng.range(2, 6);
    }
  }

  // Reactions to the player.
  const near = s.distToPlayer < GLANCE_RANGE;
  if (near && b.glance <= 0 && b.mode !== 'stand' && rng.chance(0.02)) b.glance = rng.range(1.5, 3.5);
  if (
    s.distToPlayer < GREET_RANGE &&
    Math.abs(s.playerRelYaw) < 1.3 &&
    b.greetCooldown <= 0 &&
    s.playerSpeed < 5 &&
    b.startle < 0.1
  ) {
    b.greetCooldown = rng.range(25, 60);
    if (rng.chance(0.35)) {
      b.wave = 1.8;
      b.glance = Math.max(b.glance, 2);
    }
  }
  if (b.mode === 'walk' && s.playerAhead < YIELD_RANGE && s.playerSpeed > 0.5) b.yield = 0.6;

  let move = 1;
  if (b.mode === 'pause' || b.mode === 'chat' || b.mode === 'stand') move = 0;
  if (b.yield > 0) move = 0;
  if (b.startle > 0.5) move = 0;
  else if (b.startle > 0) move *= 0.5;
  if (b.wave > 0) move *= 0.7;
  if (s.raining && !b.umbrella) move *= 1.25;

  return {
    move,
    lookAtPlayer: b.glance > 0 || b.wave > 0 || b.yield > 0,
    wave: b.wave > 0,
    startle: b.startle,
    umbrella: b.umbrella && s.raining,
    talking: b.mode === 'chat',
  };
}
