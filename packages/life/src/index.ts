import {
  type EnvService,
  type GameContext,
  type GameModule,
  type LifeService,
  type NeedId,
  PRICES,
  RENT_INTERVAL_DAYS,
  defineModule,
} from '@accra/core';
import { type LifeState, clamp100, faintReason, isPowerOn, moveFactor, startState, stepMinute } from './needs';

export * from './needs';

/**
 * LIF: life simulation (SRS section 11).
 * Needs, health, sleeping at home, fainting, weekly rent and dumsor (power cuts).
 */

const NEED_IDS: NeedId[] = ['hunger', 'thirst', 'energy', 'hygiene', 'mood'];

export function createLifeModule(): GameModule {
  let ctx: GameContext;
  let state: LifeState = startState();
  let power = true;
  let sleeping = false;
  const shown: Record<string, number> = {};
  const offs: Array<() => void> = [];

  const env = (): EnvService => ctx.services.get('env');
  const isRaining = (): boolean => {
    const w = env().weather();
    return w === 'lightRain' || w === 'heavyRain' || w === 'thunderstorm';
  };

  const publish = (id: NeedId): void => {
    const rounded = Math.round(state[id]);
    if (shown[id] !== rounded) {
      shown[id] = rounded;
      ctx.events.emit('needChanged', { need: id, value: rounded });
    }
  };

  const service: LifeService = {
    need: (id) => state[id],
    needs: () => ({
      hunger: state.hunger,
      thirst: state.thirst,
      energy: state.energy,
      hygiene: state.hygiene,
      mood: state.mood,
    }),
    health: () => state.health,
    restore(id, amount) {
      state[id] = clamp100(state[id] + amount);
      publish(id);
    },
    moveFactor: () => moveFactor(state),
    isPowerOn: () => power,
  };

  const checkPower = (totalMinutes: number): void => {
    const on = isPowerOn(totalMinutes, ctx.config.seed);
    if (on === power) return;
    power = on;
    ctx.events.emit('powerChanged', { on });
    ctx.events.emit('notify', {
      text: on ? 'Power is back on.' : 'Dumsor! The power is out. Lamps, windows and fans go dark.',
      kind: on ? 'good' : 'warn',
    });
  };

  const faint = (reason: string): void => {
    sleeping = true;
    ctx.events.emit('playerFainted', { reason });
    ctx.events.emit('activityStarted', { label: 'You blacked out...', seconds: 3 });
    env().advanceMinutes(240);
    sleeping = false;
    state.energy = Math.max(state.energy, 40);
    state.hunger = Math.max(state.hunger, 30);
    state.thirst = Math.max(state.thirst, 30);
    state.health = Math.max(state.health, 40);
    ctx.events.emit('notify', { text: `${reason} You wake up at home a few hours later.`, kind: 'warn' });
    const world = ctx.services.get('world');
    const home = world.pointsOfInterest('home')[0];
    if (home) {
      void world.ensureLoaded(home.x, home.z, 1).then(() => ctx.services.get('player').teleport(home.x + 2, home.z));
    }
  };

  const sleep = (): void => {
    const t = env().now();
    const tired = state.energy < 70 || t.hour >= 20 || t.hour < 5;
    if (!tired) {
      ctx.events.emit('notify', { text: 'You are not tired yet. Rest in the evening, or when your energy is low.', kind: 'info' });
      return;
    }
    const minuteOfDay = t.hour * 60 + t.minute;
    let minutes = (6 * 60 + 30 - minuteOfDay + 1440) % 1440;
    if (minutes < 240) minutes = 240;
    ctx.events.emit('activityStarted', { label: 'Sleeping...', seconds: 3 });
    sleeping = true;
    env().advanceMinutes(minutes);
    sleeping = false;
    state.energy = 100;
    state.hunger = clamp100(state.hunger - minutes * 0.02);
    state.thirst = clamp100(state.thirst - minutes * 0.03);
    state.hygiene = clamp100(state.hygiene + 35);
    state.health = clamp100(state.health + 15);
    state.mood = clamp100(state.mood + 8);
    for (const id of NEED_IDS) publish(id);
    ctx.events.emit('slept', { minutes });
    ctx.events.emit('notify', { text: 'You slept well and washed up. Good morning!', kind: 'good' });
  };

  return defineModule({
    id: 'life',
    version: '0.1.0',
    dependsOn: ['env', 'player', 'world'],

    init(context) {
      ctx = context;
      ctx.services.register('life', service);
      offs.push(
        ctx.events.on('minuteTick', ({ time }) => {
          checkPower(time.totalMinutes);
          if (sleeping) return;
          stepMinute(state, isRaining());
          for (const id of NEED_IDS) publish(id);
          const reason = faintReason(state);
          if (reason) faint(reason);
        }),
        ctx.events.on('hourChanged', ({ time }) => {
          if (time.hour === 8 && time.day > 0 && time.day % RENT_INTERVAL_DAYS === 0) {
            ctx.events.emit('billDue', { amount: PRICES.rent, reason: 'Weekly rent' });
          }
        }),
        ctx.events.on('interactionStarted', ({ kind }) => {
          if (kind === 'home') sleep();
        }),
      );
    },

    start() {
      state = startState();
      power = true;
      for (const id of NEED_IDS) publish(id);
    },

    update(dt) {
      // Running burns energy faster (real seconds, not game minutes).
      const speed = ctx.services.get('player').speed();
      if (speed > 4.5) state.energy = clamp100(state.energy - 0.15 * dt);
    },

    serialize() {
      return { ...state, power };
    },

    deserialize(data) {
      const d = data as (Partial<LifeState> & { power?: boolean }) | null;
      if (!d) return;
      const next = startState();
      for (const key of Object.keys(next) as Array<keyof LifeState>) {
        const v = d[key];
        if (typeof v === 'number') next[key] = clamp100(v);
      }
      state = next;
      const on = d.power ?? true;
      if (on !== power) {
        power = on;
        ctx.events.emit('powerChanged', { on });
      }
      for (const id of NEED_IDS) publish(id);
    },

    dispose() {
      for (const off of offs) off();
    },
  });
}
