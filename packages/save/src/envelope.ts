/**
 * Save file format (SRS SAV). Pure functions only, so they can be tested without a browser.
 * A save is a JSON envelope with a version, a timestamp, per-module data and a checksum.
 */
export const SAVE_FORMAT = 1;

export interface SaveEnvelope {
  format: number;
  gameVersion: string;
  savedAt: number;
  label: string;
  /** Module id -> { version, data } */
  modules: Record<string, { version: string; data: unknown }>;
  checksum: string;
}

type Unsigned = Omit<SaveEnvelope, 'checksum'>;

/** FNV-1a over the JSON text. Catches corruption and hand edits, not a security feature. */
export function checksumOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function body(env: Unsigned): string {
  return JSON.stringify({
    format: env.format,
    gameVersion: env.gameVersion,
    savedAt: env.savedAt,
    label: env.label,
    modules: env.modules,
  });
}

export function makeEnvelope(
  gameVersion: string,
  label: string,
  modules: Record<string, { version: string; data: unknown }>,
  savedAt: number = Date.now(),
): SaveEnvelope {
  const unsigned: Unsigned = { format: SAVE_FORMAT, gameVersion, savedAt, label, modules };
  return { ...unsigned, checksum: checksumOf(body(unsigned)) };
}

export type ParseResult = { ok: true; envelope: SaveEnvelope } | { ok: false; reason: string };

/** Migrations lift an older envelope one format at a time. Add one per format bump. */
const MIGRATIONS: Record<number, (old: any) => any> = {};

export function parseEnvelope(text: string): ParseResult {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'This file is not valid JSON.' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'This file is not a save.' };
  if (typeof raw.format !== 'number') return { ok: false, reason: 'Missing save format.' };
  if (raw.format > SAVE_FORMAT) return { ok: false, reason: 'This save is from a newer version of the game.' };
  while (raw.format < SAVE_FORMAT) {
    const migrate = MIGRATIONS[raw.format];
    if (!migrate) return { ok: false, reason: `No migration from save format ${raw.format}.` };
    raw = migrate(raw);
  }
  if (typeof raw.modules !== 'object' || raw.modules === null) return { ok: false, reason: 'Save has no data.' };
  const env: SaveEnvelope = {
    format: raw.format,
    gameVersion: String(raw.gameVersion ?? '0'),
    savedAt: Number(raw.savedAt ?? 0),
    label: String(raw.label ?? ''),
    modules: raw.modules,
    checksum: String(raw.checksum ?? ''),
  };
  if (checksumOf(body(env)) !== env.checksum) return { ok: false, reason: 'This save is damaged or was edited.' };
  return { ok: true, envelope: env };
}

export function slotLabel(day: number, hour: number, minute: number, balance: string): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `Day ${day + 1}, ${hh}:${mm} - ${balance}`;
}
