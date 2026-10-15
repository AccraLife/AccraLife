import {
  type Appearance,
  BOTTOM_COLORS,
  type BodyBuild,
  HAIR_COLOR,
  type HairStyle,
  type OutfitKind,
  type Rng,
  SHIRT_COLORS,
  SKIN_TONES,
  sanitizeAppearance,
} from '@accra/core';

/**
 * A complete, plain-data description of one person. Pure: no three.js here, so it is easy to test,
 * save and generate. `buildTemplate` turns a spec into geometry.
 */
export type Accessory = 'none' | 'cap' | 'glasses' | 'bag' | 'headLoad';
export type Sleeves = 'none' | 'short' | 'long';
export type Role = 'commuter' | 'vendor' | 'trader' | 'worker' | 'player';

/** Face proportions, each around 1 for an average face. Used by the detailed head. */
export interface FaceShape {
  nose: number;
  lips: number;
  jaw: number;
  brow: number;
  eyeColor: number;
}

/** 'clay' is the soft, rounded, big-headed toy look; 'real' keeps natural proportions. */
export type Style = 'clay' | 'real';

export type Pattern = 'plain' | 'wax' | 'kente' | 'stripe' | 'check';

export interface PersonSpec {
  skin: number;
  /** Metres. */
  height: number;
  build: BodyBuild;
  female: boolean;
  outfit: OutfitKind;
  top: number;
  accent: number;
  bottom: number;
  shoes: number;
  hairColor: number;
  hair: HairStyle;
  sleeves: Sleeves;
  shorts: boolean;
  accessory: Accessory;
  face: FaceShape;
  /** Fabric pattern of the main garment. */
  pattern: Pattern;
  /** Seed for fabric patterns and hair, so a look is reproducible. */
  seed: number;
  style: Style;
}

/** Body measurements in metres, derived from a spec. Proportions follow a typical adult figure. */
export interface Dims {
  height: number;
  /** Height of the hip joint above the ground when standing. */
  hipY: number;
  thigh: number;
  shin: number;
  foot: number;
  /** Hip joint to shoulder line. */
  torso: number;
  neck: number;
  headR: number;
  upperArm: number;
  foreArm: number;
  hand: number;
  shoulderW: number;
  hipW: number;
  chestDepth: number;
  waistR: number;
  limbR: number;
}

export const BUILD_SCALE: Record<BodyBuild, { width: number; depth: number; limb: number }> = {
  slim: { width: 0.9, depth: 0.88, limb: 0.88 },
  average: { width: 1, depth: 1, limb: 1 },
  broad: { width: 1.12, depth: 1.08, limb: 1.1 },
  heavy: { width: 1.2, depth: 1.35, limb: 1.22 },
};

export function computeDims(spec: PersonSpec): Dims {
  const H = spec.height;
  const b = BUILD_SCALE[spec.build];
  const sw = spec.female ? 0.225 : 0.255;
  const hw = spec.female ? 0.19 : 0.16;
  if (spec.style === 'clay') {
    // Chunky toy proportions: about five heads tall, short thick limbs, big hands and feet.
    const cw = spec.female ? 0.285 : 0.3;
    return {
      height: H,
      hipY: 0.44 * H,
      thigh: 0.205 * H,
      shin: 0.2 * H,
      foot: 0.035 * H,
      torso: 0.3 * H,
      neck: 0.028 * H,
      headR: 0.116 * H,
      upperArm: 0.15 * H,
      foreArm: 0.13 * H,
      hand: 0.065 * H,
      shoulderW: cw * H * b.width,
      hipW: (spec.female ? 0.215 : 0.2) * H * b.width,
      chestDepth: 0.14 * H * b.depth,
      waistR: 0.09 * H * b.width,
      limbR: 0.046 * H * b.limb,
    };
  }
  return {
    height: H,
    hipY: 0.53 * H,
    thigh: 0.245 * H,
    shin: 0.245 * H,
    foot: 0.04 * H,
    torso: 0.3 * H,
    neck: 0.05 * H,
    headR: 0.066 * H,
    upperArm: 0.186 * H,
    foreArm: 0.146 * H,
    hand: 0.05 * H,
    shoulderW: sw * H * b.width,
    hipW: hw * H * b.width,
    chestDepth: (spec.female ? 0.115 : 0.125) * H * b.depth,
    waistR: 0.075 * H * b.width,
    limbR: 0.034 * H * b.limb,
  };
}

const clampIdx = (i: number, len: number): number => Math.max(0, Math.min(len - 1, i));

