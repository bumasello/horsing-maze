// features_v4/features/historical.features.ts

import {
  isInSameDistanceBand,
  parseDistanceToMeters,
} from "../converters/distance.converter";
import type {
  ProcessedRace,
  RaceCardEnriched,
  RaceHorseEnriched,
} from "../types/core.types";

/**
 * Interface for historical race data with both horse and race information
 */
export interface HistoricalRaceData {
  horse: RaceHorseEnriched;
  race: RaceCardEnriched;
}

/**
 * Interface for historical performance features
 */
export interface HistoricalFeatures {
  // Career overall stats
  career_runs: number;
  career_wins: number;
  career_places: number;
  career_win_rate: number;
  career_place_rate: number;
  career_avg_position: number;
  career_position_std: number;

  // Condition-specific stats
  course_runs: number;
  course_wins: number;
  course_win_rate: number;
  distance_band_runs: number;
  distance_band_wins: number;
  distance_band_win_rate: number;
  going_runs: number;
  going_wins: number;
  going_win_rate: number;
  class_runs: number;
  class_wins: number;
  class_win_rate: number;

  // Recent performance
  recent_runs_30d: number;
  recent_wins_30d: number;
  recent_runs_90d: number;
  recent_wins_90d: number;
  recent_avg_position: number;

  // Performance trends
  improvement_rate: number;
  consistency_score: number;
  peak_or_rating: number;
  avg_or_rating: number;

  // Additional historical metrics
  total_prize_money: number;
  best_distance_meters: number;
  preferred_going: number;
  avg_days_between_runs: number;
}

/**
 * Extract historical features from a horse's race history
 */
export function extractHistoricalFeatures(
  historicalData: HistoricalRaceData[],
  currentRace: ProcessedRace,
  currentDate: Date = new Date(),
): HistoricalFeatures {
  // Filter valid historical runs (finished races, not non-runners)
  const validHistory = historicalData.filter(
    ({ horse, race }) =>
      horse.position !== null &&
      horse.position > 0 &&
      horse.non_runner === 0 &&
      race.finished === 1 &&
      race.canceled === 0,
  );

  if (validHistory.length === 0) {
    return getEmptyHistoricalFeatures();
  }

  // Calculate career stats
  const careerStats = calculateCareerStats(validHistory);

  // Calculate condition-specific stats
  const conditionStats = calculateConditionSpecificStats(
    validHistory,
    currentRace,
  );

  // Calculate recent performance
  const recentStats = calculateRecentPerformance(validHistory, currentDate);

  // Calculate performance trends
  const trendStats = calculatePerformanceTrends(validHistory);

  // Calculate additional metrics
  const additionalStats = calculateAdditionalMetrics(validHistory);

  return {
    // Career overall stats
    career_runs: careerStats.career_runs ?? 0,
    career_wins: careerStats.career_wins ?? 0,
    career_places: careerStats.career_places ?? 0,
    career_win_rate: careerStats.career_win_rate ?? 0,
    career_place_rate: careerStats.career_place_rate ?? 0,
    career_avg_position: careerStats.career_avg_position ?? 10,
    career_position_std: careerStats.career_position_std ?? 0,

    // Condition-specific stats
    course_runs: conditionStats.course_runs ?? 0,
    course_wins: conditionStats.course_wins ?? 0,
    course_win_rate: conditionStats.course_win_rate ?? 0,
    distance_band_runs: conditionStats.distance_band_runs ?? 0,
    distance_band_wins: conditionStats.distance_band_wins ?? 0,
    distance_band_win_rate: conditionStats.distance_band_win_rate ?? 0,
    going_runs: conditionStats.going_runs ?? 0,
    going_wins: conditionStats.going_wins ?? 0,
    going_win_rate: conditionStats.going_win_rate ?? 0,
    class_runs: conditionStats.class_runs ?? 0,
    class_wins: conditionStats.class_wins ?? 0,
    class_win_rate: conditionStats.class_win_rate ?? 0,

    // Recent performance
    recent_runs_30d: recentStats.recent_runs_30d ?? 0,
    recent_wins_30d: recentStats.recent_wins_30d ?? 0,
    recent_runs_90d: recentStats.recent_runs_90d ?? 0,
    recent_wins_90d: recentStats.recent_wins_90d ?? 0,
    recent_avg_position: recentStats.recent_avg_position ?? 10,

    // Performance trends
    improvement_rate: trendStats.improvement_rate ?? 0,
    consistency_score: trendStats.consistency_score ?? 0,
    peak_or_rating: trendStats.peak_or_rating ?? 0,
    avg_or_rating: trendStats.avg_or_rating ?? 0,

    // Additional metrics
    total_prize_money: additionalStats.total_prize_money ?? 0,
    best_distance_meters: additionalStats.best_distance_meters ?? 0,
    preferred_going: additionalStats.preferred_going ?? 0,
    avg_days_between_runs: additionalStats.avg_days_between_runs ?? 30,
  };
}

