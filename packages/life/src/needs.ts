import { Rng, hashCoords } from '@accra/core';

/**
 * Life simulation rules (SRS LIF-001 to LIF-003, LIF-030). Pure functions so they are easy to test and tune.
 * All needs run from 0 (bad) to 100 (good).
 */

export interface LifeState {
  hunger: number;
  thirst: number;
  energy: number;
  hygiene: number;
  mood: number;
  health: number;
}

export function startState(): LifeState {
  return { hunger: 80, thirst: 80, energy: 90, hygiene: 85, mood: 70, health: 100 };
}

export function clamp100(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/** Advance one game minute. */
export function stepMinute(s: LifeState, raining: boolean): void {
  s.hunger -= 0.065;
  s.thirst -= 0.1;
  s.energy -= 0.05;
  s.hygiene -= 0.025;

  const avg = (s.hunger + s.thirst + s.energy + s.hygiene) / 4;
  const target = avg * 0.9 + 8 - (raining ? 5 : 0);
  const delta = target - s.mood;
  s.mood += Math.max(-0.5, Math.min(0.5, delta));

  if (s.hunger < 8 || s.thirst < 8) s.health -= 0.15;
  else if (Math.min(s.hunger, s.thirst, s.energy, s.hygiene) > 35) s.health += 0.05;

  s.hunger = clamp100(s.hunger);
  s.thirst = clamp100(s.thirst);
  s.energy = clamp100(s.energy);
  s.hygiene = clamp100(s.hygiene);
  s.mood = clamp100(s.mood);
  s.health = clamp100(s.health);
}

/** Exhausted, hungry or thirsty people walk slower (LIF-003). */
export function moveFactor(s: LifeState): number {
  return s.energy < 20 || s.hunger < 10 || s.thirst < 10 ? 0.75 : 1;
}

export function faintReason(s: LifeState): string | null {
  if (s.health <= 0) return 'You collapsed from hunger and thirst.';
  if (s.energy <= 0) return 'You collapsed from exhaustion.';
  return null;
}

// ------------------------------------------------------------- power cuts (dumsor)

export interface Outage {
  /** Minute of day the cut starts. */
  start: number;
  /** Minute of day it ends; may be past 1440 when it runs into the next day. */
  end: number;
}

/** Roughly four days in ten have a power cut of one to four hours. The first day is always calm. */
export function outageForDay(day: number, seed: number): Outage | null {
  if (day <= 0) return null;
  const rng = new Rng(hashCoords(seed, day, 911));
  if (!rng.chance(0.4)) return null;
  const start = rng.int(9, 20) * 60 + rng.int(0, 59);
  return { start, end: start + rng.int(1, 4) * 60 };
}

export function isPowerOn(totalMinutes: number, seed: number): boolean {
  const day = Math.floor(totalMinutes / 1440);
  const m = totalMinutes - day * 1440;
  const today = outageForDay(day, seed);
  if (today && m >= today.start && m < today.end) return false;
  const yesterday = day > 0 ? outageForDay(day - 1, seed) : null;
  if (yesterday && yesterday.end > 1440 && m < yesterday.end - 1440) return false;
  return true;
}