/** The player's look comes from the character creator. */
export function specFromAppearance(a: Appearance): PersonSpec {
  const ap = sanitizeAppearance(a);
  const outfit = ap.outfit ?? 'tee';
  const female = outfit === 'dress';
  const top = SHIRT_COLORS[clampIdx(ap.shirt, SHIRT_COLORS.length)] ?? 0x2f7ab8;
  const bottom = BOTTOM_COLORS[clampIdx(ap.bottom ?? 0, BOTTOM_COLORS.length)] ?? 0x2b3a55;
  const heightBase = female ? 1.66 : 1.76;
  return {
    skin: SKIN_TONES[clampIdx(ap.skin, SKIN_TONES.length)] ?? 0x8d5a3b,
    height: heightBase,
    build: ap.build ?? 'average',
    female,
    outfit,
    top,
    accent: top === 0xf2f2f2 ? 0x2f7ab8 : 0xf2f2f2,
    bottom,
    shoes: 0x1d1d20,
    hairColor: HAIR_COLOR,
    hair: ap.hair,
    sleeves: outfit === 'tee' || outfit === 'dress' ? 'short' : 'long',
    shorts: false,
    accessory: 'none',
    face: { nose: 1.05, lips: 1.05, jaw: 1, brow: 1, eyeColor: 0x2b1a10 },
    pattern: outfit === 'dress' || outfit === 'kaftan' ? 'wax' : 'plain',
    seed: 1234,
    style: 'clay',
  };
}

// ---------- random pedestrians ----------
const SKIN_WEIGHTS = [1, 3, 4, 3, 2, 1];
const TOP_COLORS = [...SHIRT_COLORS, 0x1f6f78, 0xc2703a, 0xe4a0b0, 0x4a4a52, 0xb83a6b];

function weighted<T>(rng: Rng, items: ReadonlyArray<readonly [T, number]>): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return (items[items.length - 1] as readonly [T, number])[0];
}

/** An adult pedestrian. Roles bias clothing and what they carry. */
export function randomSpec(rng: Rng, role: Role = 'commuter'): PersonSpec {
  const female = role === 'trader' ? true : rng.chance(role === 'vendor' ? 0.6 : 0.5);
  const skinIndex = weighted(rng, SKIN_WEIGHTS.map((w, i) => [i, w] as const));
  const outfit: OutfitKind =
    role === 'worker'
      ? 'workwear'
      : female
        ? weighted(rng, [['dress', 40], ['tee', 25], ['shirt', 20], ['kaftan', 15]] as const)
        : weighted(rng, [['tee', 35], ['shirt', 35], ['kaftan', 15], ['workwear', 15]] as const);
  const hair: HairStyle = female
    ? weighted(rng, [['braids', 25], ['cornrows', 15], ['wrap', 20], ['scarf', 10], ['lowcut', 15], ['afro', 10], ['bald', 5]] as const)
    : weighted(rng, [['lowcut', 50], ['cornrows', 10], ['afro', 10], ['bald', 18], ['braids', 4]] as const);
  const top = rng.pick(TOP_COLORS);
  const height = female ? rng.range(1.5, 1.76) : rng.range(1.62, 1.9);
  const accessory: Accessory =
    role === 'trader'
      ? 'headLoad'
      : weighted(rng, [['none', 55], ['bag', 22], ['cap', female ? 3 : 14], ['glasses', 6]] as const);
  return {
    skin: SKIN_TONES[skinIndex] ?? 0x6f4228,
    height,
    build: weighted(rng, [['slim', 28], ['average', 40], ['broad', 20], ['heavy', 12]] as const),
    female,
    outfit,
    top,
    accent: rng.pick(TOP_COLORS),
    bottom: rng.pick(BOTTOM_COLORS),
    shoes: rng.pick([0x1d1d20, 0x3a2a1c, 0xe8e4da, 0x6b2a2a]),
    hairColor: HAIR_COLOR,
    hair,
    sleeves: outfit === 'tee' || outfit === 'dress' ? (rng.chance(0.3) ? 'none' : 'short') : 'long',
    shorts: !female && outfit === 'tee' && rng.chance(0.15),
    accessory,
    face: {
      nose: rng.range(0.85, 1.35),
      lips: rng.range(0.85, 1.4),
      jaw: rng.range(0.9, 1.15),
      brow: rng.range(0.8, 1.3),
      eyeColor: rng.pick([0x2b1a10, 0x3a2414, 0x1c1410]),
    },
    pattern:
      outfit === 'dress' || outfit === 'kaftan'
        ? weighted(rng, [['wax', 55], ['kente', 20], ['stripe', 10], ['plain', 15]] as const)
        : outfit === 'shirt'
          ? weighted(rng, [['plain', 55], ['check', 25], ['stripe', 20]] as const)
          : weighted(rng, [['plain', 80], ['stripe', 12], ['wax', 8]] as const),
    seed: Math.floor(rng.next() * 1e9),
    style: 'clay',
  };
}
