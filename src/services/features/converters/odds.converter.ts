// features_v4/converters/odds.converter.ts

export function fractionalToDecimal(fractional: string | null): number | null {
  if (!fractional) return null;

  const clean = fractional.trim().toUpperCase();

  if (clean === "EVS" || clean === "EVENS" || clean === "EVEN") return 2.0;

  // FIX 2: FAV sem odds concretas → null em vez de 1.5 arbitrário
  if (clean === "FAV" || clean === "FAVOURITE") return null;

  const onMatch = clean.match(/(\d+)\/(\d+)\s+ON/);
  if (onMatch) {
    const numerator = Number.parseInt(onMatch[2]);
    const denominator = Number.parseInt(onMatch[1]);
    return 1 + numerator / denominator;
  }

  const fracMatch = clean.match(/(\d+)\/(\d+)/);
  if (fracMatch) {
    const numerator = Number.parseInt(fracMatch[1]);
    const denominator = Number.parseInt(fracMatch[2]);
    return 1 + numerator / denominator;
  }

  const decimal = Number.parseFloat(clean);
  if (!Number.isNaN(decimal) && decimal > 0) {
    return decimal < 1 ? 1 / decimal : decimal;
  }

  return null;
}

export function decimalToFractional(decimal: number): string {
  if (decimal === 2.0) return "EVS";

  const profit = decimal - 1;

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

  for (const [value, fraction] of commonFractions) {
    if (Math.abs(decimal - value) < 0.05) return fraction;
  }

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

export function decimalToImpliedProbability(
  decimal: number | null,
): number | null {
  if (!decimal || decimal <= 1) return null;
  return 1 / decimal;
}

export function probabilityToDecimal(probability: number): number {
  if (probability <= 0 || probability >= 1) {
    throw new Error("Probability must be between 0 and 1");
  }
  return 1 / probability;
}

export function calculateOverround(decimalOdds: number[]): number {
  const totalProb = decimalOdds.reduce((sum, odds) => sum + 1 / odds, 0);
  return totalProb - 1;
}

// FIX 1: normalização correta via soma das probabilidades implícitas
export function removeMargin(decimalOdds: number[]): number[] {
  const impliedProbs = decimalOdds.map((o) => 1 / o);
  const total = impliedProbs.reduce((sum, p) => sum + p, 0);
  const trueProbs = impliedProbs.map((p) => p / total);
  return trueProbs.map((p) => 1 / p);
}

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

  const single = Number.parseFloat(oddsString);
  if (!Number.isNaN(single)) return { back: single, lay: null };

  return { back: null, lay: null };
}

export function calculateValue(
  odds: number,
  estimatedProbability: number,
): number {
  return odds * estimatedProbability - 1;
}

export function isFavorite(decimal: number, fieldOdds: number[]): boolean {
  if (fieldOdds.length === 0) return false;
  return decimal === Math.min(...fieldOdds);
}

// FIX 3: comparação de float robusta
export function getMarketRank(decimal: number, fieldOdds: number[]): number {
  const sorted = [...fieldOdds].sort((a, b) => a - b);
  return sorted.filter((o) => o < decimal).length + 1;
}

export function kellyStake(
  odds: number,
  probability: number,
  bankrollFraction = 0.25,
): number {
  const b = odds - 1;
  const q = 1 - probability;
  const kelly = (b * probability - q) / b;
  return Math.max(0, Math.min(kelly * bankrollFraction, 0.1));
}

export function formatOdds(
  decimal: number,
  format: "decimal" | "fractional" | "american" = "fractional",
): string {
  switch (format) {
    case "fractional":
      return decimalToFractional(decimal);
    case "american":
      return decimal >= 2
        ? `+${Math.round((decimal - 1) * 100)}`
        : `-${Math.round(100 / (decimal - 1))}`;
    case "decimal":
    default:
      return decimal.toFixed(2);
  }
}

export function parseSP(sp: string | null): number | null {
  if (!sp) return null;

  const clean = sp.trim().toUpperCase();
  const stripped = clean.replace(/[£$€]/, "").replace(/\s+/g, " ");

  if (stripped === "NR" || stripped === "N/R" || stripped === "WD") return null;

  if (stripped.includes("JF") || stripped.includes("CF")) {
    const oddsMatch = stripped.match(/(\d+\/\d+|\d+\.?\d*)/);
    if (oddsMatch) return fractionalToDecimal(oddsMatch[1]);
    return null; // sem odds concretas → null
  }

  const fractionalResult = fractionalToDecimal(stripped);
  if (fractionalResult !== null) return fractionalResult;

  const decimal = Number.parseFloat(stripped);
  if (!Number.isNaN(decimal) && decimal > 0) return decimal;

  return null;
}

export function getOddsBand(decimal: number): string {
  if (decimal < 2) return "strong_favorite";
  if (decimal < 4) return "favorite";
  if (decimal < 7) return "contender";
  if (decimal < 15) return "outsider";
  if (decimal < 30) return "long_shot";
  return "no_hope";
}

export function calculateOddsMovementConfidence(
  openingOdds: number,
  currentOdds: number,
): number {
  const change = (currentOdds - openingOdds) / openingOdds;

  if (change < -0.3) return 1.0;
  if (change < -0.15) return 0.8;
  if (change < -0.05) return 0.6;
  if (change < 0.05) return 0.5;
  if (change < 0.15) return 0.4;
  if (change < 0.3) return 0.2;
  return 0.0;
}

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
