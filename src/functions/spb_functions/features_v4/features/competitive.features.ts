// features_v4/features/competitive.features.ts

import { parseForm, parseSP } from "../converters";
import type {
  ProcessedHorse,
  ProcessedRace,
  RaceHorseEnriched,
} from "../types/core.types";

/**
 * Interface for competitive context features
 */
export interface CompetitiveFeatures {
  // Field quality metrics
  field_avg_or: number;
  field_std_or: number;
  field_max_or: number;
  field_min_or: number;
  field_or_spread: number;

  // Horse's position in field
  or_rank_in_race: number;
  or_percentile_in_race: number;
  or_diff_to_top: number;
  or_diff_to_avg: number;
  stronger_opponents_count: number;
  weaker_opponents_count: number;

  // Field composition
  field_avg_career_wins: number;
  field_avg_win_rate: number;
  field_avg_recent_position: number;
  experienced_runners_count: number;
  maiden_runners_count: number;

  // Competitive advantage metrics
  or_advantage_score: number;
  experience_advantage: number;
  form_advantage: number;
  weight_advantage: number;

  // Race competitiveness
  race_competitiveness_score: number;
  field_depth_score: number;
  quality_concentration: number;
  is_competitive_race: 0 | 1;

  // Relative performance indicators
  better_than_field_avg: 0 | 1;
  in_top_quarter: 0 | 1;
  in_bottom_quarter: 0 | 1;
  outlier_status: "high" | "normal" | "low";
}

/**
 * Extract competitive features from race context
 */
export function extractCompetitiveFeatures(
  horse: ProcessedHorse,
  rawHorse: RaceHorseEnriched,
  race: ProcessedRace,
  allHorses: ProcessedHorse[],
  allRawHorses: RaceHorseEnriched[],
): CompetitiveFeatures {
  const activeRawHorses = allRawHorses.filter((h) => h.non_runner !== 1);
  const activeHorses = allHorses.filter((h) => {
    const raw = allRawHorses.find((r) => r.id === h.id);
    return raw?.non_runner !== 1;
  });

  // Calculate field quality metrics
  const fieldQuality = calculateFieldQuality(activeRawHorses);

  // Calculate horse's position in field
  const positionMetrics = calculatePositionInField(
    rawHorse,
    activeRawHorses,
    fieldQuality,
  );

  // Calculate field composition
  const fieldComposition = calculateFieldComposition(activeRawHorses);

  // Calculate competitive advantages (now using race parameter)
  const advantages = calculateCompetitiveAdvantages(
    horse,
    rawHorse,
    activeHorses,
    activeRawHorses,
    fieldQuality,
    race,
  );

  // Calculate race competitiveness
  const competitiveness = calculateRaceCompetitiveness(
    fieldQuality,
    fieldComposition,
    activeRawHorses,
    race,
  );

  // Calculate relative performance indicators
  const relativePerformance = calculateRelativePerformance(
    rawHorse,
    fieldQuality,
    positionMetrics,
  );

  return {
    // Field quality
    field_avg_or: fieldQuality.field_avg_or ?? 0,
    field_std_or: fieldQuality.field_std_or ?? 0,
    field_max_or: fieldQuality.field_max_or ?? 0,
    field_min_or: fieldQuality.field_min_or ?? 0,
    field_or_spread: fieldQuality.field_or_spread ?? 0,

    // Position in field
    or_rank_in_race: positionMetrics.or_rank_in_race ?? 0,
    or_percentile_in_race: positionMetrics.or_percentile_in_race ?? 0,
    or_diff_to_top: positionMetrics.or_diff_to_top ?? 0,
    or_diff_to_avg: positionMetrics.or_diff_to_avg ?? 0,
    stronger_opponents_count: positionMetrics.stronger_opponents_count ?? 0,
    weaker_opponents_count: positionMetrics.weaker_opponents_count ?? 0,

    // Field composition
    field_avg_career_wins: fieldComposition.field_avg_career_wins ?? 0,
    field_avg_win_rate: fieldComposition.field_avg_win_rate ?? 0,
    field_avg_recent_position: fieldComposition.field_avg_recent_position ?? 10,
    experienced_runners_count: fieldComposition.experienced_runners_count ?? 0,
    maiden_runners_count: fieldComposition.maiden_runners_count ?? 0,

    // Competitive advantages
    or_advantage_score: advantages.or_advantage_score ?? 0,
    experience_advantage: advantages.experience_advantage ?? 0,
    form_advantage: advantages.form_advantage ?? 0,
    weight_advantage: advantages.weight_advantage ?? 0,

    // Race competitiveness
    race_competitiveness_score: competitiveness.race_competitiveness_score ?? 0,
    field_depth_score: competitiveness.field_depth_score ?? 0,
    quality_concentration: competitiveness.quality_concentration ?? 0,
    is_competitive_race: competitiveness.is_competitive_race ?? 0,

    // Relative performance
    better_than_field_avg: relativePerformance.better_than_field_avg ?? 0,
    in_top_quarter: relativePerformance.in_top_quarter ?? 0,
    in_bottom_quarter: relativePerformance.in_bottom_quarter ?? 0,
    outlier_status: relativePerformance.outlier_status ?? "normal",
  };
}

