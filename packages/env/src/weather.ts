import { type Rng, type Weather } from '@accra/core';

/**
 * Accra weather by season (SRS ENV-010 to ENV-012): a long rainy season (April to July),
 * a short one (September to November), and a dry harmattan season (December to February).
 */
export type Season = 'harmattan' | 'dry' | 'rainy' | 'minor';

export function seasonFor(month: number): Season {
  if (month === 12 || month <= 2) return 'harmattan';
  if (month === 3 || month === 8) return 'dry';
  if (month >= 4 && month <= 7) return 'rainy';
  return 'minor';
}

const TABLE: Record<Season, Array<[Weather, number]>> = {
  harmattan: [
    ['harmattan', 0.5],
    ['hazy', 0.25],
    ['clear', 0.2],
    ['cloudy', 0.05],
  ],
  dry: [
    ['clear', 0.5],
    ['hazy', 0.25],
    ['cloudy', 0.2],
    ['lightRain', 0.05],
  ],
  rainy: [
    ['clear', 0.2],
    ['cloudy', 0.3],
    ['lightRain', 0.22],
    ['heavyRain', 0.17],
    ['thunderstorm', 0.11],
  ],
  minor: [
    ['clear', 0.35],
    ['cloudy', 0.28],
    ['lightRain', 0.2],
    ['heavyRain', 0.1],
    ['thunderstorm', 0.07],
  ],
};

export function pickWeather(season: Season, rng: Rng): Weather {
  const entries = TABLE[season];
  return rng.pickWeighted(
    entries.map((e) => e[0]),
    entries.map((e) => e[1]),
  );
}

/** How weather looks: gray (cloud cover), rain strength, haze, and the share of view distance kept. */
export interface WeatherLook {
  cloud: number;
  rain: number;
  haze: number;
  visibility: number;
}

export const LOOKS: Record<Weather, WeatherLook> = {
  clear: { cloud: 0, rain: 0, haze: 0, visibility: 1 },
  hazy: { cloud: 0.2, rain: 0, haze: 0.5, visibility: 0.7 },
  cloudy: { cloud: 0.55, rain: 0, haze: 0, visibility: 0.95 },
  lightRain: { cloud: 0.7, rain: 0.45, haze: 0, visibility: 0.75 },
  heavyRain: { cloud: 0.88, rain: 0.9, haze: 0, visibility: 0.5 },
  thunderstorm: { cloud: 1, rain: 1, haze: 0, visibility: 0.45 },
  harmattan: { cloud: 0.25, rain: 0, haze: 1, visibility: 0.55 },
};

/** Traffic and crowds slow down in bad weather. */
export function trafficFactor(weather: Weather): number {
  return weather === 'heavyRain' || weather === 'thunderstorm' ? 0.6 : weather === 'lightRain' ? 0.85 : 1;
}
