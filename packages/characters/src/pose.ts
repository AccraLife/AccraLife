/**
 * Poses and animation maths. Pure numbers, no three.js, so it can be unit tested.
 *
 * The figure faces +z in its own space. Angles are radians.
 * For a limb that hangs down from its pivot, a NEGATIVE x rotation swings the lower end FORWARD.
 * The character's right side is -x, its left side is +x.
 */
export interface Pose {
  /** Vertical offset of the hips in metres (walking bounce). */
  hipY: number;
  /** Whole-body lean: positive leans forward. */
  lean: number;
  roll: number;
  headPitch: number;
  headYaw: number;
  lHip: number;
  lKnee: number;
  rHip: number;
  rKnee: number;
  /** Shoulder pitch: negative swings the arm forward. */
  lSh: number;
  rSh: number;
  /** Shoulder roll: raises an arm sideways. Left arm positive, right arm negative. */
  lShRoll: number;
  rShRoll: number;
  /** Elbow bend: negative folds the forearm forward. */
  lEl: number;
  rEl: number;
  /** Whole-body rotation about the hips, for falls: pitch (positive = forward), bank (positive = toward the right) and twist. */
  pitch: number;
  bank: number;
  spin: number;
}

export type PoseKey = keyof Pose;
export const POSE_KEYS: readonly PoseKey[] = [
  'hipY', 'lean', 'roll', 'headPitch', 'headYaw', 'lHip', 'lKnee', 'rHip', 'rKnee',
  'lSh', 'rSh', 'lShRoll', 'rShRoll', 'lEl', 'rEl', 'pitch', 'bank', 'spin',
];

