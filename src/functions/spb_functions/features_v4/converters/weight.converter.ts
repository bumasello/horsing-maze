// features_v4/converters/weight.converter.ts

// Conversion constants
const STONE_TO_POUNDS = 14;
const POUND_TO_KG = 0.453592;

/**
 * Parse weight string to kilograms
 * Handles formats: "10-7" (stones-pounds), "147" (pounds), "66.5" (kg)
 */
export function parseToKg(weight: string | null): number | null {
  if (!weight) return null;

  const clean = weight.trim().toLowerCase();

  // Check for stones-pounds format (e.g., "10-7", "9-12")
  const stonesPoundsMatch = clean.match(/(\d+)[-\s]+(\d+)/);
  if (stonesPoundsMatch) {
    const stones = Number.parseInt(stonesPoundsMatch[1]);
    const pounds = Number.parseInt(stonesPoundsMatch[2]);

    // Validate pounds (should be less than 14)
    if (pounds >= STONE_TO_POUNDS) {
      console.warn(`Invalid pounds value: ${pounds}. Should be less than 14.`);
    }

    return stonesPoundsToKg(stones, pounds);
  }

  // Check for just pounds with "lb" or "lbs"
  const poundsMatch = clean.match(/(\d+\.?\d*)\s*(?:lb|lbs)?/);
  if (poundsMatch) {
    const pounds = Number.parseFloat(poundsMatch[1]);

    // If value is > 100, assume it's pounds
    if (pounds > 100) {
      return poundsToKg(pounds);
    }

    // If value is < 100, it might be kg already
    if (pounds < 100) {
      return pounds; // Assume kg
    }
  }

  // Try to parse as a simple number
  const num = Number.parseFloat(clean);
  if (!Number.isNaN(num)) {
    // Make intelligent guess based on value
    if (num > 100) {
      // Likely pounds
      return poundsToKg(num);
    } else {
      // Likely kg
      return num;
    }
  }

  return null;
}

/**
 * Convert stones and pounds to kilograms
 */
export function stonesPoundsToKg(stones: number, pounds: number): number {
  const totalPounds = stones * STONE_TO_POUNDS + pounds;

  return Number.parseFloat((totalPounds * POUND_TO_KG).toFixed(2));
}

/**
 * Convert pounds to kilograms
 */
export function poundsToKg(pounds: number): number {
  return Number.parseFloat((pounds * POUND_TO_KG).toFixed(2));
}

/**
 * Convert kilograms to stones and pounds
 */
export function kgToStonesPounds(kg: number): {
  stones: number;
  pounds: number;
} {
  const totalPounds = kg / POUND_TO_KG;
  const stones = Math.floor(totalPounds / STONE_TO_POUNDS);
  const pounds = Math.round(totalPounds % STONE_TO_POUNDS);

  return { stones, pounds };
}

/**
 * Format weight for display
 */
export function formatWeight(
  kg: number,
  format: "kg" | "stones" | "pounds" = "stones",
): string {
  switch (format) {
    case "stones": {
      const { stones, pounds } = kgToStonesPounds(kg);
      return `${stones}-${pounds}`;
    }

    case "pounds": {
      const pounds = kg / POUND_TO_KG;
      return `${Math.round(pounds)}lb`;
    }

    case "kg":
    default:
      return `${kg.toFixed(1)}kg`;
  }
}

/**
 * Calculate weight allowance/penalty
 */
export function calculateWeightDifferential(
  actualWeight: number,
  standardWeight: number,
): number {
  return actualWeight - standardWeight;
}

/**
 * Check if weight is within normal range for horse racing
 */
export function isValidWeight(kg: number): boolean {
  // Normal range for racehorses: 50kg - 75kg (roughly 8-12 stones)
  return kg >= 50 && kg <= 75;
}

/**
 * Calculate weight-for-age allowance
 */
export function getWeightForAgeAllowance(
  age: number,
  month: number,
  sex: "colt" | "filly" | "horse" | "mare",
  distanceMeters: number,
): number {
  // Simplified WFA calculation
  // In reality, this varies by jurisdiction and specific race conditions

  if (age >= 4) return 0; // Mature horses carry full weight

  let allowance = 0;

  // 3-year-olds get allowance based on time of year and distance
  if (age === 3) {
    // Early season (Jan-May)
    if (month <= 5) {
      allowance = distanceMeters < 1600 ? 3 : 5; // kg
    }
    // Mid season (Jun-Aug)
    else if (month <= 8) {
      allowance = distanceMeters < 1600 ? 2 : 3;
    }
    // Late season (Sep-Dec)
    else {
      allowance = distanceMeters < 1600 ? 1 : 2;
    }
  }

  // 2-year-olds get more allowance
  if (age === 2) {
    allowance = distanceMeters < 1400 ? 7 : 9;
  }

  // Fillies and mares get additional allowance
  if (sex === "filly" || sex === "mare") {
    allowance += 1.5; // kg
  }

  return allowance;
}

