import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Dims, type PersonSpec, computeDims } from './spec';
import { type Pose, blendPose, neutralPose } from './pose';

/**
 * Builds a person from a spec. Each bone is ONE merged mesh with vertex colours and a shared material,
 * so a figure costs 10 draw calls. A template holds the geometry; `instantiate` makes cheap copies that
 * share it, so many pedestrians with the same look cost almost nothing extra.
 */

let sharedMaterial: THREE.MeshStandardMaterial | null = null;
function material(): THREE.MeshStandardMaterial {
  sharedMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  return sharedMaterial;
}

const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

class Parts {
  private list: THREE.BufferGeometry[] = [];

  private add(geo: THREE.BufferGeometry, hex: number, pos: [number, number, number], scale: [number, number, number], rot?: [number, number, number]): void {
    if (rot) tmpQuat.setFromEuler(tmpEuler.set(rot[0], rot[1], rot[2]));
    else tmpQuat.identity();
    tmpMatrix.compose(new THREE.Vector3(...pos), tmpQuat, new THREE.Vector3(...scale));
    geo.applyMatrix4(tmpMatrix);
    tmpColor.setHex(hex);
    const count = geo.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.list.push(geo);
  }

  sphere(r: number, hex: number, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1]): this {
    this.add(new THREE.SphereGeometry(r, 14, 10), hex, pos, scale);
    return this;
  }

  /** A tapered cylinder along y, centred on pos. */
  cyl(rTop: number, rBottom: number, length: number, hex: number, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot?: [number, number, number], segments = 10): this {
    this.add(new THREE.CylinderGeometry(rTop, rBottom, length, segments, 1), hex, pos, scale, rot);
    return this;
  }

  box(w: number, h: number, d: number, hex: number, pos: [number, number, number], rot?: [number, number, number]): this {
    this.add(new THREE.BoxGeometry(w, h, d), hex, pos, [1, 1, 1], rot);
    return this;
  }

  torus(r: number, tube: number, hex: number, pos: [number, number, number]): this {
    this.add(new THREE.TorusGeometry(r, tube, 6, 14), hex, pos, [1, 1, 1]);
    return this;
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.list, false);
    for (const g of this.list) g.dispose();
    if (!merged) throw new Error('[characters] failed to merge geometry');
    return merged;
  }
}

const shade = (hex: number, f: number): number => {
  tmpColor.setHex(hex);
  tmpColor.multiplyScalar(f);
  return tmpColor.getHex();
};

interface Geometries {
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  upperArm: THREE.BufferGeometry;
  foreArm: THREE.BufferGeometry;
  thigh: THREE.BufferGeometry;
  shin: THREE.BufferGeometry;
}