/**
 * Calculate overall career statistics
 */
function calculateCareerStats(
  history: HistoricalRaceData[],
): Partial<HistoricalFeatures> {
  const runs = history.length;
  const wins = history.filter(({ horse }) => horse.position === 1).length;
  const places = history.filter(
    ({ horse }) => horse.position && horse.position <= 3,
  ).length;
  const positions = history
    .map(({ horse }) => horse.position!)
    .filter((p) => p > 0);

  const avgPosition =
    positions.length > 0
      ? positions.reduce((sum, p) => sum + p, 0) / positions.length
      : 10;

  const positionStd = calculateStandardDeviation(positions);

  return {
    career_runs: runs,
    career_wins: wins,
    career_places: places,
    career_win_rate: runs > 0 ? wins / runs : 0,
    career_place_rate: runs > 0 ? places / runs : 0,
    career_avg_position: avgPosition,
    career_position_std: positionStd,
  };
}

/**
 * Calculate condition-specific statistics
 */
function calculateConditionSpecificStats(
  history: HistoricalRaceData[],
  currentRace: ProcessedRace,
): Partial<HistoricalFeatures> {
  // Course-specific
  const courseRuns = history.filter(
    ({ race }) => race.course === currentRace.course,
  );

  // Distance-specific (within 10% of current distance)
  const distanceRuns = history.filter(({ race }) => {
    const historicalDistance = parseDistanceToMeters(race.distance);
    return isInSameDistanceBand(
      historicalDistance,
      currentRace.distance_meters,
      0.1,
    );
  });

  // Going-specific (need to encode historical going)
  const goingRuns = history.filter(({ race }) => {
    const historicalGoing = encodeGoing(race.going);
    return historicalGoing === currentRace.going_encoded;
  });

  // Class-specific
  const classRuns = history.filter(
    ({ race }) => race.class === currentRace.race_class,
  );

  return {
    course_runs: courseRuns.length,
    course_wins: courseRuns.filter(({ horse }) => horse.position === 1).length,
    course_win_rate:
      courseRuns.length > 0
        ? courseRuns.filter(({ horse }) => horse.position === 1).length /
          courseRuns.length
        : 0,

    distance_band_runs: distanceRuns.length,
    distance_band_wins: distanceRuns.filter(({ horse }) => horse.position === 1)
      .length,
    distance_band_win_rate:
      distanceRuns.length > 0
        ? distanceRuns.filter(({ horse }) => horse.position === 1).length /
          distanceRuns.length
        : 0,

    going_runs: goingRuns.length,
    going_wins: goingRuns.filter(({ horse }) => horse.position === 1).length,
    going_win_rate:
      goingRuns.length > 0
        ? goingRuns.filter(({ horse }) => horse.position === 1).length /
          goingRuns.length
        : 0,

    class_runs: classRuns.length,
    class_wins: classRuns.filter(({ horse }) => horse.position === 1).length,
    class_win_rate:
      classRuns.length > 0
        ? classRuns.filter(({ horse }) => horse.position === 1).length /
          classRuns.length
        : 0,
  };
}