/**
 * Calculate field quality metrics
 */
function calculateFieldQuality(
  horses: RaceHorseEnriched[],
): Partial<CompetitiveFeatures> {
  // Tentar OR ratings reais primeiro
  let orRatings = horses
    .map((h) => h.or_rating)
    .filter((r) => r !== null && r > 0) as number[];

  // Se nenhum OR real disponível, usar imputados via SP
  if (orRatings.length === 0) {
    orRatings = horses
      .map((h) => {
        if (h.or_rating) return h.or_rating;
        const sp = parseSP(h.sp);
        if (sp && sp < 20) return Math.round(100 - sp * 3);
        return null;
      })
      .filter((r) => r !== null && r > 0) as number[];
  }

  if (orRatings.length === 0) {
    return {
      field_avg_or: 0,
      field_std_or: 0,
      field_max_or: 0,
      field_min_or: 0,
      field_or_spread: 0,
    };
  }

  const avgOR = orRatings.reduce((sum, r) => sum + r, 0) / orRatings.length;
  const maxOR = Math.max(...orRatings);
  const minOR = Math.min(...orRatings);
  const spread = maxOR - minOR;
  const variance =
    orRatings.reduce((sum, r) => sum + Math.pow(r - avgOR, 2), 0) /
    orRatings.length;

  return {
    field_avg_or: avgOR,
    field_std_or: Math.sqrt(variance),
    field_max_or: maxOR,
    field_min_or: minOR,
    field_or_spread: spread,
  };
}

/**
 * Calculate horse's position in the competitive field
 */
function calculatePositionInField(
  horse: RaceHorseEnriched,
  allHorses: RaceHorseEnriched[],
  fieldQuality: Partial<CompetitiveFeatures>,
): Partial<CompetitiveFeatures> {
  // FIX: excluir non-runners do cálculo
  const activeHorses = allHorses.filter((h) => h.non_runner !== 1);

  const horseOR = horse.or_rating || fieldQuality.field_avg_or || 0;

  const allORs = activeHorses
    .map((h) => h.or_rating || 0)
    .filter((r) => r > 0)
    .sort((a, b) => b - a);

  const rank = allORs.findIndex((r) => r <= horseOR) + 1;
  const percentile = allORs.length > 0 ? 1 - (rank - 1) / allORs.length : 0.5;
  const diffToTop = (fieldQuality.field_max_or || 0) - horseOR;
  const diffToAvg = horseOR - (fieldQuality.field_avg_or || 0);
  const strongerCount = allORs.filter((r) => r > horseOR).length;
  const weakerCount = allORs.filter((r) => r < horseOR).length;

  return {
    or_rank_in_race: rank || allORs.length + 1,
    or_percentile_in_race: percentile,
    or_diff_to_top: diffToTop,
    or_diff_to_avg: diffToAvg,
    stronger_opponents_count: strongerCount,
    weaker_opponents_count: weakerCount,
  };
}

/**
 * Calculate field composition metrics
 */