function buildTorso(s: PersonSpec, d: Dims): THREE.BufferGeometry {
  const p = new Parts();
  const dress = s.outfit === 'dress';
  const kaftan = s.outfit === 'kaftan';
  const work = s.outfit === 'workwear';
  const lower = dress || kaftan || work ? s.top : s.bottom;
  const chestY = d.torso * 0.72;

  // Pelvis and waist.
  p.sphere(1, lower, [0, d.torso * 0.02, 0], [d.hipW * 0.52, d.torso * 0.28, d.chestDepth * 0.62]);
  p.cyl(d.waistR * 1.05, d.waistR * 1.15, d.torso * 0.34, s.top, [0, d.torso * 0.2, 0], [1, 1, (d.chestDepth * 0.5) / d.waistR]);
  // Chest.
  p.sphere(1, s.top, [0, chestY, 0], [d.shoulderW * 0.5, d.torso * 0.34, d.chestDepth * 0.54]);
  if (s.female) {
    p.sphere(d.chestDepth * 0.22, s.top, [-d.shoulderW * 0.15, chestY - d.torso * 0.04, d.chestDepth * 0.4]);
    p.sphere(d.chestDepth * 0.22, s.top, [d.shoulderW * 0.15, chestY - d.torso * 0.04, d.chestDepth * 0.4]);
  }

  // Neck.
  p.cyl(d.limbR * 0.7, d.limbR * 0.8, d.neck * 1.4, s.skin, [0, d.torso + d.neck * 0.3, 0], [1, 1, 1]);
  if (s.outfit === 'shirt' || work) {
    p.cyl(d.limbR * 1.0, d.limbR * 1.15, d.neck * 0.5, work ? s.accent : s.top, [0, d.torso + d.neck * 0.05, 0]);
  }

  // Skirt, tunic, or overall legs.
  if (dress) {
    const len = d.thigh + d.shin * 0.35;
    p.cyl(d.waistR * 1.15, d.hipW * 0.82, len, s.top, [0, -len / 2 + d.torso * 0.16, 0], [1, 1, 0.85], undefined, 14);
    p.cyl(d.hipW * 0.82, d.hipW * 0.84, d.height * 0.015, s.accent, [0, -len + d.torso * 0.16 + d.height * 0.008, 0], [1, 1, 0.85], undefined, 14);
  } else if (kaftan) {
    const len = d.thigh * 1.05;
    p.cyl(d.waistR * 1.2, d.hipW * 0.7, len, s.top, [0, -len / 2 + d.torso * 0.2, 0], [1, 1, 0.9], undefined, 14);
    p.cyl(d.hipW * 0.7, d.hipW * 0.71, d.height * 0.02, s.accent, [0, -len + d.torso * 0.2 + d.height * 0.01, 0], [1, 1, 0.9], undefined, 14);
    // A narrow front placket only, so nothing shows on the back.
    p.box(d.shoulderW * 0.1, d.torso * 0.5, d.height * 0.012, s.accent, [0, chestY * 0.8, d.chestDepth * 0.54]);
  } else if (work) {
    p.box(d.shoulderW * 0.28, d.torso * 0.16, d.chestDepth * 0.12, shade(s.top, 0.75), [d.shoulderW * 0.2, chestY, d.chestDepth * 0.54]);
  }
  if (s.outfit === 'tee' || s.outfit === 'shirt') {
    // A belt line.
    p.cyl(d.waistR * 1.18, d.waistR * 1.18, d.height * 0.012, 0x1c1814, [0, d.torso * 0.04, 0], [1, 1, (d.chestDepth * 0.5) / d.waistR]);
  }

  // Bag: a shoulder bag with a strap.
  if (s.accessory === 'bag') {
    const bagColor = shade(s.accent, 0.85);
    p.box(d.height * 0.07, d.height * 0.09, d.height * 0.17, bagColor, [d.hipW * 0.62, -d.height * 0.02, 0]);
    p.box(d.height * 0.012, d.torso * 1.0, d.height * 0.012, bagColor, [0, chestY * 0.6, d.chestDepth * 0.5], [0, 0, 0.62]);
  }
  return p.build();
}

