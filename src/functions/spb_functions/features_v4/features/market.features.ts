// features_v4/features/market.features.ts

import {
  decimalToImpliedProbability,
  getOddsBand,
  parseSP,
} from "../converters/odds.converter";
import type { ProcessedHorse, RaceHorseEnriched } from "../types/core.types";

/**
 * Interface for market/betting features
 */
export interface MarketFeatures {
  // Basic SP features
  sp_decimal: number | null;
  sp_rank: number;
  sp_implied_prob: number | null;
  sp_vs_field_avg: number | null;

  // Market position
  is_favorite: 0 | 1;
  is_joint_favorite: 0 | 1;
  is_top3_market: 0 | 1;
  is_outsider: 0 | 1;
  market_position_category: string;

  // Field market metrics
  field_total_probability: number;
  field_overround: number;
  market_confidence: number;
  sp_concentration: number;

  // Value indicators
  sp_value_rating: number;
  is_overbet: 0 | 1;
  is_underbet: 0 | 1;
  market_inefficiency: number;

  // Market movement (if historical odds available)
  odds_movement: number | null;
  odds_volatility: number | null;
  market_support: number | null;

  // Relative market metrics
  sp_to_favorite_ratio: number | null;
  sp_percentile: number;
  normalized_sp: number | null;
  market_share: number | null;
}

/**
 * Extract market features from horse and field data
 */
export function extractMarketFeatures(
  horse: ProcessedHorse,
  rawHorse: RaceHorseEnriched,
  allHorses: ProcessedHorse[],
  allRawHorses: RaceHorseEnriched[],
): MarketFeatures {
  // Parse SP if not already done
  const sp = horse.sp_decimal || parseSP(rawHorse.sp);

  // Get all valid SPs in the field
  const fieldSPs = getAllFieldSPs(allHorses, allRawHorses);

  // Calculate basic market metrics
  const basicMetrics = calculateBasicMarketMetrics(sp, fieldSPs);

  // Calculate market position
  const positionMetrics = calculateMarketPosition(sp, fieldSPs);

  // Calculate field metrics
  const fieldMetrics = calculateFieldMarketMetrics(fieldSPs);

  // Calculate value indicators
  const valueMetrics = calculateValueIndicators(sp, fieldSPs, basicMetrics);

  // Calculate relative metrics
  const relativeMetrics = calculateRelativeMetrics(sp, fieldSPs);

  // Market movement (placeholder - would need historical odds)
  const movementMetrics = calculateMarketMovement(sp, null);

  return {
    ...basicMetrics,
    ...positionMetrics,
    ...fieldMetrics,
    ...valueMetrics,
    ...relativeMetrics,
    ...movementMetrics,
  };
}

/**
 * Get all valid SPs from the field
 */
function getAllFieldSPs(
  horses: ProcessedHorse[],
  rawHorses: RaceHorseEnriched[],
): number[] {
  const sps: number[] = [];

  for (let i = 0; i < horses.length; i++) {
    const sp = horses[i].sp_decimal || parseSP(rawHorses[i].sp);
    if (sp !== null && sp > 0 && sp < 1000) {
      sps.push(sp);
    }
  }

  return sps.sort((a, b) => a - b); // Sort ascending (favorite first)
}

/**
 * Calculate basic market metrics
 */
function calculateBasicMarketMetrics(
  sp: number | null,
  fieldSPs: number[],
): Partial<MarketFeatures> {
  if (!sp || fieldSPs.length === 0) {
    return {
      sp_decimal: sp,
      sp_rank: fieldSPs.length + 1,
      sp_implied_prob: null,
      sp_vs_field_avg: null,
    };
  }

  // Calculate rank (1 = favorite)
  const rank = fieldSPs.filter((s) => s < sp).length + 1;

  // Calculate implied probability
  const impliedProb = decimalToImpliedProbability(sp);

  // Compare to field average
  const fieldAvg = fieldSPs.reduce((sum, s) => sum + s, 0) / fieldSPs.length;
  const vsFieldAvg = sp - fieldAvg;

  return {
    sp_decimal: sp,
    sp_rank: rank,
    sp_implied_prob: impliedProb,
    sp_vs_field_avg: vsFieldAvg,
  };
}