/**
 * Calculate effective weight (including jockey, saddle, etc.)
 */
export function calculateEffectiveWeight(
  horseWeight: number,
  jockeyWeight: number = 55, // Average jockey weight in kg
  equipmentWeight: number = 2, // Saddle and equipment
): number {
  return horseWeight + jockeyWeight + equipmentWeight;
}

/**
 * Estimate impact of weight on performance
 * Returns a multiplier (1.0 = no impact, <1.0 = negative impact)
 */
export function getWeightImpact(
  weightDifferential: number,
  distanceMeters: number,
): number {
  // Rule of thumb: 1kg = 1 length over a mile
  // Adjust for distance
  const distanceFactor = distanceMeters / 1600; // Normalize to mile

  // Each kg of extra weight costs approximately 0.5% in performance
  const impactPerKg = 0.005 * distanceFactor;

  // Calculate total impact
  const totalImpact = weightDifferential * impactPerKg;

  // Return as multiplier (capped between 0.8 and 1.2)
  return Math.max(0.8, Math.min(1.2, 1 - totalImpact));
}

/**
 * Parse weight change from last race
 */
export function parseWeightChange(
  currentWeight: number | null,
  previousWeight: number | null,
): {
  change: number | null;
  category: "up" | "down" | "same" | "unknown";
} {
  if (!currentWeight || !previousWeight) {
    return { change: null, category: "unknown" };
  }

  const change = currentWeight - previousWeight;

  let category: "up" | "down" | "same" | "unknown";
  if (Math.abs(change) < 0.5) {
    category = "same";
  } else if (change > 0) {
    category = "up";
  } else {
    category = "down";
  }

  return { change, category };
}

/**
 * Calculate weight consistency across recent races
 */
export function calculateWeightConsistency(weights: number[]): number {
  if (weights.length < 2) return 1.0;

  const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
  const variance =
    weights.reduce((acc, w) => acc + Math.pow(w - mean, 2), 0) / weights.length;
  const stdDev = Math.sqrt(variance);

  // Convert to 0-1 score (lower std dev = higher consistency)
  // Assume 5kg std dev is very inconsistent
  return Math.max(0, Math.min(1, 1 - stdDev / 5));
}

/**
 * Get weight handicap rating
 */
export function getHandicapFromWeight(
  weight: number,
  baseWeight: number = 60, // Standard base weight in kg
): number {
  // Simplified: each kg above base = 2 handicap points
  const differential = weight - baseWeight;
  return Math.round(differential * 2);
}

/**
 * Check if carrying top weight in field
 */
export function isTopWeight(weight: number, fieldWeights: number[]): boolean {
  if (fieldWeights.length === 0) return false;
  return weight === Math.max(...fieldWeights);
}

/**
 * Check if carrying bottom weight in field
 */
export function isBottomWeight(
  weight: number,
  fieldWeights: number[],
): boolean {
  if (fieldWeights.length === 0) return false;
  return weight === Math.min(...fieldWeights);
}

/**
 * Calculate weight rank in field
 */
export function getWeightRank(weight: number, fieldWeights: number[]): number {
  const sorted = [...fieldWeights].sort((a, b) => b - a); // Heavy to light
  return sorted.indexOf(weight) + 1;
}

/**
 * Estimate optimal weight for horse based on history
 */
export function estimateOptimalWeight(
  historicalPerformances: Array<{
    weight: number;
    position: number;
    fieldSize: number;
  }>,
): number | null {
  if (historicalPerformances.length < 3) return null;

  // Find weights where horse performed best (top 3 finishes)
  const goodPerformances = historicalPerformances
    .filter((p) => p.position <= 3)
    .map((p) => p.weight);

  if (goodPerformances.length === 0) return null;

  // Return average of successful weights
  return goodPerformances.reduce((a, b) => a + b, 0) / goodPerformances.length;
}

/**
 * Parse overweight indicator (e.g., "ow 2" = 2 pounds overweight)
 */
export function parseOverweight(text: string): number {
  const match = text.toLowerCase().match(/ow\s*(\d+)/);
  if (match) {
    const pounds = Number.parseInt(match[1]);
    return poundsToKg(pounds);
  }
  return 0;
}

// Export grouped as object for backward compatibility (if needed)
export const WeightConverter = {
  parseToKg,
  stonesPoundsToKg,
  poundsToKg,
  kgToStonesPounds,
  formatWeight,
  calculateWeightDifferential,
  isValidWeight,
  getWeightForAgeAllowance,
  calculateEffectiveWeight,
  getWeightImpact,
  parseWeightChange,
  calculateWeightConsistency,
  getHandicapFromWeight,
  isTopWeight,
  isBottomWeight,
  getWeightRank,
  estimateOptimalWeight,
  parseOverweight,
};
