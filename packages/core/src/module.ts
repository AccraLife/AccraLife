import type { EventBus } from './eventBus';
import type { GameEvents, Phase } from './events';
import type { Rng } from './rng';
import type { ServiceRegistry } from './services';

/** Runtime settings. Persisted by SAV, applied by PRF and the modules that read them. */
export interface GameConfig {
  seed: number;
  /** Fixed simulation step in Hz (SRS 3.2: 30 Hz by default). */
  tickHz: number;
  /** 'auto' picks a tier from the device. */
  quality: 'auto' | 'low' | 'medium' | 'high';
  /** Chunks loaded around the player (Chebyshev radius). */
  viewRadius: number;
  /** 0..1 multipliers applied to the PRF budgets. */
  crowdDensity: number;
  trafficDensity: number;
  /** Renderer resolution multiplier (0.5 to 1). */
  resolutionScale: number;
  /** Game minutes per real second (SRS ENV-001: 0.5 = a day lasts 48 real minutes). */
  gameMinutesPerRealSecond: number;
  masterVolume: number;
  showDebug: boolean;
  /** Mouse look sensitivity multiplier. */
  mouseSensitivity: number;
  /** True once the player has changed graphics settings, so tier detection stops overriding them. */
  userTuned: boolean;
}

export function defaultConfig(): GameConfig {
  return {
    seed: 20261013,
    tickHz: 30,
    quality: 'auto',
    viewRadius: 3,
    crowdDensity: 1,
    trafficDensity: 1,
    resolutionScale: 1,
    gameMinutesPerRealSecond: 0.5,
    masterVolume: 0.6,
    showDebug: false,
    mouseSensitivity: 1,
    userTuned: false,
  };
}

export interface GameState {
  phase: Phase;
}

export type RenderHook = (dt: number, alpha: number) => void;

/** Everything a module may use. Passed to `init`. */
export interface GameContext {
  readonly events: EventBus<GameEvents>;
  readonly services: ServiceRegistry;
  readonly config: GameConfig;
  readonly state: GameState;
  /** The root random generator. Fork it with a label for your own stream. */
  readonly rng: Rng;
  /** Register a function to run every rendered frame. Lower priority runs first. */
  onRender(priority: number, hook: RenderHook): void;
  setPhase(phase: Phase): void;
  /** For SAV and debug tools. */
  modules(): readonly GameModule[];
  /** Resolves on the next macrotask so the browser can paint progress. */
  yieldToBrowser(): Promise<void>;
}

/**
 * THE MODULE CONTRACT (SRS INT-001).
 * Every module exports one object implementing this interface.
 * The Core loads modules in dependency order.
 */
export interface GameModule {
  id: string;
  /** Semver of this module's public API. */
  version: string;
  /** Module ids that must init first. Dependencies must form a graph with no cycles. */
  dependsOn: string[];
  /** Keep updating while the game is paused or in a menu (for example world streaming). */
  alwaysUpdate?: boolean;
  init(ctx: GameContext): Promise<void> | void;
  /** Called once when a new or loaded game begins. */
  start(): void;
  /** Fixed-step update. Stay within budgetMs where you can. */
  update(dt: number, budgetMs: number): void;
  stop(): void;
  /** Free every resource (listeners, GPU memory, DOM). */
  dispose(): void;
  /** Plain JSON for SAV. */
  serialize(): unknown;
  deserialize(data: unknown, version: string): void;
}

/** A do-nothing base so modules only write what they need. */
export function defineModule(
  partial: Pick<GameModule, 'id' | 'version' | 'dependsOn'> & Partial<GameModule>,
): GameModule {
  return {
    init() {},
    start() {},
    update() {},
    stop() {},
    dispose() {},
    serialize() {
      return {};
    },
    deserialize() {},
    ...partial,
  };
}

/** Order modules so dependencies come first. Throws on cycles and missing dependencies. */
export function orderModules(modules: readonly GameModule[]): GameModule[] {
  const byId = new Map<string, GameModule>();
  for (const m of modules) {
    if (byId.has(m.id)) throw new Error(`[core] duplicate module id "${m.id}"`);
    byId.set(m.id, m);
  }
  const ordered: GameModule[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (m: GameModule, trail: string[]): void => {
    const s = state.get(m.id);
    if (s === 'done') return;
    if (s === 'visiting') {
      throw new Error(`[core] dependency cycle: ${[...trail, m.id].join(' -> ')}`);
    }
    state.set(m.id, 'visiting');
    for (const depId of m.dependsOn) {
      const dep = byId.get(depId);
      if (!dep) throw new Error(`[core] module "${m.id}" depends on missing module "${depId}"`);
      visit(dep, [...trail, m.id]);
    }
    state.set(m.id, 'done');
    ordered.push(m);
  };

  for (const m of modules) visit(m, []);
  return ordered;
}
