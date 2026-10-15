import type { GameTime, Weather } from './time';

/**
 * THE EVENT CATALOGUE (SRS INT-010).
 * Owned by Core. Only the owner module may emit each event; any module may listen.
 * Adding an event: announce it in communicate.md and bump the Core minor version.
 * Changing or removing one is a BREAKING change.
 */

export type Phase = 'loading' | 'menu' | 'playing' | 'paused';

export type NeedId = 'hunger' | 'thirst' | 'energy' | 'hygiene' | 'mood';

export interface GameEvents {
  // ---- Core ----
  loadProgress: { label: string; fraction: number };
  phaseChanged: { phase: Phase; previous: Phase };
  settingsChanged: { key: string };
  notify: { text: string; kind?: 'info' | 'good' | 'warn' };

  // ---- ENV ----
  minuteTick: { time: GameTime };
  hourChanged: { time: GameTime };
  dayChanged: { time: GameTime };
  weatherChanged: { weather: Weather; previous: Weather };
  /** night: 0 (day) to 1 (deep night). rain: 0 to 1. Emitted about four times a second. */
  lightingChanged: { night: number; rain: number };

  // ---- WLD ----
  chunkLoaded: { key: string };
  chunkUnloaded: { key: string };
  districtEntered: { id: string; name: string };
  districtExited: { id: string };
  landmarkDiscovered: { id: string; name: string };

  // ---- PLY ----
  playerMoved: { x: number; z: number; yaw: number };
  promptChanged: { text: string | null };
  interactionStarted: { kind: string; targetId: string };
  footstep: { surface: string };
  /** The player's body was hit or landed hard. strength is roughly m/s (nudge 1.5, sprint crash 5, car 9+). */
  impact: { x: number; z: number; strength: number; kind: 'bump' | 'shove' | 'wall' | 'vehicle' | 'slip' | 'land'; thud: boolean };

  // ---- NPC ----
  /** A pedestrian was knocked about. thud is true when they hit the ground. */
  npcImpact: { x: number; z: number; strength: number; kind: 'bump' | 'shove' | 'wall' | 'vehicle' | 'slip'; thud: boolean };

  // ---- ECO ----
  moneyChanged: { balance: number; delta: number; reason: string };
  missionChanged: { title: string; step: string | null; progress: string };

  // ---- LIF ----
  needChanged: { need: NeedId; value: number };
  playerFainted: { reason: string };
  slept: { minutes: number };
  powerChanged: { on: boolean };
  billDue: { amount: number; reason: string };

  // ---- VEH ----
  honk: { x: number; z: number };

  // ---- UIX ----
  /** Any module may emit this to show a full-screen "time passes" overlay. */
  activityStarted: { label: string; seconds: number };

  // ---- AUD ----
  radioChanged: { station: string | null };

  // ---- SAV ----
  saved: { slot: string };
  loaded: { slot: string };
}