export function neutralPose(): Pose {
  return {
    hipY: 0, lean: 0, roll: 0, headPitch: 0, headYaw: 0,
    lHip: 0, lKnee: 0, rHip: 0, rKnee: 0,
    lSh: 0, rSh: 0, lShRoll: 0, rShRoll: 0, lEl: 0, rEl: 0,
    pitch: 0, bank: 0, spin: 0,
  };
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
export const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

/** Mix two poses: t = 0 gives a, t = 1 gives b. Returns a fresh pose. */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out = neutralPose();
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Move `current` toward `target`. rate is per second; frame-rate independent. */
export function blendPose(current: Pose, target: Pose, dt: number, rate: number): void {
  const t = 1 - Math.exp(-rate * dt);
  for (const k of POSE_KEYS) current[k] += (target[k] - current[k]) * t;
}

/** How far through the walk cycle we move per metre travelled. */
export function phaseRate(strideLength: number): number {
  return (Math.PI * 2) / (strideLength * 2);
}

export interface WalkInput {
  /** Cycle phase in radians. */
  phase: number;
  /** Ground speed in m/s. */
  speed: number;
  /** Nominal walking speed for this person. Faster than this blends into a run. */
  walkSpeed?: number;
  /** Full running speed. */
  runSpeed?: number;
}

/** Walking and running. Returns a fresh pose. Speed 0 gives the neutral standing pose. */
export function walkPose({ phase, speed, walkSpeed = 1.5, runSpeed = 4.2 }: WalkInput): Pose {
  const a = clamp01(speed / (walkSpeed * 0.55));
  const from = walkSpeed * 1.15;
  const r = clamp01((speed - from) / Math.max(0.1, runSpeed - from));
  const stride = (0.5 + 0.5 * r) * a;
  const p = neutralPose();
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  p.lHip = -s * stride;
  p.rHip = s * stride;
  p.lKnee = (0.12 * a + (0.3 + 0.8 * r) * Math.max(0, c)) * a;
  p.rKnee = (0.12 * a + (0.3 + 0.8 * r) * Math.max(0, -c)) * a;
  const arm = (0.45 + 0.5 * r) * a;
  p.lSh = s * arm;
  p.rSh = -s * arm;
  p.lEl = -(0.15 + 0.9 * r) * a;
  p.rEl = -(0.15 + 0.9 * r) * a;
  p.hipY = 0.022 * a * (1 + r) * Math.cos(2 * phase);
  p.lean = 0.04 * a + 0.2 * r;
  p.roll = 0.035 * a * s;
  return p;
}

/** Standing still: slow breathing, weight shift, and a small head drift. */
export function idlePose(t: number, seed = 0): Pose {
  const p = neutralPose();
  const w = Math.sin(t * 0.7 + seed);
  p.hipY = 0.004 * Math.sin(t * 1.9 + seed);
  p.roll = 0.015 * w;
  p.lHip = 0.02 * w;
  p.rHip = -0.02 * w;
  p.lSh = 0.04 * Math.sin(t * 1.9 + seed);
  p.rSh = -0.04 * Math.sin(t * 1.9 + seed);
  p.lEl = -0.12;
  p.rEl = -0.12;
  p.headYaw = 0.12 * Math.sin(t * 0.35 + seed * 2) * Math.sin(t * 0.13 + seed);
  p.headPitch = 0.03 * Math.sin(t * 0.5 + seed);
  return p;
}

/** Chatting: arms gesture, head nods. Layer over idle. */
export function talkPose(t: number, seed = 0): Pose {
  const p = idlePose(t, seed);
  const g = 0.5 + 0.5 * Math.sin(t * 2.3 + seed);
  p.rEl = -0.9 - 0.5 * g;
  p.rSh = -0.4 - 0.5 * g;
  p.lEl = -0.7 - 0.25 * Math.sin(t * 1.7 + seed);
  p.lSh = -0.25;
  p.headPitch = 0.08 * Math.sin(t * 3.1 + seed);
  return p;
}

/** A friendly wave with the right hand. */
export function wavePose(t: number): Pose {
  const p = idlePose(t);
  p.rShRoll = -(2.55 + 0.25 * Math.sin(t * 9));
  p.rSh = 0;
  p.rEl = -0.5 + 0.3 * Math.sin(t * 9);
  return p;
}

/** Holding an umbrella forward in the right hand. */
export function umbrellaArm(p: Pose): Pose {
  p.rSh = -0.55;
  p.rEl = -1.25;
  return p;
}

/** Hands steadying a load on the head: arms stay close, with less swing. */
export function headLoadArms(p: Pose): Pose {
  p.lSh *= 0.35;
  p.rSh *= 0.35;
  p.lEl = -0.5;
  p.rEl = -0.5;
  p.lShRoll = 0.18;
  p.rShRoll = -0.18;
  return p;
}

/** Hands raised and a quick hunch: a startle. amount 0..1. */
export function startlePose(base: Pose, amount: number): Pose {
  base.lean -= 0.15 * amount;
  base.lSh -= 0.8 * amount;
  base.rSh -= 0.8 * amount;
  base.lEl -= 1.0 * amount;
  base.rEl -= 1.0 * amount;
  base.headPitch -= 0.2 * amount;
  return base;
}

/** Airborne: knees tucked, arms out for balance. */
export function jumpPose(vy: number): Pose {
  const p = neutralPose();
  const up = clamp01((vy + 6) / 12);
  p.lHip = -0.7 * up - 0.1;
  p.rHip = -0.3 * up;
  p.lKnee = 0.9 * up + 0.2;
  p.rKnee = 0.5 * up + 0.2;
  p.lShRoll = 0.9;
  p.rShRoll = -0.9;
  p.lEl = -0.3;
  p.rEl = -0.3;
  p.lean = 0.05;
  return p;
}

/** Look toward a point. `relYaw` is the angle to it relative to the body's facing, wrapped to -PI..PI. */
export function lookAt(p: Pose, relYaw: number, pitch = 0): Pose {
  const limit = 1.05;
  const ok = Math.abs(relYaw) < 2.2;
  p.headYaw = ok ? clamp(relYaw, -limit, limit) : p.headYaw;
  p.headPitch += clamp(pitch, -0.4, 0.4);
  return p;
}

export function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}
