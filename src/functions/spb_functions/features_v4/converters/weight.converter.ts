// features_v4/converters/weight.converter.ts - VERSÃO CORRIGIDA

// Conversion constants
const STONE_TO_POUNDS = 14;
const POUND_TO_KG = 0.453592;
const STONE_TO_KG = 6.35029;

/**
 * Parse weight string to kilograms
 * Handles formats:
 * - "10-7" (stones-pounds)
 * - "147" (total pounds)
 * - "66.5" (already in kg)
 * - "10st 7lb" (stones and pounds with labels)
 */
export function parseToKg(weight: string | null): number | null {
  if (!weight) return null;

  const clean = weight.trim().toLowerCase();

  // Check for stones-pounds format (e.g., "10-7", "9-12")
  const stonesPoundsMatch = clean.match(/^(\d+)[-\s]+(\d+)$/);
  if (stonesPoundsMatch) {
    const stones = Number.parseInt(stonesPoundsMatch[1]);
    const pounds = Number.parseInt(stonesPoundsMatch[2]);

    // CORREÇÃO: Se pounds >= 14, então NÃO é formato stones-pounds
    // É provavelmente um peso total em libras mal formatado
    if (pounds >= STONE_TO_POUNDS) {
      // Tratar como peso total em libras
      // Por exemplo, "10-135" seria interpretado como 135 libras, não 10 stones e 135 pounds
      const totalPounds = Number.parseFloat(clean.replace(/[-\s]+/, ""));
      if (!Number.isNaN(totalPounds)) {
        return poundsToKg(totalPounds);
      }
    }

    // É formato stones-pounds válido
    return stonesPoundsToKg(stones, pounds);
  }

  // Tentar extrair apenas números
  const numberMatch = clean.match(/(\d+\.?\d*)/);
  if (numberMatch) {
    const num = Number.parseFloat(numberMatch[1]);

    if (Number.isNaN(num)) return null;

    // Heurística para determinar a unidade:
    // - Se > 80: definitivamente libras (cavalos não pesam 80kg de peso carregado)
    // - Se entre 40-80: provavelmente kg (peso típico carregado)
    // - Se entre 14-40: pode ser stones ou kg, assumir kg
    // - Se < 14: provavelmente stones

    if (num > 80) {
      // Definitivamente libras totais
      return poundsToKg(num);
    } else if (num >= 40 && num <= 80) {
      // Provavelmente já está em kg
      return num;
    } else if (num >= 14 && num < 40) {
      // Ambíguo, mas provavelmente kg para corridas
      return num;
    } else if (num < 14) {
      // Pode ser stones sozinho
      // Mas em corridas, normalmente seria formato completo
      // Assumir que é stones
      return num * STONE_TO_KG;
    }
  }

  return null;
}

/**
 * Convert stones and pounds to kilograms
 */
export function stonesPoundsToKg(stones: number, pounds: number): number {
  // Validar entrada
  if (pounds >= STONE_TO_POUNDS) {
    console.warn(`Pounds value ${pounds} exceeds 14, treating as total pounds`);
    return poundsToKg(pounds);
  }

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
  // Normal range for racehorses with tack: 50kg - 75kg
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
  const distanceFactor = distanceMeters / 1600;
  const impactPerKg = 0.005 * distanceFactor;
  const totalImpact = weightDifferential * impactPerKg;
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
  return Math.max(0, Math.min(1, 1 - stdDev / 5));
}

/**
 * Get weight handicap rating
 */
export function getHandicapFromWeight(
  weight: number,
  baseWeight: number = 60, // Standard base weight in kg
): number {
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

  const goodPerformances = historicalPerformances
    .filter((p) => p.position <= 3)
    .map((p) => p.weight);

  if (goodPerformances.length === 0) return null;

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

// Export grouped as object for backward compatibility
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