function buildHead(s: PersonSpec, d: Dims): THREE.BufferGeometry {
  const p = new Parts();
  const R = d.headR;
  const cy = R * 0.95;
  const lipTone = shade(s.skin, 0.62);

  p.sphere(R, s.skin, [0, cy, 0], [0.88, 1.08, 0.98]);
  // Jaw and chin.
  p.sphere(R * 0.78, s.skin, [0, cy - R * 0.38, R * 0.08], [0.95, 0.85, 0.95]);
  // Nose, ears, eyes, brows, mouth.
  p.sphere(R * 0.17, shade(s.skin, 1.04), [0, cy - R * 0.12, R * 0.97], [1.2, 1.5, 1]);
  p.sphere(R * 0.2, s.skin, [-R * 0.86, cy - R * 0.05, 0], [0.5, 1.1, 0.8]);
  p.sphere(R * 0.2, s.skin, [R * 0.86, cy - R * 0.05, 0], [0.5, 1.1, 0.8]);
  p.sphere(R * 0.085, 0xf4efe6, [-R * 0.33, cy + R * 0.12, R * 0.85], [1.3, 0.8, 0.5]);
  p.sphere(R * 0.085, 0xf4efe6, [R * 0.33, cy + R * 0.12, R * 0.85], [1.3, 0.8, 0.5]);
  p.sphere(R * 0.055, 0x16100c, [-R * 0.33, cy + R * 0.12, R * 0.9], [1, 1, 0.5]);
  p.sphere(R * 0.055, 0x16100c, [R * 0.33, cy + R * 0.12, R * 0.9], [1, 1, 0.5]);
  p.box(R * 0.36, R * 0.05, R * 0.06, 0x16100c, [-R * 0.33, cy + R * 0.3, R * 0.86], [0, 0, 0.08]);
  p.box(R * 0.36, R * 0.05, R * 0.06, 0x16100c, [R * 0.33, cy + R * 0.3, R * 0.86], [0, 0, -0.08]);
  p.box(R * 0.42, R * 0.08, R * 0.08, lipTone, [0, cy - R * 0.5, R * 0.86]);

  const hair = s.hairColor;
  const cap = (): void => {
    p.sphere(R, hair, [0, cy + R * 0.22, -R * 0.06], [0.94, 0.86, 1.02]);
  };
  switch (s.hair) {
    case 'lowcut':
      cap();
      break;
    case 'afro':
      p.sphere(R * 1.3, hair, [0, cy + R * 0.32, -R * 0.14], [1, 0.95, 1]);
      break;
    case 'cornrows': {
      cap();
      for (let i = -3; i <= 3; i++) {
        const x = i * R * 0.24;
        const y = cy + R * 0.22 + R * 0.86 * Math.sqrt(Math.max(0, 1 - (x / (R * 0.94)) ** 2));
        p.box(R * 0.07, R * 0.07, R * 1.5, shade(hair, 1.7), [x, y, -R * 0.06]);
      }
      break;
    }
    case 'braids': {
      cap();
      for (let i = 0; i < 9; i++) {
        const a = -1.7 + (i / 8) * 3.4;
        const x = Math.sin(a) * R * 0.95;
        const z = -Math.cos(a) * R * 0.85 - R * 0.05;
        p.cyl(R * 0.07, R * 0.05, d.height * 0.16, hair, [x, cy + R * 0.1 - d.height * 0.07, z]);
      }
      break;
    }
    case 'wrap':
      p.sphere(R * 1.12, s.accent, [0, cy + R * 0.38, -R * 0.06], [1.02, 0.95, 1.08]);
      p.sphere(R * 0.5, s.accent, [R * 0.45, cy + R * 1.1, -R * 0.1]);
      p.sphere(R * 0.4, shade(s.accent, 0.85), [-R * 0.1, cy + R * 1.2, -R * 0.15]);
      break;
    case 'scarf':
      p.sphere(R * 1.02, s.accent, [0, cy + R * 0.2, -R * 0.1], [0.98, 0.9, 1.06]);
      p.box(R * 0.8, R * 1.0, R * 0.25, s.accent, [0, cy - R * 0.35, -R * 0.95]);
      break;
    case 'bald':
      break;
  }

  if (s.accessory === 'cap') {
    p.sphere(R * 1.06, s.accent, [0, cy + R * 0.34, -R * 0.02], [0.96, 0.62, 1.04]);
    p.box(R * 1.2, R * 0.07, R * 0.75, shade(s.accent, 0.8), [0, cy + R * 0.34, R * 0.95]);
  } else if (s.accessory === 'glasses') {
    p.torus(R * 0.25, R * 0.035, 0x22201e, [-R * 0.36, cy + R * 0.12, R * 0.93]);
    p.torus(R * 0.25, R * 0.035, 0x22201e, [R * 0.36, cy + R * 0.12, R * 0.93]);
    p.box(R * 0.22, R * 0.035, R * 0.035, 0x22201e, [0, cy + R * 0.14, R * 0.93]);
  } else if (s.accessory === 'headLoad') {
    // A folded cloth pad and a basket of produce.
    p.cyl(R * 0.7, R * 0.8, R * 0.18, shade(s.accent, 0.9), [0, cy + R * 1.0, 0]);
    p.cyl(R * 1.1, R * 0.85, R * 0.5, 0xb88a4a, [0, cy + R * 1.35, 0], [1, 1, 1], undefined, 14);
    p.sphere(R * 0.38, 0xe0762b, [-R * 0.4, cy + R * 1.78, 0]);
    p.sphere(R * 0.36, 0x4fa83d, [R * 0.35, cy + R * 1.76, R * 0.1]);
    p.sphere(R * 0.34, 0xd1382b, [0, cy + R * 1.9, -R * 0.3]);
  }
  return p.build();
}