function calculateFieldComposition(
  horses: RaceHorseEnriched[],
): Partial<CompetitiveFeatures> {
  const careerStats = horses.map((h) => {
    // FIX 1: usar parseForm em vez de reparse manual
    const parsed = parseForm(h.form);
    const wins = parsed.figures.filter((f) => f === 1).length;
    const runs = parsed.figures.length;
    const winRate = runs > 0 ? wins / runs : 0;

    const recentFigures = parsed.recent_figures;
    const avgRecent =
      recentFigures.length > 0
        ? recentFigures.reduce((sum, p) => sum + p, 0) / recentFigures.length
        : 10;

    return {
      wins,
      runs,
      winRate,
      avgRecent,
      isExperienced: runs >= 5,
      isMaiden: wins === 0,
    };
  });

  const validStats = careerStats.filter((s) => s.runs > 0);

  const avgWins =
    validStats.length > 0
      ? validStats.reduce((sum, s) => sum + s.wins, 0) / validStats.length
      : 0;

  const avgWinRate =
    validStats.length > 0
      ? validStats.reduce((sum, s) => sum + s.winRate, 0) / validStats.length
      : 0;

  const avgRecentPosition =
    validStats.length > 0
      ? validStats.reduce((sum, s) => sum + s.avgRecent, 0) / validStats.length
      : 10;

  return {
    field_avg_career_wins: avgWins,
    field_avg_win_rate: avgWinRate,
    field_avg_recent_position: avgRecentPosition,
    experienced_runners_count: careerStats.filter((s) => s.isExperienced)
      .length,
    maiden_runners_count: careerStats.filter((s) => s.isMaiden).length,
  };
}

/**
 * Calculate competitive advantages
 */
function calculateCompetitiveAdvantages(
  horse: ProcessedHorse,
  rawHorse: RaceHorseEnriched,
  allHorses: ProcessedHorse[],
  allRawHorses: RaceHorseEnriched[],
  fieldQuality: Partial<CompetitiveFeatures>,
  race: ProcessedRace,
): Partial<CompetitiveFeatures> {
  const horseOR = rawHorse.or_rating || fieldQuality.field_avg_or || 0;
  const orAdvantage =
    fieldQuality.field_std_or && fieldQuality.field_avg_or
      ? (horseOR - fieldQuality.field_avg_or) / fieldQuality.field_std_or
      : 0;

  // FIX 2: usar parseForm em vez de reparse manual
  const horseRuns = parseForm(rawHorse.form).figures.length;
  const fieldAvgRuns =
    allRawHorses
      .map((h) => parseForm(h.form).figures.length)
      .reduce((sum, r) => sum + r, 0) / Math.max(allRawHorses.length, 1);

  const experienceAdvantage =
    (horseRuns - fieldAvgRuns) / Math.max(fieldAvgRuns, 1);

  const horseFormAvg = horse.form_data.avg_position || 10;
  const fieldFormAvg =
    allHorses
      .map((h) => h.form_data.avg_position || 10)
      .reduce((sum, p) => sum + p, 0) / Math.max(allHorses.length, 1);
  const formAdvantage =
    (fieldFormAvg - horseFormAvg) / Math.max(fieldFormAvg, 1);

  const horseWeight = horse.weight_kg || 60;
  const fieldAvgWeight =
    allHorses
      .map((h) => h.weight_kg || 60)
      .filter((w) => w > 0)
      .reduce((sum, w) => sum + w, 0) / Math.max(allHorses.length, 1);

  const classMultiplier = race.race_class ? (7 - race.race_class) / 6 : 0.5;
  const weightAdvantage =
    ((fieldAvgWeight - horseWeight) / fieldAvgWeight) * classMultiplier;

  return {
    or_advantage_score: orAdvantage,
    experience_advantage: experienceAdvantage,
    form_advantage: formAdvantage,
    weight_advantage: weightAdvantage,
  };
}

/**
 * Calculate race competitiveness metrics
 */