/**
 * Calculate recent performance metrics
 */
function calculateRecentPerformance(
  history: HistoricalRaceData[],
  currentDate: Date,
): Partial<HistoricalFeatures> {
  // Filter runs by date
  const thirtyDaysAgo = new Date(currentDate);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const ninetyDaysAgo = new Date(currentDate);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const recent30d = history.filter(({ race }) => {
    const raceDate = new Date(race.date);
    return raceDate >= thirtyDaysAgo;
  });

  const recent90d = history.filter(({ race }) => {
    const raceDate = new Date(race.date);
    return raceDate >= ninetyDaysAgo;
  });

  const recentPositions = recent90d
    .map(({ horse }) => horse.position)
    .filter((p) => p !== null && p > 0) as number[];

  const recentAvgPosition =
    recentPositions.length > 0
      ? recentPositions.reduce((sum, p) => sum + p, 0) / recentPositions.length
      : 10;

  return {
    recent_runs_30d: recent30d.length,
    recent_wins_30d: recent30d.filter(({ horse }) => horse.position === 1)
      .length,
    recent_runs_90d: recent90d.length,
    recent_wins_90d: recent90d.filter(({ horse }) => horse.position === 1)
      .length,
    recent_avg_position: recentAvgPosition,
  };
}

/**
 * Calculate performance trend metrics
 */
function calculatePerformanceTrends(
  history: HistoricalRaceData[],
): Partial<HistoricalFeatures> {
  if (history.length < 2) {
    return {
      improvement_rate: 0,
      consistency_score: 0,
      peak_or_rating: 0,
      avg_or_rating: 0,
    };
  }

  // Sort by date (most recent first)
  const sortedHistory = [...history].sort((a, b) => {
    const dateA = new Date(a.race.date);
    const dateB = new Date(b.race.date);
    return dateB.getTime() - dateA.getTime();
  });

  // Calculate improvement rate (comparing recent to older)
  const midPoint = Math.floor(sortedHistory.length / 2);
  const recentHalf = sortedHistory.slice(0, midPoint);
  const olderHalf = sortedHistory.slice(midPoint);

  const recentAvg = calculateAveragePosition(recentHalf.map((h) => h.horse));
  const olderAvg = calculateAveragePosition(olderHalf.map((h) => h.horse));

  // Lower position is better, so improvement = older - recent
  const improvementRate = olderAvg > 0 ? (olderAvg - recentAvg) / olderAvg : 0;

  // Calculate consistency
  const positions = history
    .map(({ horse }) => horse.position)
    .filter((p) => p !== null && p > 0) as number[];

  const consistency =
    positions.length > 1
      ? 1 - calculateStandardDeviation(positions) / 10 // Normalize by max expected std dev
      : 0;

  // OR ratings
  const orRatings = history
    .map(({ horse }) => horse.or_rating)
    .filter((r) => r !== null && r > 0) as number[];

  const peakOR = orRatings.length > 0 ? Math.max(...orRatings) : 0;
  const avgOR =
    orRatings.length > 0
      ? orRatings.reduce((sum, r) => sum + r, 0) / orRatings.length
      : 0;

  return {
    improvement_rate: Math.max(-1, Math.min(1, improvementRate)),
    consistency_score: Math.max(0, Math.min(1, consistency)),
    peak_or_rating: peakOR,
    avg_or_rating: avgOR,
  };
}

/**
 * Calculate additional historical metrics
 */
