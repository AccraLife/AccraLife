/**
 * Shared gameplay numbers (SRS ECO-004, ECO-020, LIF-030).
 * Kept in Core so every module shows and charges the same prices.
 */
export const PRICES = {
  chopbar: 15,
  water: 2,
  fare: 3,
  shiftPay: 45,
  faintFee: 20,
  rent: 100,
} as const;

export const START_CASH = 60;
export const SHIFT_HOURS = 4;
export const TROTRO_MINUTES = 25;
export const RENT_INTERVAL_DAYS = 7;

/** [open hour, close hour) for each place type. */
export const OPEN_HOURS: Record<string, readonly [number, number]> = {
  chopbar: [6, 22],
  kiosk: [5, 23],
  work: [7, 19],
};

export function isOpen(kind: string, hour: number): boolean {
  const range = OPEN_HOURS[kind];
  if (!range) return true;
  return hour >= range[0] && hour < range[1];
}

export function openLabel(kind: string): string {
  const range = OPEN_HOURS[kind];
  if (!range) return 'always open';
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${pad(range[0])}:00 to ${pad(range[1])}:00`;
}