/**
 * Calculate market position metrics
 */
function calculateMarketPosition(
  sp: number | null,
  fieldSPs: number[],
): Partial<MarketFeatures> {
  if (!sp || fieldSPs.length === 0) {
    return {
      is_favorite: 0,
      is_joint_favorite: 0,
      is_top3_market: 0,
      is_outsider: 0,
      market_position_category: "unknown",
    };
  }

  const minSP = Math.min(...fieldSPs);
  const isFavorite = sp === minSP ? 1 : 0;

  // Check for joint favorite
  const favCount = fieldSPs.filter((s) => s === minSP).length;
  const isJointFavorite = isFavorite && favCount > 1 ? 1 : 0;

  // Check if in top 3 market picks
  const rank = fieldSPs.filter((s) => s < sp).length + 1;
  const isTop3 = rank <= 3 ? 1 : 0;

  // Check if outsider (SP > 10.0 or rank > 2/3 of field)
  const isOutsider = sp > 10 || rank > fieldSPs.length * 0.67 ? 1 : 0;

  // Get category
  const category = getOddsBand(sp);

  return {
    is_favorite: isFavorite,
    is_joint_favorite: isJointFavorite,
    is_top3_market: isTop3,
    is_outsider: isOutsider,
    market_position_category: category,
  };
}

/**
 * Calculate field market metrics
 */
function calculateFieldMarketMetrics(
  fieldSPs: number[],
): Partial<MarketFeatures> {
  if (fieldSPs.length === 0) {
    return {
      field_total_probability: 0,
      field_overround: 0,
      market_confidence: 0,
      sp_concentration: 0,
    };
  }

  // Calculate total implied probability (book percentage)
  const totalProb = fieldSPs.reduce((sum, sp) => {
    const prob = decimalToImpliedProbability(sp);
    return sum + (prob || 0);
  }, 0);

  // Calculate overround (margin)
  const overround = totalProb - 1;

  // Market confidence (inverse of overround, capped at 1)
  const confidence = Math.max(0, Math.min(1, 1 - overround));

  // SP concentration (how much probability is in top picks)
  const top3SPs = fieldSPs.slice(0, 3);
  const top3Prob = top3SPs.reduce((sum, sp) => {
    const prob = decimalToImpliedProbability(sp);
    return sum + (prob || 0);
  }, 0);
  const concentration = totalProb > 0 ? top3Prob / totalProb : 0;

  return {
    field_total_probability: totalProb,
    field_overround: overround,
    market_confidence: confidence,
    sp_concentration: concentration,
  };
}

/**
 * Calculate value indicators
 */
function calculateValueIndicators(
  sp: number | null,
  fieldSPs: number[],
  basicMetrics: Partial<MarketFeatures>,
): Partial<MarketFeatures> {
  if (!sp || !basicMetrics.sp_implied_prob) {
    return {
      sp_value_rating: 0,
      is_overbet: 0,
      is_underbet: 0,
      market_inefficiency: 0,
    };
  }

  // Simple value rating based on rank vs odds
  const expectedRank = Math.ceil(
    fieldSPs.length * basicMetrics.sp_implied_prob,
  );
  const actualRank = basicMetrics.sp_rank || fieldSPs.length;
  const valueRating = (expectedRank - actualRank) / fieldSPs.length;

  // Check if overbet (odds too short for likely ability)
  const isOverbet = valueRating < -0.2 ? 1 : 0;

  // Check if underbet (odds too long for likely ability)
  const isUnderbet = valueRating > 0.2 ? 1 : 0;

  // Market inefficiency score
  const avgSP = fieldSPs.reduce((sum, s) => sum + s, 0) / fieldSPs.length;
  const stdSP = calculateStandardDeviation(fieldSPs);
  const inefficiency = stdSP / avgSP; // Coefficient of variation

  return {
    sp_value_rating: valueRating,
    is_overbet: isOverbet,
    is_underbet: isUnderbet,
    market_inefficiency: inefficiency,
  };
}

