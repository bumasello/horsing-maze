// features_v4/converters/odds.converter.ts

/**
 * Convert fractional odds to decimal odds
 * Examples: "11/2" -> 6.5, "EVS" -> 2.0, "2/1" -> 3.0
 */
export function fractionalToDecimal(fractional: string | null): number | null {
  if (!fractional) return null;

  const clean = fractional.trim().toUpperCase();

  // Handle special cases
  if (clean === "EVS" || clean === "EVENS" || clean === "EVEN") {
    return 2.0;
  }

  if (clean === "FAV" || clean === "FAVOURITE") {
    return 1.5; // Assume strong favorite
  }

  // Handle "X/Y ON" format (e.g., "2/1 ON" means 1/2)
  const onMatch = clean.match(/(\d+)\/(\d+)\s+ON/);
  if (onMatch) {
    const numerator = Number.parseInt(onMatch[2]);
    const denominator = Number.parseInt(onMatch[1]);
    return 1 + numerator / denominator;
  }

  // Handle standard fractional format "X/Y"
  const fracMatch = clean.match(/(\d+)\/(\d+)/);
  if (fracMatch) {
    const numerator = Number.parseInt(fracMatch[1]);
    const denominator = Number.parseInt(fracMatch[2]);
    return 1 + numerator / denominator;
  }

  // Handle decimal format already
  const decimal = Number.parseFloat(clean);
  if (!Number.isNaN(decimal) && decimal > 0) {
    // If less than 1, it might be probability - convert
    if (decimal < 1) {
      return 1 / decimal;
    }
    return decimal;
  }

  return null;
}

/**
 * Convert decimal odds to fractional string
 */
export function decimalToFractional(decimal: number): string {
  if (decimal === 2.0) return "EVS";

  const profit = decimal - 1;

  // Common fractions
  const commonFractions: Array<[number, string]> = [
    [1.5, "1/2"],
    [1.33, "1/3"],
    [1.25, "1/4"],
    [1.2, "1/5"],
    [2.5, "6/4"],
    [3.0, "2/1"],
    [3.5, "5/2"],
    [4.0, "3/1"],
    [4.5, "7/2"],
    [5.0, "4/1"],
    [6.0, "5/1"],
    [7.0, "6/1"],
    [8.0, "7/1"],
    [9.0, "8/1"],
    [10.0, "9/1"],
    [11.0, "10/1"],
  ];

  // Find closest common fraction
  for (const [value, fraction] of commonFractions) {
    if (Math.abs(decimal - value) < 0.05) {
      return fraction;
    }
  }

  // Calculate fraction
  const tolerance = 0.001;
  let numerator = 1;
  let denominator = 1;
  let maxIterations = 100;

  while (maxIterations-- > 0) {
    const fraction = numerator / denominator;
    if (Math.abs(fraction - profit) < tolerance) {
      return `${numerator}/${denominator}`;
    }
    if (fraction < profit) {
      numerator++;
    } else {
      denominator++;
      numerator = Math.round(profit * denominator);
    }
  }

  return `${Math.round(profit * 100) / 100}/1`;
}

/**
 * Convert decimal odds to implied probability
 */
export function decimalToImpliedProbability(
  decimal: number | null,
): number | null {
  if (!decimal || decimal <= 1) return null;
  return 1 / decimal;
}

/**
 * Convert implied probability to decimal odds
 */
export function probabilityToDecimal(probability: number): number {
  if (probability <= 0 || probability >= 1) {
    throw new Error("Probability must be between 0 and 1");
  }
  return 1 / probability;
}

/**
 * Calculate overround/margin from array of decimal odds
 */
export function calculateOverround(decimalOdds: number[]): number {
  const totalProb = decimalOdds.reduce((sum, odds) => {
    return sum + 1 / odds;
  }, 0);
  return totalProb - 1;
}

/**
 * Remove overround to get true probabilities
 */
export function removeMargin(decimalOdds: number[]): number[] {
  const overround = calculateOverround(decimalOdds);
  const factor = 1 + overround;

  return decimalOdds.map((odds) => {
    const impliedProb = 1 / odds;
    const trueProb = impliedProb / factor;
    return 1 / trueProb;
  });
}

/**
 * Parse Betfair-style odds (back/lay)
 */
export function parseBetfairOdds(oddsString: string): {
  back: number | null;
  lay: number | null;
} {
  const parts = oddsString.split("/");

  if (parts.length === 2) {
    const back = Number.parseFloat(parts[0]);
    const lay = Number.parseFloat(parts[1]);

    return {
      back: !Number.isNaN(back) ? back : null,
      lay: !Number.isNaN(lay) ? lay : null,
    };
  }

  // Try single value
  const single = Number.parseFloat(oddsString);
  if (!Number.isNaN(single)) {
    return { back: single, lay: null };
  }

  return { back: null, lay: null };
}

