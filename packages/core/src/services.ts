import type * as THREE from 'three';
import type { Rng } from './rng';
import type { GameTime, Weather } from './time';
import type { NeedId } from './events';
import type { Appearance } from './appearance';

/**
 * SERVICE CONTRACTS (SRS INT-020).
 * Each module publishes one typed service. Other modules depend on these
 * interfaces, never on another module's internals. Services are read-mostly:
 * state changes go through explicit commands that validate and emit events.
 */

export type QualityTier = 'low' | 'medium' | 'high';

export interface Vec2 {
  x: number;
  z: number;
}

// ---------- PRF ----------
export interface RenderService {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** The tier currently in effect (after auto-detection). */
  tier(): QualityTier;
  shadowsEnabled(): boolean;
  shadowMapSize(): number;
}

export interface PerfService {
  fps(): number;
  frameMs(): number;
  drawCalls(): number;
  triangles(): number;
  /** Milliseconds each module spent in its last update, for the debug overlay. */
  moduleMs(): Record<string, number>;
}

// ---------- WLD ----------
export type SurfaceKind = 'road' | 'sidewalk' | 'ground';
export type TravelKind = 'pedestrian' | 'vehicle';

/** Cardinal heading: 0 = +x (east), 1 = +z (south), 2 = -x (west), 3 = -z (north). */
export type Heading = 0 | 1 | 2 | 3;

export interface Waypoint {
  x: number;
  z: number;
  heading: Heading;
}

export interface Landmark {
  id: string;
  name: string;
  x: number;
  z: number;
}

export interface PointOfInterest {
  id: string;
  /** chopbar, kiosk, work, home, trotro. */
  kind: string;
  name: string;
  x: number;
  z: number;
  /** Text shown on the interaction prompt, for example "Eat at Kofi's Kitchen (GHS 15)". */
  prompt: string;
}

export interface WorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WorldService {
  readonly chunkSize: number;
  readonly bounds: WorldBounds;
  /** Where the player starts a new game. */
  spawnPoint(): Vec2;
  groundHeightAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): SurfaceKind;
  /** Push a circle out of buildings and props and keep it inside the district. */
  resolveCollision(x: number, z: number, radius: number): Vec2;
  districtAt(x: number, z: number): { id: string; name: string } | null;
  isLoaded(x: number, z: number): boolean;
  loadedChunkCount(): number;
  /** Resolve once the chunks around a point have been built (used after loading a save). */
  ensureLoaded(x: number, z: number, radiusChunks: number): Promise<void>;
  /**
   * Pick the next waypoint for something travelling along the street grid.
   * Call it when you reach your current waypoint. Vehicles keep right, pedestrians use the right sidewalk.
   */
  nextWaypoint(from: Vec2, heading: Heading, kind: TravelKind, rng: Rng): Waypoint;
  /** A random lane point near an intersection close to (x, z), for spawning. */
  randomLanePoint(x: number, z: number, minDist: number, maxDist: number, kind: TravelKind, rng: Rng): Waypoint | null;
  landmarks(): readonly Landmark[];
  pointsOfInterest(kind?: string): readonly PointOfInterest[];
  nearestPoi(x: number, z: number, maxDist: number): PointOfInterest | null;
}

// ---------- ENV ----------
export interface EnvService {
  now(): GameTime;
  weather(): Weather;
  /** 0 = full daylight, 1 = deep night. */
  nightFactor(): number;
  /** Game minutes that pass per real second. */
  speed(): number;
  setSpeed(minutesPerRealSecond: number): void;
  setWeather(weather: Weather): void;
  /** Jump the clock forward (sleep, fainting, debug). Emits the usual tick events. */
  advanceMinutes(minutes: number): void;
  setTimeOfDay(hour: number): void;
  isHoliday(): string | null;
}

