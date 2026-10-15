import type { Dims, PersonSpec } from '../spec';
import { buildBody } from './body';
import type { MeshData } from './mesh';
import { buildCloth } from './cloth';
import { buildHair } from './hair';

export * from './math';
export * from './mesh';
export * from './skeleton';
export * from './body';
export * from './cloth';
export * from './hair';
export * from './textures';

/** All the pieces of one detailed person, as plain mesh data keyed by material. */
export interface Model {
  parts: Record<string, MeshData>;
}

export function buildAll(spec: PersonSpec, d: Dims): Model {
  const body = buildBody(spec, d);
  const cloth = buildCloth(spec, d);
  const hair = buildHair(spec, d);
  const parts: Record<string, MeshData> = {
    skin: body.skin, eyes: body.eyes, shoes: body.shoes,
    top: cloth.top, bottom: cloth.bottom, trim: cloth.trim,
    hair: hair.hair, wrap: hair.wrap, gear: hair.gear, glass: hair.glass,
  };
  for (const k of Object.keys(parts)) if ((parts[k] as MeshData).idx.length === 0) delete parts[k];
  return { parts };
}
