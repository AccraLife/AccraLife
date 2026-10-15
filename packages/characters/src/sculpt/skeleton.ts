import type { Dims } from '../spec';
import type { Pose } from '../pose';
import { type M4, type V3, compose, mul, sub, transformDir, transformPoint } from './math';

/** Bone indices. Left is +x, right is -x (the figure faces +z). */
export const B = {
  hips: 0, spine: 1, chest: 2, neck: 3, head: 4,
  uArmL: 5, fArmL: 6, handL: 7, fingL: 8,
  uArmR: 9, fArmR: 10, handR: 11, fingR: 12,
  thighL: 13, shinL: 14, footL: 15,
  thighR: 16, shinR: 17, footR: 18,
} as const;
export const BONE_COUNT = 19;

export const BONE_NAMES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'upperArmL', 'foreArmL', 'handL', 'fingersL',
  'upperArmR', 'foreArmR', 'handR', 'fingersR',
  'thighL', 'shinL', 'footL',
  'thighR', 'shinR', 'footR',
] as const;

export interface BoneDef {
  name: string;
  parent: number;
  /** Joint position in the rest pose, world space (feet on y = 0). */
  joint: V3;
}

export interface Landmarks {
  hipY: number;
  shoulderX: number;
  shoulderY: number;
  neckBaseY: number;
  headBaseY: number;
  hipX: number;
  kneeY: number;
  ankleY: number;
  elbowY: number;
  wristY: number;
  knuckleY: number;
}

export function landmarks(d: Dims): Landmarks {
  const hipY = d.hipY;
  const shoulderY = hipY + d.torso * 0.94;
  return {
    hipY,
    shoulderX: d.shoulderW * 0.35,
    shoulderY,
    neckBaseY: hipY + d.torso,
    headBaseY: hipY + d.torso + d.neck,
    hipX: d.hipW * 0.3,
    kneeY: hipY - d.thigh,
    ankleY: hipY - d.thigh - d.shin,
    elbowY: shoulderY - d.upperArm,
    wristY: shoulderY - d.upperArm - d.foreArm,
    knuckleY: shoulderY - d.upperArm - d.foreArm - d.height * 0.058,
  };
}

export function skeletonFor(d: Dims): BoneDef[] {
  const L = landmarks(d);
  const arm = (sign: number, up: number): BoneDef[] => [
    { name: '', parent: B.chest, joint: [sign * L.shoulderX, L.shoulderY, 0] },
    { name: '', parent: up, joint: [sign * (L.shoulderX + d.height * 0.01), L.elbowY, 0] },
    { name: '', parent: up + 1, joint: [sign * (L.shoulderX + d.height * 0.017), L.wristY, 0] },
    { name: '', parent: up + 2, joint: [sign * (L.shoulderX + d.height * 0.02), L.knuckleY, d.height * 0.004] },
  ];
  const leg = (sign: number, up: number): BoneDef[] => [
    { name: '', parent: B.hips, joint: [sign * L.hipX, L.hipY, 0] },
    { name: '', parent: up, joint: [sign * (L.hipX * 0.95), L.kneeY, d.height * 0.004] },
    { name: '', parent: up + 1, joint: [sign * (L.hipX * 0.9), L.ankleY, 0] },
  ];
  const defs: BoneDef[] = [
    { name: '', parent: -1, joint: [0, L.hipY, 0] },
    { name: '', parent: B.hips, joint: [0, L.hipY + d.torso * 0.2, 0] },
    { name: '', parent: B.spine, joint: [0, L.hipY + d.torso * 0.55, 0] },
    { name: '', parent: B.chest, joint: [0, L.neckBaseY, 0] },
    { name: '', parent: B.neck, joint: [0, L.headBaseY, 0] },
    ...arm(1, B.uArmL),
    ...arm(-1, B.uArmR),
    ...leg(1, B.thighL),
    ...leg(-1, B.thighR),
  ];
  // The arm builder parents bone i+1 to bone i, so the indices line up with B.
  // Fix the first arm bone parents, which point at the previous element for the right arm.
  defs[B.uArmL] = { name: '', parent: B.chest, joint: defs[B.uArmL]!.joint };
  defs[B.uArmR] = { name: '', parent: B.chest, joint: defs[B.uArmR]!.joint };
  defs[B.thighL] = { name: '', parent: B.hips, joint: defs[B.thighL]!.joint };
  defs[B.thighR] = { name: '', parent: B.hips, joint: defs[B.thighR]!.joint };
  return defs.map((b, i) => ({ ...b, name: BONE_NAMES[i] as string }));
}