/**
 * Calculate relative market metrics
 */
function calculateRelativeMetrics(
  sp: number | null,
  fieldSPs: number[],
): Partial<MarketFeatures> {
  if (!sp || fieldSPs.length === 0) {
    return {
      sp_to_favorite_ratio: null,
      sp_percentile: 0,
      normalized_sp: null,
      market_share: null,
    };
  }

  // Ratio to favorite
  const favoriteSP = Math.min(...fieldSPs);
  const toFavoriteRatio = sp / favoriteSP;

  // Percentile in field
  const rank = fieldSPs.filter((s) => s < sp).length + 1;
  const percentile = 1 - (rank - 1) / fieldSPs.length;

  // Normalized SP (z-score)
  const avgSP = fieldSPs.reduce((sum, s) => sum + s, 0) / fieldSPs.length;
  const stdSP = calculateStandardDeviation(fieldSPs);
  const normalizedSP = stdSP > 0 ? (sp - avgSP) / stdSP : 0;

  // Market share (this horse's probability / total probability)
  const thisProb = decimalToImpliedProbability(sp) || 0;
  const totalProb = fieldSPs.reduce((sum, s) => {
    const prob = decimalToImpliedProbability(s);
    return sum + (prob || 0);
  }, 0);
  const marketShare = totalProb > 0 ? thisProb / totalProb : null;

  return {
    sp_to_favorite_ratio: toFavoriteRatio,
    sp_percentile: percentile,
    normalized_sp: normalizedSP,
    market_share: marketShare,
  };
}

/**
 * Calculate market movement metrics
 * Note: This would need historical odds data to work properly
 */
function calculateMarketMovement(
  currentSP: number | null,
  historicalOdds: number[] | null,
): Partial<MarketFeatures> {
  if (!currentSP || !historicalOdds || historicalOdds.length < 2) {
    return {
      odds_movement: null,
      odds_volatility: null,
      market_support: null,
    };
  }

  // Calculate movement (negative = shortening = good)
  const openingOdds = historicalOdds[0];
  const movement = ((currentSP - openingOdds) / openingOdds) * 100;

  // Calculate volatility
  const volatility = calculateStandardDeviation(historicalOdds) / openingOdds;

  // Market support (based on consistent shortening)
  let support = 0;
  for (let i = 1; i < historicalOdds.length; i++) {
    if (historicalOdds[i] < historicalOdds[i - 1]) {
      support += 1;
    }
  }
  support = support / (historicalOdds.length - 1);

  return {
    odds_movement: movement,
    odds_volatility: volatility,
    market_support: support,
  };
}

/**
 * Helper to calculate standard deviation
 */
function calculateStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / values.length;

  return Math.sqrt(variance);
}

/**
 * Analyze market sentiment
 */
