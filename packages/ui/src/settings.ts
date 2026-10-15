import type { GameConfig } from '@accra/core';

/** Settings that persist between visits (SRS UIX settings). Stored in localStorage, never required. */
export const SETTINGS_KEY = 'accra-life.settings.v1';

export type StoredSettings = Pick<
  GameConfig,
  | 'quality'
  | 'viewRadius'
  | 'crowdDensity'
  | 'trafficDensity'
  | 'resolutionScale'
  | 'masterVolume'
  | 'showDebug'
  | 'mouseSensitivity'
  | 'userTuned'
>;

const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;

/** Turn untrusted stored data into a safe partial config. Unknown or invalid fields are dropped. */
export function sanitizeSettings(raw: unknown): Partial<StoredSettings> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<StoredSettings> = {};
  if (r.quality === 'auto' || r.quality === 'low' || r.quality === 'medium' || r.quality === 'high') out.quality = r.quality;
  const view = num(r.viewRadius, 1, 3);
  if (view !== undefined) out.viewRadius = Math.round(view);
  const crowd = num(r.crowdDensity, 0, 1);
  if (crowd !== undefined) out.crowdDensity = crowd;
  const traffic = num(r.trafficDensity, 0, 1);
  if (traffic !== undefined) out.trafficDensity = traffic;
  const res = num(r.resolutionScale, 0.5, 1);
  if (res !== undefined) out.resolutionScale = res;
  const vol = num(r.masterVolume, 0, 1);
  if (vol !== undefined) out.masterVolume = vol;
  const sens = num(r.mouseSensitivity, 0.3, 3);
  if (sens !== undefined) out.mouseSensitivity = sens;
  if (typeof r.showDebug === 'boolean') out.showDebug = r.showDebug;
  if (typeof r.userTuned === 'boolean') out.userTuned = r.userTuned;
  return out;
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Partial<StoredSettings> {
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    return text ? sanitizeSettings(JSON.parse(text)) : {};
  } catch {
    return {};
  }
}

export function saveSettings(config: GameConfig, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  const data: StoredSettings = {
    quality: config.quality,
    viewRadius: config.viewRadius,
    crowdDensity: config.crowdDensity,
    trafficDensity: config.trafficDensity,
    resolutionScale: config.resolutionScale,
    masterVolume: config.masterVolume,
    showDebug: config.showDebug,
    mouseSensitivity: config.mouseSensitivity,
    userTuned: config.userTuned,
  };
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(data));
  } catch {
    /* private mode or full: settings just will not persist */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
