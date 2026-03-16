// features_v4/converters/distance.converter.ts

import type { DistanceBand } from "../types/core.types";

const MILE_TO_METERS = 1609.34;
const FURLONG_TO_METERS = 201.17;
const YARD_TO_METERS = 0.9144;

export function parseDistanceToMeters(distance: string): number {
  if (!distance) return 0;

  const clean = distance.trim().toLowerCase();

  // Formato britânico: "2m1f", "1m2f110y", "7f", "2m"
  // Regra: se tem 'f' depois de um número, o 'm' anterior é milhas
  // Se é apenas "1200m" ou "1200", é metros/yards

  // Detectar se é formato britânico (tem 'f' ou tem 'm' seguido de número/f)
  const isBritishFormat = /\d+f|\d+m\d|\d+m$/.test(clean);

  if (isBritishFormat) {
    let totalMeters = 0;

    // Milhas: "2m", "1m" — 'm' seguido de 'f', dígito, ou fim de string
    const mileMatch = clean.match(/(\d+)\s*m(?=\d|f|$|\s)/);
    if (mileMatch) {
      totalMeters += Number.parseInt(mileMatch[1]) * MILE_TO_METERS;
    }

    // Furlongs: "7f", "1f"
    const furlongMatch = clean.match(/(\d+)\s*f/);
    if (furlongMatch) {
      totalMeters += Number.parseInt(furlongMatch[1]) * FURLONG_TO_METERS;
    }

    // Yards: "110y"
    const yardMatch = clean.match(/(\d+)\s*y/);
    if (yardMatch) {
      totalMeters += Number.parseInt(yardMatch[1]) * YARD_TO_METERS;
    }

    if (totalMeters > 0) return Math.round(totalMeters);
  }

  // Formato métrico explícito: "1200m"
  const explicitMeters = clean.match(/^(\d+)m$/);
  if (explicitMeters) {
    return Number.parseInt(explicitMeters[1]);
  }

  // Número puro sem unidade
  const pureNumber = clean.match(/^(\d+)$/);
  if (pureNumber) {
    const value = Number.parseInt(pureNumber[1]);
    return value > 500 ? value : Math.round(value * YARD_TO_METERS);
  }

  // Fallback: tentar extrair qualquer número
  const anyNumber = clean.match(/(\d+)/);
  if (anyNumber) {
    const value = Number.parseInt(anyNumber[1]);
    return value > 500 ? value : Math.round(value * YARD_TO_METERS);
  }

  return 0;
}

export function metersToFurlongs(meters: number): number {
  return meters / FURLONG_TO_METERS;
}

export function metersToMiles(meters: number): number {
  return meters / MILE_TO_METERS;
}

export function formatDistance(meters: number): string {
  const miles = Math.floor(meters / MILE_TO_METERS);
  const remainingMeters = meters - miles * MILE_TO_METERS;
  const furlongs = Math.floor(remainingMeters / FURLONG_TO_METERS);
  const finalMeters = remainingMeters - furlongs * FURLONG_TO_METERS;
  const yards = Math.round(finalMeters / YARD_TO_METERS);

  const parts: string[] = [];
  if (miles > 0) parts.push(`${miles}m`);
  if (furlongs > 0) parts.push(`${furlongs}f`);
  if (yards > 0 && yards < 220) parts.push(`${yards}y`);

  return parts.join(" ") || "0m";
}

export function getDistanceBand(meters: number): DistanceBand {
  if (meters < 1200) return 1; // SPRINT
  if (meters < 1800) return 2; // MILE
  if (meters < 2400) return 3; // MIDDLE
  return 4; // LONG
}

export function isInSameDistanceBand(
  meters1: number,
  meters2: number,
  tolerance = 0.1,
): boolean {
  const diff = Math.abs(meters1 - meters2);
  const avg = (meters1 + meters2) / 2;
  return avg === 0 ? false : diff / avg <= tolerance;
}

export function isWithinDistanceBand(
  meters1: number,
  meters2: number,
  tolerance = 0.1,
): boolean {
  return isInSameDistanceBand(meters1, meters2, tolerance);
}

