import { EventBus } from './eventBus';
import type { GameEvents, Phase } from './events';
import {
  type GameConfig,
  type GameContext,
  type GameModule,
  type GameState,
  type RenderHook,
  defaultConfig,
  orderModules,
} from './module';
import { Rng } from './rng';
import { ServiceRegistry } from './services';

interface RenderEntry {
  priority: number;
  hook: RenderHook;
}

/**
 * The game loop and module host.
 * - Fixed-step simulation (config.tickHz) calls module.update while playing.
 * - A render loop at display rate runs registered render hooks with an interpolation alpha.
 * - Modules are initialised in dependency order.
 */
export class Game {
  readonly events = new EventBus<GameEvents>();
  readonly services = new ServiceRegistry();
  readonly config: GameConfig;
  readonly state: GameState = { phase: 'loading' };
  readonly rng: Rng;

  private registered: GameModule[] = [];
  private ordered: GameModule[] = [];
  private renderHooks: RenderEntry[] = [];
  private moduleTimes: Record<string, number> = {};
  private started = false;
  private running = false;
  private rafId = 0;
  private lastFrame = 0;
  private accumulator = 0;
  private alpha = 0;
  private readonly ctx: GameContext;

  constructor(config: Partial<GameConfig> = {}) {
    this.config = { ...defaultConfig(), ...config };
    this.rng = new Rng(this.config.seed);
    this.ctx = {
      events: this.events,
      services: this.services,
      config: this.config,
      state: this.state,
      rng: this.rng,
      onRender: (priority, hook) => {
        this.renderHooks.push({ priority, hook });
        this.renderHooks.sort((a, b) => a.priority - b.priority);
      },
      setPhase: (phase) => this.setPhase(phase),
      modules: () => this.ordered,
      yieldToBrowser: () => new Promise((resolve) => setTimeout(resolve, 0)),
    };
  }

  register(module: GameModule): this {
    if (this.ordered.length > 0) throw new Error('[core] register modules before init()');
    this.registered.push(module);
    return this;
  }

  /** Initialise every module in dependency order, then show the menu. */
  async init(): Promise<void> {
    this.ordered = orderModules(this.registered);
    const total = this.ordered.length;
    for (let i = 0; i < total; i++) {
      const module = this.ordered[i] as GameModule;
      this.events.emit('loadProgress', { label: `Starting ${module.id}`, fraction: i / total });
      await this.ctx.yieldToBrowser();
      await module.init(this.ctx);
    }
    this.events.emit('loadProgress', { label: 'Ready', fraction: 1 });
    this.setPhase('menu');
  }

  /** Call module.start() once (new game state). Does not change the phase. */
  startModules(): void {
    if (this.started) return;
    this.started = true;
    for (const module of this.ordered) module.start();
  }

  /** Begin play for the first time. */
  start(): void {
    this.startModules();
    this.setPhase('playing');
  }

  setPhase(phase: Phase): void {
    const previous = this.state.phase;
    if (previous === phase) return;
    this.state.phase = phase;
    this.events.emit('phaseChanged', { phase, previous });
  }

  /** Start the render loop. Safe to call once after init(). */
  run(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const frame = (now: number): void => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(frame);
      this.frame(now);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  private frame(now: number): void {
    const rawDt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const dt = Math.min(Math.max(rawDt, 0), 0.1);
    const step = 1 / this.config.tickHz;

    this.accumulator += dt;
    let guard = 0;
    while (this.accumulator >= step && guard < 5) {
      this.accumulator -= step;
      guard++;
      this.tick(step);
    }
    if (guard >= 5) this.accumulator = 0;
    this.alpha = this.accumulator / step;

    for (const entry of this.renderHooks) {
      try {
        entry.hook(dt, this.alpha);
      } catch (error) {
        console.error('[core] render hook threw', error);
      }
    }
  }

  /** Run one fixed simulation step. Exposed for tests and replay tools. */
  tick(step: number): void {
    const playing = this.state.phase === 'playing';
    // 4 ms per module is the default slice. PRF reports modules that exceed it.
    const budgetMs = 4;
    for (const module of this.ordered) {
      if (!playing && !module.alwaysUpdate) continue;
      const t0 = performance.now();
      try {
        module.update(step, budgetMs);
      } catch (error) {
        console.error(`[core] module "${module.id}" update threw`, error);
      }
      this.moduleTimes[module.id] = performance.now() - t0;
    }
  }

  moduleTimings(): Record<string, number> {
    return this.moduleTimes;
  }

  getModule(id: string): GameModule | undefined {
    return this.ordered.find((m) => m.id === id);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    for (const module of [...this.ordered].reverse()) {
      try {
        module.stop();
        module.dispose();
      } catch (error) {
        console.error(`[core] module "${module.id}" dispose threw`, error);
      }
    }
    this.events.clear();
  }
}
