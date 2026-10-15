export type HairStyle = 'lowcut' | 'braids' | 'wrap' | 'afro' | 'cornrows' | 'scarf' | 'bald';
export type BodyBuild = 'slim' | 'average' | 'broad' | 'heavy';
export type OutfitKind = 'tee' | 'shirt' | 'dress' | 'kaftan' | 'workwear';

export interface Appearance {
  name: string;
  /** Index into SKIN_TONES. */
  skin: number;
  /** Index into SHIRT_COLORS (the main outfit colour). */
  shirt: number;
  hair: HairStyle;
  /** Added in Core 0.2.0. Missing in older saves: use the defaults. */
  build?: BodyBuild;
  outfit?: OutfitKind;
  /** Index into BOTTOM_COLORS. */
  bottom?: number;
}

/** A range of skin tones so players can see themselves in the game (SRS PLY-001). */
export const SKIN_TONES = [0xa9714a, 0x8d5a3b, 0x6f4228, 0x5a331f, 0x3f2314, 0x2f1a0f] as const;
export const SHIRT_COLORS = [0xd94a3d, 0xf2b632, 0x2f9e5b, 0x2f7ab8, 0xf2f2f2, 0x7a3fa0] as const;
export const BOTTOM_COLORS = [0x2b3a55, 0x1d1d20, 0x6b5a46, 0x3d4f3a, 0x8a8f99, 0x5a2e2e] as const;
export const HAIR_COLOR = 0x15100d;
export const HAIR_STYLES: readonly HairStyle[] = ['lowcut', 'cornrows', 'braids', 'afro', 'wrap', 'scarf', 'bald'];
export const BODY_BUILDS: readonly BodyBuild[] = ['slim', 'average', 'broad', 'heavy'];
export const OUTFITS: readonly OutfitKind[] = ['tee', 'shirt', 'dress', 'kaftan', 'workwear'];

export const HAIR_LABELS: Record<HairStyle, string> = {
  lowcut: 'Low cut',
  cornrows: 'Cornrows',
  braids: 'Braids',
  afro: 'Afro',
  wrap: 'Head wrap',
  scarf: 'Scarf',
  bald: 'Bald',
};
export const BUILD_LABELS: Record<BodyBuild, string> = { slim: 'Slim', average: 'Average', broad: 'Broad', heavy: 'Heavy' };
export const OUTFIT_LABELS: Record<OutfitKind, string> = {
  tee: 'T-shirt and trousers',
  shirt: 'Shirt and trousers',
  dress: 'Dress',
  kaftan: 'Kaftan',
  workwear: 'Work overalls',
};

export function defaultAppearance(): Appearance {
  return { name: 'Kwame', skin: 1, shirt: 3, hair: 'lowcut', build: 'average', outfit: 'tee', bottom: 0 };
}

/** Make an Appearance from untrusted data (a save file) without throwing. */
export function sanitizeAppearance(raw: unknown): Appearance {
  const base = defaultAppearance();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const idx = (v: unknown, len: number, fallback: number): number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < len ? v : fallback;
  const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
    typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;
  return {
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 16) : base.name,
    skin: idx(r.skin, SKIN_TONES.length, base.skin),
    shirt: idx(r.shirt, SHIRT_COLORS.length, base.shirt),
    hair: pick(r.hair, HAIR_STYLES, base.hair),
    build: pick(r.build, BODY_BUILDS, 'average'),
    outfit: pick(r.outfit, OUTFITS, 'tee'),
    bottom: idx(r.bottom, BOTTOM_COLORS.length, 0),
  };
}
