import {
  GAME_VERSION,
  type GameContext,
  type GameModule,
  type SaveService,
  type SaveSummary,
  defineModule,
} from '@accra/core';
import { makeEnvelope, parseEnvelope, slotLabel } from './envelope';
import { type SaveStore, indexedDbStore, memoryStore } from './store';

export * from './envelope';
export * from './store';

/**
 * SAV: saving and loading (SRS section 15).
 * Slots "auto", "slot1".."slot3". Autosave each new day and every five real minutes.
 */
const AUTOSAVE_MS = 5 * 60 * 1000;
const SELF = 'save';

export function createSaveModule(): GameModule {
  let ctx: GameContext;
  let store: SaveStore = memoryStore();
  let lastAuto = 0;
  let busy = false;
  const offs: Array<() => void> = [];

  const gather = (): Record<string, { version: string; data: unknown }> => {
    const out: Record<string, { version: string; data: unknown }> = {};
    for (const m of ctx.modules()) {
      if (m.id === SELF) continue;
      out[m.id] = { version: m.version, data: m.serialize() };
    }
    return out;
  };

  const makeLabel = (): string => {
    const t = ctx.services.get('env').now();
    const eco = ctx.services.tryGet('economy');
    return slotLabel(t.day, t.hour, t.minute, eco ? eco.format(eco.balance()) : '');
  };

  const service: SaveService = {
    async save(slot) {
      const env = makeEnvelope(GAME_VERSION, makeLabel(), gather());
      await store.put(slot, JSON.stringify(env));
      ctx.events.emit('saved', { slot });
    },

    async load(slot) {
      const text = await store.get(slot);
      if (!text) return false;
      const parsed = parseEnvelope(text);
      if (!parsed.ok) {
        ctx.events.emit('notify', { text: parsed.reason, kind: 'warn' });
        return false;
      }
      const world = ctx.services.get('world');
      for (const m of ctx.modules()) {
        const entry = parsed.envelope.modules[m.id];
        if (m.id === SELF || !entry) continue;
        try {
          m.deserialize(entry.data, entry.version);
        } catch (error) {
          console.error(`[save] ${m.id} failed to load`, error);
        }
      }
      const p = ctx.services.get('player').position();
      await world.ensureLoaded(p.x, p.z, 1);
      ctx.events.emit('loaded', { slot });
      return true;
    },

    async list() {
      const out: SaveSummary[] = [];
      for (const key of await store.keys()) {
        const text = await store.get(key);
        if (!text) continue;
        const parsed = parseEnvelope(text);
        if (parsed.ok) {
          out.push({ slot: key, savedAt: parsed.envelope.savedAt, gameVersion: parsed.envelope.gameVersion, label: parsed.envelope.label });
        }
      }
      return out.sort((a, b) => b.savedAt - a.savedAt);
    },

    async remove(slot) {
      await store.remove(slot);
    },

    async exportSave(slot) {
      const text = await store.get(slot);
      if (!text) return;
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `accra-life-${slot}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    async importSave(file, slot) {
      const text = await file.text();
      const parsed = parseEnvelope(text);
      if (!parsed.ok) {
        ctx.events.emit('notify', { text: parsed.reason, kind: 'warn' });
        return false;
      }
      await store.put(slot, text);
      return true;
    },
  };

  const autosave = (): void => {
    if (busy || ctx.state.phase !== 'playing') return;
    busy = true;
    lastAuto = performance.now();
    service
      .save('auto')
      .catch((e) => console.warn('[save] autosave failed', e))
      .finally(() => {
        busy = false;
      });
  };

  return defineModule({
    id: SELF,
    version: '0.1.0',
    dependsOn: ['world', 'env', 'player'],
    alwaysUpdate: true,

    async init(context) {
      ctx = context;
      try {
        store = await indexedDbStore();
      } catch {
        store = memoryStore();
        console.warn('[save] IndexedDB unavailable, saves will not persist');
      }
      ctx.services.register('save', service);
      offs.push(ctx.events.on('dayChanged', autosave));
    },

    start() {
      lastAuto = performance.now();
    },

    update() {
      if (ctx.state.phase === 'playing' && performance.now() - lastAuto > AUTOSAVE_MS) autosave();
    },

    dispose() {
      for (const off of offs) off();
    },
  });
}