export function parseDistanceBeaten(beaten: string | null): number {
  if (!beaten) return 0;

  const clean = beaten.trim().toLowerCase();

  if (clean === "0" || clean.includes("won") || clean === "dht") {
    return 0;
  }

  const distanceMap: Record<string, number> = {
    dht: 0,
    nse: 0.05,
    shd: 0.1,
    sh: 0.1,
    hd: 0.2,
    nk: 0.3,
    snk: 0.25,
    "½": 0.5,
    "¼": 0.25,
    "¾": 0.75,
    dist: 30,
  };

  let totalLengths = 0;

  for (const [key, value] of Object.entries(distanceMap)) {
    if (clean.includes(key)) {
      const match = clean.match(new RegExp(`(\\d+)?\\s*${key}`));
      const multiplier = match?.[1] ? Number.parseInt(match[1]) : 1;
      totalLengths += value * multiplier;
    }
  }

  // Apenas aplica parser numérico se nenhum marcador especial foi encontrado
  if (totalLengths === 0) {
    const fractionMatch = clean.match(/(\d+)\s+(\d+)\/(\d+)/);
    if (fractionMatch) {
      const whole = Number.parseInt(fractionMatch[1]);
      const numerator = Number.parseInt(fractionMatch[2]);
      const denominator = Number.parseInt(fractionMatch[3]);
      totalLengths = whole + numerator / denominator;
    } else {
      const numberMatch = clean.match(/(\d+\.?\d*)/);
      if (numberMatch) {
        totalLengths = Number.parseFloat(numberMatch[1]);
      }
    }
  }

  return Math.min(totalLengths, 99);
}

export function lengthsToMeters(lengths: number): number {
  return lengths * 2.4;
}

export function lengthsToSeconds(
  lengths: number,
  distanceMeters: number,
): number {
  const baseTimePerLength = 0.2;
  const distanceFactor = Math.sqrt(distanceMeters / 1600);
  return lengths * baseTimePerLength * distanceFactor;
}

export function getExpectedTime(meters: number, raceClass: number): number {
  const baseSpeed = 18 - raceClass * 0.5;
  return meters / baseSpeed;
}

export function isOptimalDistance(
  currentDistance: number,
  historicalDistances: number[],
  winDistances: number[],
): boolean {
  if (historicalDistances.length === 0) return false;

  const avgWinDistance =
    winDistances.length > 0
      ? winDistances.reduce((a, b) => a + b, 0) / winDistances.length
      : 0;

  if (avgWinDistance > 0) {
    return isInSameDistanceBand(currentDistance, avgWinDistance, 0.15);
  }

  const avgDistance =
    historicalDistances.reduce((a, b) => a + b, 0) / historicalDistances.length;
  return isInSameDistanceBand(currentDistance, avgDistance, 0.2);
}

export function getDistancePreferenceScore(
  currentDistance: number,
  historicalPerformances: Array<{ distance: number; position: number }>,
): number {
  if (historicalPerformances.length === 0) return 0.5;

  const similarDistances = historicalPerformances.filter((p) =>
    isInSameDistanceBand(currentDistance, p.distance, 0.15),
  );

  if (similarDistances.length === 0) return 0.3;

  const avgPosition =
    similarDistances.reduce((sum, p) => sum + p.position, 0) /
    similarDistances.length;

  return Math.max(0, Math.min(1, 1 - (avgPosition - 1) / 9));
}

export function getDistanceChange(
  currentMeters: number,
  lastMeters: number | null,
): string {
  if (!lastMeters) return "unknown";

  const percentChange = ((currentMeters - lastMeters) / lastMeters) * 100;

  if (Math.abs(percentChange) < 5) return "similar";
  if (percentChange > 20) return "much_longer";
  if (percentChange > 5) return "longer";
  if (percentChange < -20) return "much_shorter";
  if (percentChange < -5) return "shorter";

  return "similar";
}

export const DistanceConverter = {
  parseToMeters: parseDistanceToMeters,
  metersToFurlongs,
  metersToMiles,
  formatDistance,
  getDistanceBand,
  isInSameDistanceBand,
  isWithinDistanceBand,
  parseDistanceBeaten,
  lengthsToMeters,
  lengthsToSeconds,
};

export const DistanceUtils = {
  getExpectedTime,
  isOptimalDistance,
  getDistancePreferenceScore,
  getDistanceChange,
  isWithinDistanceBand,
};