function buildArms(s: PersonSpec, d: Dims): { upper: THREE.BufferGeometry; fore: THREE.BufferGeometry } {
  const sleeveColor = s.top;
  const r = d.limbR;
  const upper = new Parts();
  const fore = new Parts();
  const bare = s.skin;

  upper.sphere(r * 1.06, s.sleeves === 'none' ? bare : sleeveColor, [0, 0, 0]);
  if (s.sleeves === 'long') {
    upper.cyl(r * 1.12, r * 0.98, d.upperArm, sleeveColor, [0, -d.upperArm / 2, 0]);
  } else if (s.sleeves === 'short') {
    const sl = d.upperArm * 0.5;
    upper.cyl(r * 1.15, r * 1.05, sl, sleeveColor, [0, -sl / 2, 0]);
    upper.cyl(r * 1.0, r * 0.95, d.upperArm - sl, bare, [0, -sl - (d.upperArm - sl) / 2, 0]);
  } else {
    upper.cyl(r * 1.05, r * 0.95, d.upperArm, bare, [0, -d.upperArm / 2, 0]);
  }

  const foreColor = s.sleeves === 'long' ? sleeveColor : bare;
  fore.sphere(r * 0.98, s.sleeves === 'long' ? sleeveColor : bare, [0, 0, 0]);
  fore.cyl(r * 0.96, r * 0.7, d.foreArm, foreColor, [0, -d.foreArm / 2, 0]);
  fore.sphere(r * 0.95, bare, [0, -d.foreArm - d.hand * 0.35, d.hand * 0.05], [0.95, 1.25, 0.7]);
  return { upper: upper.build(), fore: fore.build() };
}

function buildLegs(s: PersonSpec, d: Dims): { thigh: THREE.BufferGeometry; shin: THREE.BufferGeometry } {
  const r = d.limbR;
  const thigh = new Parts();
  const shin = new Parts();
  const work = s.outfit === 'workwear';
  const trousers = work ? s.top : s.bottom;
  const thighBare = s.outfit === 'dress';
  const thighColor = thighBare ? s.skin : trousers;
  const shinBare = thighBare || s.shorts;
  const shinColor = shinBare ? s.skin : trousers;

  thigh.sphere(r * 1.45, thighColor, [0, 0, 0]);
  thigh.cyl(r * 1.5, r * 1.12, d.thigh, thighColor, [0, -d.thigh / 2, 0]);
  shin.sphere(r * 1.12, s.shorts ? s.skin : thighColor, [0, 0, 0]);
  shin.cyl(r * 1.1, r * 0.72, d.shin, shinColor, [0, -d.shin / 2, 0]);
  // Shoe: a rounded block that extends forward of the ankle.
  const footLen = d.height * 0.15;
  shin.box(r * 2.0, d.foot, footLen, s.shoes, [0, -d.shin - d.foot * 0.35, footLen * 0.28]);
  shin.sphere(r * 1.0, s.shoes, [0, -d.shin - d.foot * 0.3, footLen * 0.72], [1, 0.55, 0.9]);
  return { thigh: thigh.build(), shin: shin.build() };
}

export interface Person {
  /** Add this to the scene. Position and rotation.y place the person; forward is +z. */
  root: THREE.Group;
  spec: PersonSpec;
  dims: Dims;
  /** The pose currently shown. */
  pose: Pose;
  /** A closed umbrella shape held in the right hand. Hidden by default. */
  umbrella: THREE.Group;
  /** Blend toward `target` and apply to the skeleton. */
  animate(target: Pose, dt: number, rate?: number): void;
  /** Show the pose immediately with no blending. */
  snapTo(target: Pose): void;
  /** Remove from its parent. Geometry belongs to the template and is not freed. */
  detach(): void;
}

export interface PersonTemplate {
  spec: PersonSpec;
  dims: Dims;
  instantiate(options?: { castShadow?: boolean }): Person;
  dispose(): void;
}