function calculateAdditionalMetrics(
  history: HistoricalRaceData[],
): Partial<HistoricalFeatures> {
  // Total prize money (sum of prizes from winning/placing)
  let totalPrize = 0;
  history.forEach(({ horse, race }) => {
    if (horse.position && horse.position <= 3 && race.prize) {
      // Parse prize string and estimate share based on position
      const prizeAmount = parsePrizeAmount(race.prize);
      const share =
        horse.position === 1 ? 0.6 : horse.position === 2 ? 0.2 : 0.1;
      totalPrize += prizeAmount * share;
    }
  });

  // Best distance (where horse performed best)
  const distancePerformances = history.map(({ horse, race }) => ({
    distance: parseDistanceToMeters(race.distance),
    position: horse.position || 99,
  }));

  // Group by distance and find best average
  const distanceGroups = new Map<number, number[]>();
  distancePerformances.forEach(({ distance, position }) => {
    const band = Math.round(distance / 200) * 200; // Round to nearest 200m
    if (!distanceGroups.has(band)) {
      distanceGroups.set(band, []);
    }
    distanceGroups.get(band)!.push(position);
  });

  let bestDistance = 1600;
  let bestAvg = 99;
  distanceGroups.forEach((positions, distance) => {
    const avg = positions.reduce((sum, p) => sum + p, 0) / positions.length;
    if (avg < bestAvg) {
      bestAvg = avg;
      bestDistance = distance;
    }
  });

  // Preferred going (where horse wins most)
  const goingWins = new Map<number, number>();
  const goingRuns = new Map<number, number>();

  history.forEach(({ horse, race }) => {
    const going = encodeGoing(race.going);
    goingRuns.set(going, (goingRuns.get(going) || 0) + 1);
    if (horse.position === 1) {
      goingWins.set(going, (goingWins.get(going) || 0) + 1);
    }
  });

  let preferredGoing = 4; // Default to good
  let bestWinRate = 0;
  goingRuns.forEach((runs, going) => {
    const wins = goingWins.get(going) || 0;
    const winRate = wins / runs;
    if (winRate > bestWinRate && runs >= 2) {
      bestWinRate = winRate;
      preferredGoing = going;
    }
  });

  // Average days between runs
  const sortedByDate = [...history].sort((a, b) => {
    const dateA = new Date(a.race.date);
    const dateB = new Date(b.race.date);
    return dateA.getTime() - dateB.getTime();
  });

  const dayGaps: number[] = [];
  for (let i = 1; i < sortedByDate.length; i++) {
    const prevDate = new Date(sortedByDate[i - 1].race.date);
    const currDate = new Date(sortedByDate[i].race.date);
    const diffDays = Math.floor(
      (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diffDays > 0 && diffDays < 365) {
      dayGaps.push(diffDays);
    }
  }

  const avgDaysBetween =
    dayGaps.length > 0
      ? dayGaps.reduce((sum, d) => sum + d, 0) / dayGaps.length
      : 30;

  return {
    total_prize_money: totalPrize,
    best_distance_meters: bestDistance,
    preferred_going: preferredGoing,
    avg_days_between_runs: avgDaysBetween,
  };
}

/**
 * Helper function to parse prize amount from string
 */
function parsePrizeAmount(prize: string): number {
  if (!prize) return 0;
  const cleaned = prize.replace(/[£$€,]/g, "").trim();
  const amount = Number.parseFloat(cleaned);
  return Number.isNaN(amount) ? 0 : amount;
}

/**
 * Helper function to encode going condition
 */
function encodeGoing(going: string | null): number {
  if (!going) return 4; // Default to good

  const goingMap: Record<string, number> = {
    hard: 1,
    fast: 2,
    firm: 3,
    good: 4,
    "good to firm": 5,
    "good to yielding": 6,
    "yielding to soft": 7,
    yielding: 8,
    "good to soft": 9,
    "standard to slow": 10,
    standard: 11,
    "soft heavy": 12,
    heavy: 13,
    soft: 14,
  };

  const normalized = going.toLowerCase().trim();
  return goingMap[normalized] || 4;
}

/**
 * Get empty historical features for horses with no history
 */
function getEmptyHistoricalFeatures(): HistoricalFeatures {
  return {
    career_runs: 0,
    career_wins: 0,
    career_places: 0,
    career_win_rate: 0,
    career_place_rate: 0,
    career_avg_position: 10,
    career_position_std: 0,
    course_runs: 0,
    course_wins: 0,
    course_win_rate: 0,
    distance_band_runs: 0,
    distance_band_wins: 0,
    distance_band_win_rate: 0,
    going_runs: 0,
    going_wins: 0,
    going_win_rate: 0,
    class_runs: 0,
    class_wins: 0,
    class_win_rate: 0,
    recent_runs_30d: 0,
    recent_wins_30d: 0,
    recent_runs_90d: 0,
    recent_wins_90d: 0,
    recent_avg_position: 10,
    improvement_rate: 0,
    consistency_score: 0,
    peak_or_rating: 0,
    avg_or_rating: 0,
    total_prize_money: 0,
    best_distance_meters: 0,
    preferred_going: 0,
    avg_days_between_runs: 30,
  };
}

/**
 * Calculate statistics for a subset of runs
 */
export function calculateRunStatistics(runs: RaceHorseEnriched[]): {
  total: number;
  wins: number;
  places: number;
  winRate: number;
  placeRate: number;
  avgPosition: number;
} {
  const total = runs.length;
  const wins = runs.filter((r) => r.position === 1).length;
  const places = runs.filter((r) => r.position && r.position <= 3).length;

  const positions = runs
    .map((r) => r.position)
    .filter((p) => p !== null && p > 0) as number[];

  const avgPosition =
    positions.length > 0
      ? positions.reduce((sum, p) => sum + p, 0) / positions.length
      : 10;

  return {
    total,
    wins,
    places,
    winRate: total > 0 ? wins / total : 0,
    placeRate: total > 0 ? places / total : 0,
    avgPosition,
  };
}

/**
 * Helper function to calculate average position
 */
function calculateAveragePosition(runs: RaceHorseEnriched[]): number {
  const positions = runs
    .map((r) => r.position)
    .filter((p) => p !== null && p > 0) as number[];

  return positions.length > 0
    ? positions.reduce((sum, p) => sum + p, 0) / positions.length
    : 10;
}

/**
 * Helper function to calculate standard deviation
 */
function calculateStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / values.length;

  return Math.sqrt(variance);
}

