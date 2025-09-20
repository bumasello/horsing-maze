// features_v4/converters/distance.converter.ts

import type { DistanceBand } from "../types/core.types";

// Conversion constants
const MILE_TO_METERS = 1609.34;
const FURLONG_TO_METERS = 201.17;
const YARD_TO_METERS = 0.9144;

/**
 * Parse distance string to meters
 * Handles formats like: "1m 2f", "7f", "2m", "1m 2f 110y", "1200", "1200m"
 */
export function parseDistanceToMeters(distance: string): number {
  if (!distance) return 0;

  const clean = distance.trim().toLowerCase();

  // Check if already in meters (e.g., "1200m" or just "1200")
  const metersMatch = clean.match(/^(\d+)m?$/);
  if (metersMatch) {
    const value = Number.parseInt(metersMatch[1]);
    // If value is > 100, assume it's already in meters/yards
    if (value > 100) {
      // Values > 1000 are likely meters, < 1000 likely yards
      return value > 1000 ? value : Math.round(value * YARD_TO_METERS);
    }
  }

  let totalMeters = 0;

  // Parse miles (e.g., "2m" or "2 miles")
  const mileMatch = clean.match(/(\d+)\s*m(?:ile)?(?:s)?(?:\s|$)/);
  if (mileMatch) {
    totalMeters += Number.parseInt(mileMatch[1]) * MILE_TO_METERS;
  }

  // Parse furlongs (e.g., "7f" or "7 furlongs")
  const furlongMatch = clean.match(/(\d+)\s*f(?:urlong)?(?:s)?/);
  if (furlongMatch) {
    totalMeters += Number.parseInt(furlongMatch[1]) * FURLONG_TO_METERS;
  }

  // Parse yards (e.g., "110y" or "110 yards")
  const yardMatch = clean.match(/(\d+)\s*y(?:ard)?(?:s)?/);
  if (yardMatch) {
    totalMeters += Number.parseInt(yardMatch[1]) * YARD_TO_METERS;
  }

  // If nothing matched, try to extract any number and treat as yards
  if (totalMeters === 0) {
    const anyNumber = clean.match(/(\d+)/);
    if (anyNumber) {
      const value = Number.parseInt(anyNumber[1]);
      // Assume yards for small values, meters for large values
      totalMeters = value > 500 ? value : value * YARD_TO_METERS;
    }
  }

  return Math.round(totalMeters);
}

/**
 * Convert meters to furlongs
 */
export function metersToFurlongs(meters: number): number {
  return meters / FURLONG_TO_METERS;
}

/**
 * Convert meters to miles
 */
export function metersToMiles(meters: number): number {
  return meters / MILE_TO_METERS;
}

/**
 * Format meters as racing distance string
 */
export function formatDistance(meters: number): string {
  const miles = Math.floor(meters / MILE_TO_METERS);
  const remainingMeters = meters - miles * MILE_TO_METERS;
  const furlongs = Math.floor(remainingMeters / FURLONG_TO_METERS);
  const finalMeters = remainingMeters - furlongs * FURLONG_TO_METERS;
  const yards = Math.round(finalMeters / YARD_TO_METERS);

  const parts: string[] = [];
  if (miles > 0) parts.push(`${miles}m`);
  if (furlongs > 0) parts.push(`${furlongs}f`);
  if (yards > 0 && yards < 220) parts.push(`${yards}y`); // Only show yards if < 220

  return parts.join(" ") || "0m";
}

/**
 * Get distance band category
 */
export function getDistanceBand(meters: number): DistanceBand {
  if (meters < 1200) return 1; // SPRINT
  if (meters < 1800) return 2; // MILE
  if (meters < 2400) return 3; // MIDDLE
  return 4; // LONG
}

/**
 * Check if two distances are in the same band (±10% tolerance)
 */
export function isInSameDistanceBand(
  meters1: number,
  meters2: number,
  tolerance = 0.1,
): boolean {
  const diff = Math.abs(meters1 - meters2);
  const avg = (meters1 + meters2) / 2;
  return avg === 0 ? false : diff / avg <= tolerance;
}

/**
 * Check if a distance is within a specific band with tolerance
 * Alias for isInSameDistanceBand for backward compatibility
 */
export function isWithinDistanceBand(
  meters1: number,
  meters2: number,
  tolerance = 0.1,
): boolean {
  return isInSameDistanceBand(meters1, meters2, tolerance);
}

/**
 * Parse distance beaten to lengths
 * Handles: numbers, "nk" (neck), "hd" (head), "sh" (short head), "nse" (nose), "dht" (dead heat)
 */