// ---------- PLY ----------
export interface PlayerService {
  position(): THREE.Vector3;
  yaw(): number;
  /** Current horizontal speed in metres per second. */
  speed(): number;
  teleport(x: number, z: number): void;
  appearance(): Appearance;
  setAppearance(appearance: Appearance): void;
  /** Push the player's body: stagger, fall or tumble depending on strength (m/s). Direction is the way they are pushed. */
  applyImpact(impact: { dirX: number; dirZ: number; strength: number; kind: 'bump' | 'shove' | 'wall' | 'vehicle' | 'slip' }): void;
  /** True while the player is staggering, falling or lying and cannot be steered. */
  isDown(): boolean;
}

// ---------- VEH ----------
export interface VehicleHit {
  /** Unit direction the vehicle is travelling (the way it throws a person). */
  dirX: number;
  dirZ: number;
  /** Vehicle speed in m/s. */
  speed: number;
}

export interface VehicleService {
  /**
   * Is a moving vehicle hitting a person standing at (x, z) with this radius? Returns the hit and makes that
   * vehicle brake hard. Returns null when nothing is hitting.
   */
  collide(x: number, z: number, radius: number): VehicleHit | null;
}

// ---------- ECO ----------
export interface EconomyService {
  balance(): number;
  /** Money owed (unpaid bills). */
  debt(): number;
  /** Returns false (and changes nothing) if the player cannot afford it. */
  charge(amount: number, reason: string): boolean;
  earn(amount: number, reason: string): void;
  format(amount: number): string;
}

// ---------- LIF ----------
export interface LifeService {
  need(id: NeedId): number;
  needs(): Readonly<Record<NeedId, number>>;
  health(): number;
  /** Add (or subtract, if negative) points to a need, clamped to 0..100. */
  restore(id: NeedId, amount: number): void;
  /** 1 normally; below 1 when exhausted, hungry or thirsty (LIF-003). */
  moveFactor(): number;
  isPowerOn(): boolean;
}

// ---------- ECO (missions) ----------
export interface MissionService {
  current(): { title: string; step: string; progress: string } | null;
  completedCount(): number;
  /** Tell the mission system something happened, for example "ate" or "landmark:arch". */
  report(tag: string): void;
}

// ---------- SAV ----------
export interface SaveSummary {
  slot: string;
  savedAt: number;
  gameVersion: string;
  label: string;
}

export interface SaveService {
  save(slot: string): Promise<void>;
  load(slot: string): Promise<boolean>;
  list(): Promise<SaveSummary[]>;
  remove(slot: string): Promise<void>;
  exportSave(slot: string): Promise<void>;
  importSave(file: File, slot: string): Promise<boolean>;
}

/** The registry of every published service. Add new services here. */
export interface ServiceMap {
  render: RenderService;
  perf: PerfService;
  world: WorldService;
  env: EnvService;
  player: PlayerService;
  vehicles: VehicleService;
  economy: EconomyService;
  missions: MissionService;
  life: LifeService;
  save: SaveService;
}

export class ServiceRegistry {
  private map = new Map<keyof ServiceMap, unknown>();

  register<K extends keyof ServiceMap>(key: K, service: ServiceMap[K]): void {
    if (this.map.has(key)) {
      throw new Error(`[core] service "${key}" is already registered`);
    }
    this.map.set(key, service);
  }

  /** Replace a service (used by tests and mock modules). */
  override<K extends keyof ServiceMap>(key: K, service: ServiceMap[K]): void {
    this.map.set(key, service);
  }

  get<K extends keyof ServiceMap>(key: K): ServiceMap[K] {
    const service = this.map.get(key);
    if (!service) throw new Error(`[core] service "${key}" is not registered`);
    return service as ServiceMap[K];
  }

  tryGet<K extends keyof ServiceMap>(key: K): ServiceMap[K] | undefined {
    return this.map.get(key) as ServiceMap[K] | undefined;
  }

  has(key: keyof ServiceMap): boolean {
    return this.map.has(key);
  }
}