/**
 * Validate historical features
 */
export function validateHistoricalFeatures(features: HistoricalFeatures): {
  isValid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Check for new horse (no history)
  if (features.career_runs === 0) {
    warnings.push("No historical runs - new horse");
  }

  // Check for limited history
  if (features.career_runs < 3) {
    warnings.push("Limited historical data");
  }

  // Check for inconsistent data
  if (features.career_wins > features.career_runs) {
    warnings.push("Invalid data: wins exceed runs");
  }

  // Check win rates
  if (features.career_win_rate > 0.5) {
    warnings.push("Unusually high win rate");
  }

  // Check position average
  if (features.career_avg_position > 15) {
    warnings.push("Very poor average position");
  }

  return {
    isValid: warnings.length === 0,
    warnings,
  };
}

/**
 * Get feature importance for historical features
 */
export function getHistoricalFeatureImportance(): Record<string, number> {
  return {
    // High importance
    career_win_rate: 0.95,
    career_place_rate: 0.85,
    recent_avg_position: 0.9,
    consistency_score: 0.85,

    // Medium-high importance
    career_avg_position: 0.75,
    distance_band_win_rate: 0.8,
    course_win_rate: 0.75,
    improvement_rate: 0.7,

    // Medium importance
    career_runs: 0.6,
    recent_wins_90d: 0.65,
    going_win_rate: 0.6,
    class_win_rate: 0.65,

    // Lower importance
    career_position_std: 0.5,
    avg_days_between_runs: 0.45,
    total_prize_money: 0.4,
    peak_or_rating: 0.55,
    avg_or_rating: 0.6,
  };
}
