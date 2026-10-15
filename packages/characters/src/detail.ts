import * as THREE from 'three';
import { type Dims, type PersonSpec, computeDims } from './spec';
import { type Pose, blendPose, neutralPose } from './pose';
import type { Person, PersonTemplate } from './build';
import { buildUmbrellaGeometry } from './build';
import {
  B, BONE_COUNT, type FabricKind, type MeshData, buildAll, makeFabric, makeHair, poseRotations, restLocal, skeletonFor,
} from './sculpt';

/**
 * The detailed person: smooth skinned body, sculpted face, fitted clothes with printed fabric and hair,
 * all driven by one 19-bone skeleton. A template builds the geometry once; every instance gets its own
 * bones and shares geometry, textures and materials with its siblings.
 */

const FINGER_CURL = 0.28;

function toGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(m.col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(m.bi, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(m.bw, 4));
  g.setIndex(m.idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -0.1, -1), new THREE.Vector3(1, 2.2, 1));
  return g;
}

function fabricTextures(kind: FabricKind, main: number, accent: number, seed: number, size: number): { map: THREE.DataTexture; normalMap: THREE.DataTexture } {
  const { color, normal } = makeFabric(kind, main, accent, seed, size);
  const make = (b: { size: number; rgba: Uint8Array }, srgb: boolean): THREE.DataTexture => {
    const t = new THREE.DataTexture(b.rgba as unknown as BufferSource, b.size, b.size, THREE.RGBAFormat);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { map: make(color, true), normalMap: make(normal, false) };
}

interface PartMaterial {
  material: THREE.Material;
  textures: THREE.Texture[];
}

function materialsFor(spec: PersonSpec, size: number): Record<string, PartMaterial> {
  const out: Record<string, PartMaterial> = {};
  const flat = (rough: number, metal = 0): PartMaterial => ({
    material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal }),
    textures: [],
  });
  const fabric = (kind: FabricKind, main: number, accent: number, seed: number): PartMaterial => {
    const { map, normalMap } = fabricTextures(kind, main, accent, seed, size);
    return {
      material: new THREE.MeshStandardMaterial({
        vertexColors: true, map, normalMap, normalScale: spec.style === 'clay' ? new THREE.Vector2(0.18, 0.18) : new THREE.Vector2(0.8, 0.8), roughness: 0.88, metalness: 0, side: THREE.DoubleSide,
      }),
      textures: [map, normalMap],
    };
  };
  const seed = spec.seed % 997;
  const mainKind: FabricKind = spec.outfit === 'workwear' ? 'canvas' : spec.pattern === 'plain' || spec.outfit === 'tee' ? 'plain' : spec.pattern;
  const clay = spec.style === 'clay';
  out.skin = flat(clay ? 0.74 : 0.62);
  out.eyes = flat(clay ? 0.12 : 0.18);
  out.shoes = flat(clay ? 0.7 : 0.55);
  out.top = fabric(mainKind, spec.top, spec.accent, seed);
  out.wrap = out.top;
  out.bottom = fabric(spec.outfit === 'workwear' ? 'canvas' : 'denim', spec.bottom, spec.bottom, seed + 5);
  out.trim = flat(0.7);
  {
    const kind = spec.hair === 'afro' || spec.hair === 'lowcut' ? 'curly' : 'straight';
    if (clay) {
      out.hair = flat(0.8);
    } else {
    const h = makeHair(kind, seed + 9, 128);
    const tex = (b: { size: number; rgba: Uint8Array }, srgb: boolean): THREE.DataTexture => {
      const t = new THREE.DataTexture(b.rgba as unknown as BufferSource, b.size, b.size, THREE.RGBAFormat);
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 4;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.repeat.set(kind === 'curly' ? 5 : 3, kind === 'curly' ? 5 : 2);
      t.needsUpdate = true;
      return t;
    };
    const map = tex(h.color, true);
    const normalMap = tex(h.normal, false);
    out.hair = {
      material: new THREE.MeshStandardMaterial({
        vertexColors: true, map, normalMap, normalScale: new THREE.Vector2(kind === 'curly' ? 1.1 : 0.7, kind === 'curly' ? 1.1 : 0.7), roughness: 0.42, metalness: 0.08, side: THREE.DoubleSide,
      }),
      textures: [map, normalMap],
    };
    }
  }
  out.gear = flat(0.6);
  out.glass = flat(0.08, 0.2);
  return out;
}