export function buildTemplate(spec: PersonSpec): PersonTemplate {
  const dims = computeDims(spec);
  const arms = buildArms(spec, dims);
  const legs = buildLegs(spec, dims);
  const geo: Geometries = {
    torso: buildTorso(spec, dims),
    head: buildHead(spec, dims),
    upperArm: arms.upper,
    foreArm: arms.fore,
    thigh: legs.thigh,
    shin: legs.shin,
  };
  const all = Object.values(geo);
  const umbrellaGeo = buildUmbrellaGeometry(dims);

  return {
    spec,
    dims,
    instantiate(options = {}) {
      const mat = material();
      const mesh = (g: THREE.BufferGeometry): THREE.Mesh => {
        const m = new THREE.Mesh(g, mat);
        m.castShadow = options.castShadow ?? false;
        m.frustumCulled = true;
        return m;
      };
      const pivot = (x: number, y: number, z: number, parent: THREE.Object3D): THREE.Group => {
        const g = new THREE.Group();
        g.position.set(x, y, z);
        parent.add(g);
        return g;
      };

      const root = new THREE.Group();
      const hips = pivot(0, dims.hipY, 0, root);
      hips.add(mesh(geo.torso));
      const head = pivot(0, dims.torso + dims.neck, 0, hips);
      head.add(mesh(geo.head));

      const shoulderX = dims.shoulderW * 0.42;
      const shoulderY = dims.torso * 0.94;
      const lSh = pivot(shoulderX, shoulderY, 0, hips);
      const rSh = pivot(-shoulderX, shoulderY, 0, hips);
      lSh.add(mesh(geo.upperArm));
      rSh.add(mesh(geo.upperArm));
      const lEl = pivot(0, -dims.upperArm, 0, lSh);
      const rEl = pivot(0, -dims.upperArm, 0, rSh);
      lEl.add(mesh(geo.foreArm));
      rEl.add(mesh(geo.foreArm));

      const hipX = dims.hipW * 0.3;
      const lHipJ = pivot(hipX, 0, 0, hips);
      const rHipJ = pivot(-hipX, 0, 0, hips);
      lHipJ.add(mesh(geo.thigh));
      rHipJ.add(mesh(geo.thigh));
      const lKnee = pivot(0, -dims.thigh, 0, lHipJ);
      const rKnee = pivot(0, -dims.thigh, 0, rHipJ);
      lKnee.add(mesh(geo.shin));
      rKnee.add(mesh(geo.shin));

      const umbrella = new THREE.Group();
      umbrella.add(mesh(umbrellaGeo));
      umbrella.position.set(0, -dims.foreArm - dims.hand * 0.2, 0);
      // Cancels the arm's raised pose so the canopy points up while held.
      umbrella.rotation.x = 1.8;
      umbrella.visible = false;
      rEl.add(umbrella);

      const pose = neutralPose();
      const apply = (): void => {
        hips.position.y = dims.hipY + pose.hipY;
        hips.rotation.set(pose.lean + pose.pitch, pose.spin, pose.roll + pose.bank);
        head.rotation.set(pose.headPitch, pose.headYaw, 0);
        lHipJ.rotation.x = pose.lHip;
        rHipJ.rotation.x = pose.rHip;
        lKnee.rotation.x = pose.lKnee;
        rKnee.rotation.x = pose.rKnee;
        lSh.rotation.set(pose.lSh, 0, pose.lShRoll);
        rSh.rotation.set(pose.rSh, 0, pose.rShRoll);
        lEl.rotation.x = pose.lEl;
        rEl.rotation.x = pose.rEl;
      };
      apply();

      return {
        root,
        spec,
        dims,
        pose,
        umbrella,
        animate(target, dt, rate = 14) {
          blendPose(pose, target, dt, rate);
          apply();
        },
        snapTo(target) {
          Object.assign(pose, target);
          apply();
        },
        detach() {
          root.removeFromParent();
        },
      };
    },
    dispose() {
      for (const g of all) g.dispose();
      umbrellaGeo.dispose();
    },
  };
}

export function buildUmbrellaGeometry(d: Dims): THREE.BufferGeometry {
  const p = new Parts();
  const len = d.height * 0.5;
  p.cyl(d.limbR * 0.18, d.limbR * 0.18, len, 0x2a2420, [0, len * 0.5, 0]);
  p.cyl(d.height * 0.01, d.height * 0.27, d.height * 0.1, 0x2a6f9e, [0, len + d.height * 0.04, 0], [1, 1, 1], undefined, 12);
  p.sphere(d.limbR * 0.3, 0x2a2420, [0, len + d.height * 0.1, 0]);
  return p.build();
}