/** Local rest translation of a bone relative to its parent. */
export function restLocal(defs: readonly BoneDef[], i: number): V3 {
  const b = defs[i] as BoneDef;
  return b.parent < 0 ? b.joint : sub(b.joint, (defs[b.parent] as BoneDef).joint);
}

/** Per-bone Euler rotations for a pose. Shared by the three.js rig and the offline preview. */
export function poseRotations(p: Pose, fingerCurl = 0, time = 0): V3[] {
  const r: V3[] = Array.from({ length: BONE_COUNT }, () => [0, 0, 0] as V3);
  const set = (b: number, x: number, y = 0, z = 0): void => {
    r[b] = [x, y, z];
  };
  const pelvisYaw = (p.lHip - p.rHip) * 0.1;
  const breath = 0.012 * Math.sin(time * 1.9);
  set(B.hips, p.lean * 0.3 + p.pitch, pelvisYaw + p.spin, p.roll + p.bank);
  set(B.spine, p.lean * 0.35 + breath, -pelvisYaw * 0.7, -p.roll * 0.6);
  set(B.chest, p.lean * 0.35 - breath, -pelvisYaw * 0.9, -p.roll * 0.3);
  set(B.neck, p.headPitch * 0.35, p.headYaw * 0.35);
  set(B.head, p.headPitch * 0.65, p.headYaw * 0.65);
  set(B.uArmL, p.lSh, 0, p.lShRoll);
  set(B.uArmR, p.rSh, 0, p.rShRoll);
  set(B.fArmL, p.lEl);
  set(B.fArmR, p.rEl);
  set(B.handL, -p.lEl * 0.12);
  set(B.handR, -p.rEl * 0.12);
  set(B.fingL, 0, 0, -fingerCurl);
  set(B.fingR, 0, 0, fingerCurl);
  set(B.thighL, p.lHip);
  set(B.thighR, p.rHip);
  set(B.shinL, p.lKnee);
  set(B.shinR, p.rKnee);
  set(B.footL, -(p.lHip + p.lKnee) * 0.75);
  set(B.footR, -(p.rHip + p.rKnee) * 0.75);
  return r;
}

export interface Skin {
  /** World matrices for each bone in the posed state. */
  world: M4[];
  /** Matrices that take a rest-pose point to its posed position. */
  skin: M4[];
}

export function solveSkin(defs: readonly BoneDef[], rotations: readonly V3[], hipsOffset: V3 = [0, 0, 0]): Skin {
  const world: M4[] = [];
  const skin: M4[] = [];
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i] as BoneDef;
    const t = restLocal(defs, i);
    const local = compose(i === 0 ? [t[0] + hipsOffset[0], t[1] + hipsOffset[1], t[2] + hipsOffset[2]] : t, rotations[i] as V3);
    const w = def.parent < 0 ? local : mul(world[def.parent] as M4, local);
    world.push(w);
    // inverse bind = translate(-joint)
    const inv = compose([-def.joint[0], -def.joint[1], -def.joint[2]], [0, 0, 0]);
    skin.push(mul(w, inv));
  }
  return { world, skin };
}

/** Linear blend skinning of one vertex. */
export function skinPoint(s: Skin, p: V3, bi: readonly number[], bw: readonly number[], o: number): V3 {
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < 4; k++) {
    const w = bw[o + k] as number;
    if (w <= 0) continue;
    const q = transformPoint(s.skin[bi[o + k] as number] as M4, p);
    x += q[0] * w;
    y += q[1] * w;
    z += q[2] * w;
  }
  return [x, y, z];
}

export function skinNormal(s: Skin, n: V3, bi: readonly number[], bw: readonly number[], o: number): V3 {
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < 4; k++) {
    const w = bw[o + k] as number;
    if (w <= 0) continue;
    const q = transformDir(s.skin[bi[o + k] as number] as M4, n);
    x += q[0] * w;
    y += q[1] * w;
    z += q[2] * w;
  }
  return [x, y, z];
}