export interface DetailOptions {
  /** Fabric texture size in pixels (power of two). 256 for the player, 128 for crowds. */
  textureSize?: number;
}

export function buildDetailedTemplate(spec: PersonSpec, opts: DetailOptions = {}): PersonTemplate {
  const dims = computeDims(spec);
  const model = buildAll(spec, dims);
  const defs = skeletonFor(dims);
  const geometries: Record<string, THREE.BufferGeometry> = {};
  for (const [name, mesh] of Object.entries(model.parts)) geometries[name] = toGeometry(mesh);
  const mats = materialsFor(spec, opts.textureSize ?? 256);
  const umbrellaGeo = buildUmbrellaGeometry(dims);
  const umbrellaMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });

  return {
    spec,
    dims,
    instantiate(options = {}) {
      const root = new THREE.Group();
      const bones: THREE.Bone[] = [];
      for (let i = 0; i < BONE_COUNT; i++) {
        const bone = new THREE.Bone();
        bone.name = String(i);
        const t = restLocal(defs, i);
        bone.position.set(t[0], t[1], t[2]);
        const parent = (defs[i] as { parent: number }).parent;
        if (parent >= 0) (bones[parent] as THREE.Bone).add(bone);
        bones.push(bone);
      }
      root.add(bones[0] as THREE.Bone);
      root.updateMatrixWorld(true);
      const skeleton = new THREE.Skeleton(bones);

      for (const [name, geo] of Object.entries(geometries)) {
        const mesh = new THREE.SkinnedMesh(geo, (mats[name] as PartMaterial).material);
        mesh.castShadow = options.castShadow ?? false;
        mesh.frustumCulled = true;
        root.add(mesh);
        mesh.bind(skeleton, new THREE.Matrix4());
      }

      const umbrella = new THREE.Group();
      const um = new THREE.Mesh(umbrellaGeo, umbrellaMat);
      umbrella.add(um);
      umbrella.position.set(0, -0.03 * dims.height, 0.01);
      umbrella.rotation.x = 1.8;
      umbrella.visible = false;
      (bones[B.handR] as THREE.Bone).add(umbrella);

      const pose = neutralPose();
      let time = 0;
      const hipsJoint = (defs[0] as { joint: [number, number, number] }).joint;
      const apply = (): void => {
        const rot = poseRotations(pose, FINGER_CURL, time);
        for (let i = 0; i < BONE_COUNT; i++) {
          const r = rot[i] as [number, number, number];
          (bones[i] as THREE.Bone).rotation.set(r[0], r[1], r[2]);
        }
        (bones[0] as THREE.Bone).position.set(hipsJoint[0], hipsJoint[1] + pose.hipY, hipsJoint[2]);
      };
      apply();

      return {
        root,
        spec,
        dims,
        pose,
        umbrella,
        animate(target: Pose, dt: number, rate = 14) {
          time += dt;
          blendPose(pose, target, dt, rate);
          apply();
        },
        snapTo(target: Pose) {
          Object.assign(pose, target);
          apply();
        },
        detach() {
          root.removeFromParent();
        },
      } satisfies Person;
    },
    dispose() {
      for (const g of Object.values(geometries)) g.dispose();
      const seen = new Set<PartMaterial>();
      for (const m of Object.values(mats)) {
        if (seen.has(m)) continue;
        seen.add(m);
        m.material.dispose();
        for (const t of m.textures) t.dispose();
      }
      umbrellaGeo.dispose();
      umbrellaMat.dispose();
    },
  };
}