export function analyzeMarketSentiment(features: MarketFeatures): {
  sentiment:
    | "strong_support"
    | "moderate_support"
    | "neutral"
    | "weak"
    | "very_weak";
  confidence: number;
  riskLevel: "low" | "medium" | "high";
} {
  let sentimentScore = 0;

  // Positive factors
  if (features.is_favorite) sentimentScore += 3;
  if (features.is_top3_market) sentimentScore += 2;
  if (features.sp_implied_prob && features.sp_implied_prob > 0.2)
    sentimentScore += 1;
  if (features.market_support && features.market_support > 0.6)
    sentimentScore += 2;

  // Negative factors
  if (features.is_outsider) sentimentScore -= 2;
  if (features.is_overbet) sentimentScore -= 1;
  if (features.market_inefficiency > 0.5) sentimentScore -= 1;

  // Determine sentiment
  let sentiment:
    | "strong_support"
    | "moderate_support"
    | "neutral"
    | "weak"
    | "very_weak";
  if (sentimentScore >= 5) sentiment = "strong_support";
  else if (sentimentScore >= 3) sentiment = "moderate_support";
  else if (sentimentScore >= 0) sentiment = "neutral";
  else if (sentimentScore >= -2) sentiment = "weak";
  else sentiment = "very_weak";

  // Calculate confidence
  const confidence =
    features.market_confidence * (1 - features.market_inefficiency);

  // Determine risk level
  let riskLevel: "low" | "medium" | "high";
  if (
    features.sp_decimal &&
    features.sp_decimal < 3 &&
    features.market_confidence > 0.8
  ) {
    riskLevel = "low";
  } else if (features.is_outsider || features.market_inefficiency > 0.6) {
    riskLevel = "high";
  } else {
    riskLevel = "medium";
  }

  return { sentiment, confidence, riskLevel };
}

/**
 * Calculate expected value for lay betting
 */
export function calculateLayValue(
  features: MarketFeatures,
  commission: number = 0.05,
): {
  layOdds: number | null;
  liability: number | null;
  expectedReturn: number | null;
  layValue: number | null;
} {
  if (!features.sp_decimal || !features.sp_implied_prob) {
    return {
      layOdds: null,
      liability: null,
      expectedReturn: null,
      layValue: null,
    };
  }

  // Suggested lay odds (slightly worse than back odds)
  const layOdds = features.sp_decimal * 1.02;

  // Liability per unit stake
  const liability = layOdds - 1;

  // Probability of winning the lay bet (horse doesn't win)
  const layWinProb = 1 - features.sp_implied_prob;

  // Expected return after commission
  const expectedReturn =
    layWinProb * 1 * (1 - commission) - (1 - layWinProb) * liability;

  // Lay value rating
  const layValue = expectedReturn / liability;

  return {
    layOdds,
    liability,
    expectedReturn,
    layValue,
  };
}

/**
 * Validate market features
 */
export function validateMarketFeatures(features: MarketFeatures): {
  isValid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Check SP validity
  if (features.sp_decimal !== null) {
    if (features.sp_decimal < 1.01) {
      issues.push("SP too low (< 1.01)");
    }
    if (features.sp_decimal > 999) {
      issues.push("SP too high (> 999)");
    }
  }

  // Check probability validity
  if (features.sp_implied_prob !== null) {
    if (features.sp_implied_prob < 0 || features.sp_implied_prob > 1) {
      issues.push("Invalid implied probability");
    }
  }

  // Check overround
  if (features.field_overround < -0.5 || features.field_overround > 1) {
    issues.push("Unusual overround value");
  }

  // Check logical consistency
  if (features.is_favorite && features.is_outsider) {
    issues.push("Cannot be both favorite and outsider");
  }

  if (features.sp_rank < 1) {
    issues.push("Invalid SP rank");
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

/**
 * Get feature importance for market features
 */
export function getMarketFeatureImportance(): Record<string, number> {
  return {
    // High importance
    sp_decimal: 0.9,
    sp_rank: 0.95,
    sp_implied_prob: 0.9,
    is_favorite: 0.85,

    // Medium-high importance
    is_top3_market: 0.75,
    sp_to_favorite_ratio: 0.7,
    market_share: 0.7,
    field_overround: 0.65,

    // Medium importance
    sp_vs_field_avg: 0.6,
    sp_percentile: 0.6,
    market_confidence: 0.55,
    sp_value_rating: 0.6,

    // Lower importance
    is_joint_favorite: 0.4,
    is_outsider: 0.5,
    is_overbet: 0.45,
    is_underbet: 0.45,
    normalized_sp: 0.5,
    sp_concentration: 0.4,
    market_inefficiency: 0.45,

    // Movement metrics (when available)
    odds_movement: 0.7,
    odds_volatility: 0.5,
    market_support: 0.65,
  };
}
