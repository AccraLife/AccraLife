/** Shared time types. The ENV module owns the clock; everyone else reads it. */

export interface GameTime {
  /** Whole days since the start of the game (0-based). */
  day: number;
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  hour: number;
  minute: number;
  /** Total game minutes since the start of the game. */
  totalMinutes: number;
  /** Calendar date as YYYY-MM-DD. */
  date: string;
}

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatClock(time: Pick<GameTime, 'hour' | 'minute'>): string {
  return `${pad2(time.hour)}:${pad2(time.minute)}`;
}

export type Weather =
  | 'clear'
  | 'hazy'
  | 'cloudy'
  | 'lightRain'
  | 'heavyRain'
  | 'thunderstorm'
  | 'harmattan';

export const WEATHER_LABELS: Record<Weather, string> = {
  clear: 'Clear',
  hazy: 'Hazy',
  cloudy: 'Cloudy',
  lightRain: 'Light rain',
  heavyRain: 'Heavy rain',
  thunderstorm: 'Thunderstorm',
  harmattan: 'Harmattan haze',
};