function calculateRaceCompetitiveness(
  fieldQuality: Partial<CompetitiveFeatures>,
  fieldComposition: Partial<CompetitiveFeatures>,
  horses: RaceHorseEnriched[],
  race: ProcessedRace,
): Partial<CompetitiveFeatures> {
  // Competitiveness score based on OR spread and standard deviation
  let competitivenessScore = 0;

  if (fieldQuality.field_or_spread && fieldQuality.field_avg_or) {
    // Lower spread relative to average = more competitive
    const spreadRatio =
      fieldQuality.field_or_spread / fieldQuality.field_avg_or;
    competitivenessScore = Math.max(0, 1 - spreadRatio);
  }

  // Adjust for field composition (experienced runners make it more competitive)
  if (fieldComposition.experienced_runners_count) {
    const experiencedRatio =
      fieldComposition.experienced_runners_count / horses.length;
    competitivenessScore = competitivenessScore * 0.7 + experiencedRatio * 0.3;
  }

  // Field depth score (how many quality horses)
  const qualityHorses = horses.filter(
    (h) =>
      h.or_rating &&
      fieldQuality.field_avg_or &&
      h.or_rating >= fieldQuality.field_avg_or * 0.9,
  ).length;
  const fieldDepthScore = Math.min(
    1,
    qualityHorses / Math.max(horses.length * 0.5, 1),
  );

  // Quality concentration (are the good horses bunched together?)
  const topThirdCount = Math.ceil(horses.length / 3);
  const topThirdORs = horses
    .map((h) => h.or_rating || 0)
    .filter((r) => r > 0)
    .sort((a, b) => b - a)
    .slice(0, topThirdCount);

  let qualityConcentration = 0;
  if (topThirdORs.length > 1) {
    const topAvg =
      topThirdORs.reduce((sum, r) => sum + r, 0) / topThirdORs.length;
    const topStd = Math.sqrt(
      topThirdORs.reduce((sum, r) => sum + Math.pow(r - topAvg, 2), 0) /
        topThirdORs.length,
    );
    qualityConcentration = topAvg > 0 ? 1 - topStd / topAvg : 0;
  }

  // Adjust for race class (higher class = more competitive)
  if (race.race_class) {
    const classBonus = ((7 - race.race_class) / 7) * 0.2; // Up to 20% bonus for class 1
    competitivenessScore = Math.min(1, competitivenessScore + classBonus);
  }

  // Is competitive race (binary indicator)
  const isCompetitive =
    competitivenessScore > 0.6 && fieldDepthScore > 0.5 ? 1 : 0;

  return {
    race_competitiveness_score: competitivenessScore,
    field_depth_score: fieldDepthScore,
    quality_concentration: qualityConcentration,
    is_competitive_race: isCompetitive,
  };
}

/**
 * Calculate relative performance indicators
 */
function calculateRelativePerformance(
  horse: RaceHorseEnriched,
  fieldQuality: Partial<CompetitiveFeatures>,
  positionMetrics: Partial<CompetitiveFeatures>,
): Partial<CompetitiveFeatures> {
  const horseOR = horse.or_rating || fieldQuality.field_avg_or || 0;

  // Better than field average?
  const betterThanAvg = horseOR > (fieldQuality.field_avg_or || 0) ? 1 : 0;

  // In top/bottom quarter?
  const inTopQuarter =
    (positionMetrics.or_percentile_in_race || 0) >= 0.75 ? 1 : 0;
  const inBottomQuarter =
    (positionMetrics.or_percentile_in_race || 0) <= 0.25 ? 1 : 0;

  // Outlier status (based on standard deviations from mean)
  let outlierStatus: "high" | "normal" | "low" = "normal";
  if (fieldQuality.field_avg_or && fieldQuality.field_std_or) {
    const zScore =
      (horseOR - fieldQuality.field_avg_or) / fieldQuality.field_std_or;
    if (zScore > 2) outlierStatus = "high";
    else if (zScore < -2) outlierStatus = "low";
  }

  return {
    better_than_field_avg: betterThanAvg,
    in_top_quarter: inTopQuarter,
    in_bottom_quarter: inBottomQuarter,
    outlier_status: outlierStatus,
  };
}

/**
 * Analyze competitive dynamics
 */