/**
 * Calculate value rating (expected value)
 */
export function calculateValue(
  odds: number,
  estimatedProbability: number,
): number {
  return odds * estimatedProbability - 1;
}

/**
 * Check if odds represent a favorite
 */
export function isFavorite(decimal: number, fieldOdds: number[]): boolean {
  if (fieldOdds.length === 0) return false;
  const minOdds = Math.min(...fieldOdds);
  return decimal === minOdds;
}

/**
 * Get market rank from odds
 */
export function getMarketRank(decimal: number, fieldOdds: number[]): number {
  const sorted = [...fieldOdds].sort((a, b) => a - b);
  return sorted.indexOf(decimal) + 1;
}

/**
 * Calculate Kelly Criterion stake
 */
export function kellyStake(
  odds: number,
  probability: number,
  bankrollFraction: number = 0.25,
): number {
  const b = odds - 1;
  const q = 1 - probability;
  const kelly = (b * probability - q) / b;

  // Apply fractional Kelly for safety
  return Math.max(0, Math.min(kelly * bankrollFraction, 0.1));
}

/**
 * Format odds for display
 */
export function formatOdds(
  decimal: number,
  format: "decimal" | "fractional" | "american" = "fractional",
): string {
  switch (format) {
    case "fractional":
      return decimalToFractional(decimal);

    case "american":
      if (decimal >= 2) {
        return `+${Math.round((decimal - 1) * 100)}`;
      } else {
        return `-${Math.round(100 / (decimal - 1))}`;
      }

    case "decimal":
    default:
      return decimal.toFixed(2);
  }
}

/**
 * Parse various SP formats to decimal
 */
export function parseSP(sp: string | null): number | null {
  if (!sp) return null;

  const clean = sp.trim().toUpperCase();

  // Remove any currency symbols or extra text
  const stripped = clean.replace(/[£$€]/, "").replace(/\s+/g, " ");

  // Check for "NR" (Non-runner)
  if (stripped === "NR" || stripped === "N/R" || stripped === "WD") {
    return null;
  }

  // Check for joint/co-favorite indicators
  if (stripped.includes("JF") || stripped.includes("CF")) {
    // Extract the odds part
    const oddsMatch = stripped.match(/(\d+\/\d+|\d+\.?\d*)/);
    if (oddsMatch) {
      return fractionalToDecimal(oddsMatch[1]);
    }
    return 2.5; // Default for joint favorite
  }

  // Try fractional first
  const fractionalResult = fractionalToDecimal(stripped);
  if (fractionalResult !== null) {
    return fractionalResult;
  }

  // Try decimal
  const decimal = Number.parseFloat(stripped);
  if (!Number.isNaN(decimal) && decimal > 0) {
    return decimal;
  }

  return null;
}

/**
 * Categorize odds into bands
 */
export function getOddsBand(decimal: number): string {
  if (decimal < 2) return "strong_favorite";
  if (decimal < 4) return "favorite";
  if (decimal < 7) return "contender";
  if (decimal < 15) return "outsider";
  if (decimal < 30) return "long_shot";
  return "no_hope";
}

/**
 * Calculate confidence level from odds movement
 */
export function calculateOddsMovementConfidence(
  openingOdds: number,
  currentOdds: number,
): number {
  const change = (currentOdds - openingOdds) / openingOdds;

  // Shortening (odds decreased) = positive confidence
  // Drifting (odds increased) = negative confidence

  if (change < -0.3) return 1.0; // Strong shortening
  if (change < -0.15) return 0.8; // Moderate shortening
  if (change < -0.05) return 0.6; // Slight shortening
  if (change < 0.05) return 0.5; // Stable
  if (change < 0.15) return 0.4; // Slight drift
  if (change < 0.3) return 0.2; // Moderate drift
  return 0.0; // Strong drift
}

// Export grouped as class for backward compatibility (if needed)
export const OddsConverter = {
  fractionalToDecimal,
  decimalToFractional,
  decimalToImpliedProbability,
  probabilityToDecimal,
  calculateOverround,
  removeMargin,
  parseBetfairOdds,
  calculateValue,
  isFavorite,
  getMarketRank,
  kellyStake,
  formatOdds,
  parseSP,
  getOddsBand,
  calculateOddsMovementConfidence,
};
