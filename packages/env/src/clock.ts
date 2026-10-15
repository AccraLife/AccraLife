import { type GameTime, Rng } from '@accra/core';

/** The game starts on Tuesday 13 October 2026 at 07:00. */
export const START_UTC_MS = Date.UTC(2026, 9, 13);
export const START_MINUTE_OF_DAY = 7 * 60;

export function timeFromMinutes(totalMinutes: number): GameTime {
  const total = Math.max(0, Math.floor(totalMinutes));
  const day = Math.floor(total / 1440);
  const minuteOfDay = total - day * 1440;
  const date = new Date(START_UTC_MS + day * 86_400_000);
  return {
    day,
    weekday: date.getUTCDay(),
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    totalMinutes: total,
    date: date.toISOString().slice(0, 10),
  };
}

export function monthOf(time: Pick<GameTime, 'date'>): number {
  return Number(time.date.slice(5, 7));
}

/** Public holidays by month-day (SRS ENV-004). */
export const HOLIDAYS: Record<string, string> = {
  '01-01': "New Year's Day",
  '03-06': 'Independence Day',
  '05-01': 'May Day',
  '07-01': 'Republic Day',
  '12-25': 'Christmas Day',
  '12-26': 'Boxing Day',
};

export function holidayOn(date: string): string | null {
  return HOLIDAYS[date.slice(5)] ?? null;
}

// ------------------------------------------------------------- sun

export function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Sun height from -1 to 1. Accra is near the equator, so days are about 12 hours all year:
 * sunrise 06:00, sunset 18:00.
 */
export function sunHeight(hourFloat: number): number {
  return Math.sin(((hourFloat - 6) / 12) * Math.PI);
}

/** 0 in daylight, 1 in deep night. */
export function nightFactor(hourFloat: number): number {
  return 1 - smoothstep(-0.1, 0.2, sunHeight(hourFloat));
}

/** Seeded random generator for weather, tied to the world seed. */
export function weatherRng(seed: number): Rng {
  return new Rng(seed ^ 0x3a7e);
}