export function parseDistanceBeaten(beaten: string | null): number {
  if (!beaten) return 0;

  const clean = beaten.trim().toLowerCase();

  // Special cases
  if (clean === "0" || clean.includes("won") || clean === "dht") {
    return 0;
  }

  let totalLengths = 0;

  // Distance abbreviations to lengths
  const distanceMap: Record<string, number> = {
    dht: 0, // Dead heat
    nse: 0.05, // Nose
    shd: 0.1, // Short head
    sh: 0.1, // Short head
    hd: 0.2, // Head
    nk: 0.3, // Neck
    snk: 0.25, // Short neck
    "½": 0.5, // Half length
    "¼": 0.25, // Quarter length
    "¾": 0.75, // Three quarters
    dist: 30, // Distance (far behind)
  };

  // Check for special distance markers
  for (const [key, value] of Object.entries(distanceMap)) {
    if (clean.includes(key)) {
      // Check if there's a multiplier (e.g., "2nk" = 2 necks)
      const match = clean.match(new RegExp(`(\\d+)?\\s*${key}`));
      const multiplier = match?.[1] ? Number.parseInt(match[1]) : 1;
      totalLengths += value * multiplier;
    }
  }

  // Parse regular lengths (e.g., "2.5", "1 1/2", "10")
  // First try to find fractions
  const fractionMatch = clean.match(/(\d+)\s+(\d+)\/(\d+)/);
  if (fractionMatch) {
    const whole = Number.parseInt(fractionMatch[1]);
    const numerator = Number.parseInt(fractionMatch[2]);
    const denominator = Number.parseInt(fractionMatch[3]);
    totalLengths += whole + numerator / denominator;
  } else {
    // Try regular decimal number
    const numberMatch = clean.match(/(\d+\.?\d*)/);
    if (numberMatch && totalLengths === 0) {
      // Only use if no special markers found
      totalLengths += Number.parseFloat(numberMatch[1]);
    }
  }

  // Cap at reasonable maximum (99 lengths)
  return Math.min(totalLengths, 99);
}

/**
 * Convert lengths to approximate meters (1 length ≈ 2.4 meters)
 */
export function lengthsToMeters(lengths: number): number {
  return lengths * 2.4;
}

/**
 * Calculate time equivalent from beaten distance
 * Rough approximation: 1 length ≈ 0.2 seconds at standard pace
 */
export function lengthsToSeconds(
  lengths: number,
  distanceMeters: number,
): number {
  // Adjust time per length based on distance (longer races = more time per length)
  const baseTimePerLength = 0.2;
  const distanceFactor = Math.sqrt(distanceMeters / 1600); // Normalize to mile
  return lengths * baseTimePerLength * distanceFactor;
}

// ===== Distance Utils Functions =====

/**
 * Calculate expected time for a distance based on class
 */
export function getExpectedTime(meters: number, raceClass: number): number {
  // Base speed in meters per second (class 1 = fastest)
  const baseSpeed = 18 - raceClass * 0.5; // m/s
  return meters / baseSpeed;
}

/**
 * Check if distance is suitable for horse based on history
 */
export function isOptimalDistance(
  currentDistance: number,
  historicalDistances: number[],
  winDistances: number[],
): boolean {
  if (historicalDistances.length === 0) return false;

  // Calculate average winning distance
  const avgWinDistance =
    winDistances.length > 0
      ? winDistances.reduce((a, b) => a + b, 0) / winDistances.length
      : 0;

  if (avgWinDistance > 0) {
    // Check if current distance is within 15% of average winning distance
    return isInSameDistanceBand(currentDistance, avgWinDistance, 0.15);
  }

  // Fallback to checking against all historical distances
  const avgDistance =
    historicalDistances.reduce((a, b) => a + b, 0) / historicalDistances.length;
  return isInSameDistanceBand(currentDistance, avgDistance, 0.2);
}

/**
 * Calculate distance preference score (0-1)
 */
export function getDistancePreferenceScore(
  currentDistance: number,
  historicalPerformances: Array<{ distance: number; position: number }>,
): number {
  if (historicalPerformances.length === 0) return 0.5;

  // Group performances by distance band
  const similarDistances = historicalPerformances.filter((p) =>
    isInSameDistanceBand(currentDistance, p.distance, 0.15),
  );

  if (similarDistances.length === 0) return 0.3; // Unproven at distance

  // Calculate average position at similar distances
  const avgPosition =
    similarDistances.reduce((sum, p) => sum + p.position, 0) /
    similarDistances.length;

  // Convert to 0-1 score (1st place = 1.0, 10th+ = 0)
  return Math.max(0, Math.min(1, 1 - (avgPosition - 1) / 9));
}

/**
 * Categorize distance change from last race
 */
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

// Export grouped for backward compatibility
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
  isWithinDistanceBand, // Add this for compatibility
};