export function analyzeCompetitiveDynamics(features: CompetitiveFeatures): {
  competitivePosition: "dominant" | "strong" | "moderate" | "weak" | "poor";
  threatLevel: "minimal" | "low" | "moderate" | "high" | "extreme";
  opportunity: "excellent" | "good" | "fair" | "limited" | "poor";
} {
  // Determine competitive position
  let position: "dominant" | "strong" | "moderate" | "weak" | "poor";
  if (features.or_rank_in_race === 1 && features.or_diff_to_top === 0) {
    position = "dominant";
  } else if (features.in_top_quarter && features.or_advantage_score > 0.5) {
    position = "strong";
  } else if (features.better_than_field_avg) {
    position = "moderate";
  } else if (features.in_bottom_quarter) {
    position = "poor";
  } else {
    position = "weak";
  }

  // Assess threat level from field
  let threatLevel: "minimal" | "low" | "moderate" | "high" | "extreme";
  if (features.stronger_opponents_count === 0) {
    threatLevel = "minimal";
  } else if (features.stronger_opponents_count <= 2) {
    threatLevel = "low";
  } else if (features.stronger_opponents_count <= 5) {
    threatLevel = "moderate";
  } else if (features.is_competitive_race) {
    threatLevel = "extreme";
  } else {
    threatLevel = "high";
  }

  // Evaluate opportunity
  let opportunity: "excellent" | "good" | "fair" | "limited" | "poor";
  if (
    position === "dominant" ||
    (position === "strong" && !features.is_competitive_race)
  ) {
    opportunity = "excellent";
  } else if (
    position === "strong" ||
    (position === "moderate" && features.field_depth_score < 0.5)
  ) {
    opportunity = "good";
  } else if (position === "moderate") {
    opportunity = "fair";
  } else if (
    features.weaker_opponents_count > features.stronger_opponents_count
  ) {
    opportunity = "limited";
  } else {
    opportunity = "poor";
  }

  return { competitivePosition: position, threatLevel, opportunity };
}

/**
 * Calculate competition-adjusted probability
 */
export function calculateAdjustedProbability(
  features: CompetitiveFeatures,
  baseProbability: number,
): number {
  let adjustedProb = baseProbability;

  // Adjust for OR advantage
  adjustedProb *= 1 + features.or_advantage_score * 0.1;

  // Adjust for competitive race
  if (features.is_competitive_race) {
    adjustedProb *= 0.9; // Reduce probability in competitive races
  }

  // Adjust for field depth
  adjustedProb *= 1 - features.field_depth_score * 0.1;

  // Adjust for outlier status
  if (features.outlier_status === "high") {
    adjustedProb *= 1.2;
  } else if (features.outlier_status === "low") {
    adjustedProb *= 0.8;
  }

  // Cap between 0 and 1
  return Math.max(0, Math.min(1, adjustedProb));
}

/**
 * Validate competitive features
 */
export function validateCompetitiveFeatures(features: CompetitiveFeatures): {
  isValid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Check OR metrics
  if (features.field_avg_or === 0) {
    warnings.push("No OR ratings available for field");
  }

  if (
    features.or_rank_in_race >
    features.stronger_opponents_count + features.weaker_opponents_count + 1
  ) {
    warnings.push("Inconsistent ranking calculations");
  }

  // Check percentiles
  if (
    features.or_percentile_in_race < 0 ||
    features.or_percentile_in_race > 1
  ) {
    warnings.push("Invalid percentile value");
  }

  // Check logical consistency
  if (features.in_top_quarter && features.in_bottom_quarter) {
    warnings.push("Cannot be in both top and bottom quarter");
  }

  if (features.better_than_field_avg && features.or_diff_to_avg < 0) {
    warnings.push("Inconsistent average comparison");
  }

  // Check scores
  if (
    features.race_competitiveness_score < 0 ||
    features.race_competitiveness_score > 1
  ) {
    warnings.push("Invalid competitiveness score");
  }

  return {
    isValid: warnings.length === 0,
    warnings,
  };
}

/**
 * Get feature importance for competitive features
 */
export function getCompetitiveFeatureImportance(): Record<string, number> {
  return {
    // High importance
    or_rank_in_race: 0.9,
    or_percentile_in_race: 0.85,
    stronger_opponents_count: 0.8,
    or_advantage_score: 0.85,

    // Medium-high importance
    field_avg_or: 0.75,
    or_diff_to_top: 0.7,
    race_competitiveness_score: 0.75,
    field_depth_score: 0.7,

    // Medium importance
    field_std_or: 0.6,
    or_diff_to_avg: 0.65,
    field_avg_win_rate: 0.6,
    experience_advantage: 0.55,
    form_advantage: 0.6,

    // Lower importance
    field_or_spread: 0.5,
    weaker_opponents_count: 0.45,
    weight_advantage: 0.5,
    quality_concentration: 0.45,
    maiden_runners_count: 0.4,

    // Binary indicators
    better_than_field_avg: 0.5,
    in_top_quarter: 0.55,
    in_bottom_quarter: 0.45,
    is_competitive_race: 0.6,
  };
}
