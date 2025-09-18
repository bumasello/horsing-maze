// features_v4/features/relationship.features.ts

import type { RaceCardEnriched, RaceHorseEnriched } from "../types/core.types";

/**
 * Interface for historical race data combining horse and race info
 */
export interface HistoricalRaceData {
  horse: RaceHorseEnriched;
  race: RaceCardEnriched;
}

/**
 * Interface for jockey/trainer relationship features
 */
export interface RelationshipFeatures {
  // Jockey performance
  jockey_win_rate: number;
  jockey_place_rate: number;
  jockey_recent_form: number;
  jockey_course_win_rate: number;
  jockey_distance_win_rate: number;
  jockey_total_runs: number;

  // Trainer performance
  trainer_win_rate: number;
  trainer_place_rate: number;
  trainer_recent_form: number;
  trainer_course_win_rate: number;
  trainer_distance_win_rate: number;
  trainer_total_runs: number;

  // Horse-Jockey combination
  jockey_with_horse_runs: number;
  jockey_with_horse_wins: number;
  jockey_with_horse_win_rate: number;
  jockey_with_horse_place_rate: number;

  // Horse-Trainer combination
  trainer_with_horse_runs: number;
  trainer_with_horse_wins: number;
  trainer_with_horse_win_rate: number;
  trainer_with_horse_place_rate: number;

  // Jockey-Trainer combination
  jockey_trainer_combo_runs: number;
  jockey_trainer_combo_wins: number;
  jockey_trainer_combo_win_rate: number;
  jockey_trainer_combo_place_rate: number;

  // Owner stats
  owner_win_rate: number;
  owner_with_trainer_win_rate: number;
  owner_total_runners: number;

  // Sire/Dam lineage
  sire_win_rate: number;
  sire_distance_suitability: number;
  dam_produce_win_rate: number;

  // Relationship strength indicators
  stable_confidence: number;
  jockey_reliability: number;
  partnership_strength: number;
}

/**
 * Extract relationship features from historical data
 */
export function extractRelationshipFeatures(
  currentHorse: RaceHorseEnriched,
  allHistoricalData: HistoricalRaceData[],
  currentCourse: string,
  currentDistanceMeters: number,
): RelationshipFeatures {
  // Extract jockey features
  const jockeyFeatures = calculateJockeyFeatures(
    currentHorse.jockey,
    allHistoricalData,
    currentCourse,
    currentDistanceMeters,
  );

  // Extract trainer features
  const trainerFeatures = calculateTrainerFeatures(
    currentHorse.trainer,
    allHistoricalData,
    currentCourse,
    currentDistanceMeters,
  );

  // Calculate horse-human combinations
  const combinationFeatures = calculateCombinationFeatures(
    currentHorse,
    allHistoricalData,
  );

  // Calculate owner features
  const ownerFeatures = calculateOwnerFeatures(
    currentHorse.owner,
    currentHorse.trainer,
    allHistoricalData,
  );

  // Calculate lineage features
  const lineageFeatures = calculateLineageFeatures(
    currentHorse.sire,
    currentHorse.dam,
    allHistoricalData,
    currentDistanceMeters,
  );

  // Calculate relationship strength indicators
  const strengthIndicators = calculateRelationshipStrength(
    jockeyFeatures,
    trainerFeatures,
    combinationFeatures,
  );

  // Combine all features ensuring all fields are present
  return {
    // Jockey features
    jockey_win_rate: jockeyFeatures.jockey_win_rate,
    jockey_place_rate: jockeyFeatures.jockey_place_rate,
    jockey_recent_form: jockeyFeatures.jockey_recent_form,
    jockey_course_win_rate: jockeyFeatures.jockey_course_win_rate,
    jockey_distance_win_rate: jockeyFeatures.jockey_distance_win_rate,
    jockey_total_runs: jockeyFeatures.jockey_total_runs,

    // Trainer features
    trainer_win_rate: trainerFeatures.trainer_win_rate,
    trainer_place_rate: trainerFeatures.trainer_place_rate,
    trainer_recent_form: trainerFeatures.trainer_recent_form,
    trainer_course_win_rate: trainerFeatures.trainer_course_win_rate,
    trainer_distance_win_rate: trainerFeatures.trainer_distance_win_rate,
    trainer_total_runs: trainerFeatures.trainer_total_runs,

    // Combination features
    jockey_with_horse_runs: combinationFeatures.jockey_with_horse_runs,
    jockey_with_horse_wins: combinationFeatures.jockey_with_horse_wins,
    jockey_with_horse_win_rate: combinationFeatures.jockey_with_horse_win_rate,
    jockey_with_horse_place_rate:
      combinationFeatures.jockey_with_horse_place_rate,
    trainer_with_horse_runs: combinationFeatures.trainer_with_horse_runs,
    trainer_with_horse_wins: combinationFeatures.trainer_with_horse_wins,
    trainer_with_horse_win_rate:
      combinationFeatures.trainer_with_horse_win_rate,
    trainer_with_horse_place_rate:
      combinationFeatures.trainer_with_horse_place_rate,
    jockey_trainer_combo_runs: combinationFeatures.jockey_trainer_combo_runs,
    jockey_trainer_combo_wins: combinationFeatures.jockey_trainer_combo_wins,
    jockey_trainer_combo_win_rate:
      combinationFeatures.jockey_trainer_combo_win_rate,
    jockey_trainer_combo_place_rate:
      combinationFeatures.jockey_trainer_combo_place_rate,

    // Owner features
    owner_win_rate: ownerFeatures.owner_win_rate,
    owner_with_trainer_win_rate: ownerFeatures.owner_with_trainer_win_rate,
    owner_total_runners: ownerFeatures.owner_total_runners,

    // Lineage features
    sire_win_rate: lineageFeatures.sire_win_rate,
    sire_distance_suitability: lineageFeatures.sire_distance_suitability,
    dam_produce_win_rate: lineageFeatures.dam_produce_win_rate,

    // Strength indicators
    stable_confidence: strengthIndicators.stable_confidence,
    jockey_reliability: strengthIndicators.jockey_reliability,
    partnership_strength: strengthIndicators.partnership_strength,
  };
}

/**
 * Calculate jockey performance features
 */
function calculateJockeyFeatures(
  jockeyName: string | null,
  allHistory: HistoricalRaceData[],
  currentCourse: string,
  currentDistanceMeters: number,
): {
  jockey_win_rate: number;
  jockey_place_rate: number;
  jockey_recent_form: number;
  jockey_course_win_rate: number;
  jockey_distance_win_rate: number;
  jockey_total_runs: number;
} {
  if (!jockeyName) {
    return {
      jockey_win_rate: 0,
      jockey_place_rate: 0,
      jockey_recent_form: 0,
      jockey_course_win_rate: 0,
      jockey_distance_win_rate: 0,
      jockey_total_runs: 0,
    };
  }

  // Filter all rides by this jockey
  const jockeyRides = allHistory.filter(
    ({ horse }) =>
      horse.jockey === jockeyName &&
      horse.position !== null &&
      horse.position > 0,
  );

  if (jockeyRides.length === 0) {
    return {
      jockey_win_rate: 0,
      jockey_place_rate: 0,
      jockey_recent_form: 0,
      jockey_course_win_rate: 0,
      jockey_distance_win_rate: 0,
      jockey_total_runs: 0,
    };
  }

  // Overall performance
  const wins = jockeyRides.filter(({ horse }) => horse.position === 1).length;
  const places = jockeyRides.filter(
    ({ horse }) => horse.position && horse.position <= 3,
  ).length;
  const winRate = wins / jockeyRides.length;
  const placeRate = places / jockeyRides.length;

  // Recent form (last 20 rides)
  const recentRides = jockeyRides
    .sort(
      (a, b) =>
        new Date(b.race.date).getTime() - new Date(a.race.date).getTime(),
    )
    .slice(0, 20);
  const recentWins = recentRides.filter(
    ({ horse }) => horse.position === 1,
  ).length;
  const recentForm =
    recentRides.length > 0 ? recentWins / recentRides.length : 0;

  // Course-specific
  const courseRides = jockeyRides.filter(
    ({ race }) => race.course === currentCourse,
  );
  const courseWinRate =
    courseRides.length > 0
      ? courseRides.filter(({ horse }) => horse.position === 1).length /
        courseRides.length
      : winRate; // Fallback to overall rate

  // Distance-specific (within 15% of current distance)
  const distanceRides = jockeyRides.filter(({ race }) => {
    const raceDistance = parseDistanceToMeters(race.distance);
    return (
      Math.abs(raceDistance - currentDistanceMeters) / currentDistanceMeters <=
      0.15
    );
  });
  const distanceWinRate =
    distanceRides.length > 0
      ? distanceRides.filter(({ horse }) => horse.position === 1).length /
        distanceRides.length
      : winRate; // Fallback to overall rate

  return {
    jockey_win_rate: winRate,
    jockey_place_rate: placeRate,
    jockey_recent_form: recentForm,
    jockey_course_win_rate: courseWinRate,
    jockey_distance_win_rate: distanceWinRate,
    jockey_total_runs: jockeyRides.length,
  };
}

/**
 * Calculate trainer performance features
 */
function calculateTrainerFeatures(
  trainerName: string,
  allHistory: HistoricalRaceData[],
  currentCourse: string,
  currentDistanceMeters: number,
): {
  trainer_win_rate: number;
  trainer_place_rate: number;
  trainer_recent_form: number;
  trainer_course_win_rate: number;
  trainer_distance_win_rate: number;
  trainer_total_runs: number;
} {
  // Filter all horses trained by this trainer
  const trainerHorses = allHistory.filter(
    ({ horse }) =>
      horse.trainer === trainerName &&
      horse.position !== null &&
      horse.position > 0,
  );

  if (trainerHorses.length === 0) {
    return {
      trainer_win_rate: 0,
      trainer_place_rate: 0,
      trainer_recent_form: 0,
      trainer_course_win_rate: 0,
      trainer_distance_win_rate: 0,
      trainer_total_runs: 0,
    };
  }

  // Overall performance
  const wins = trainerHorses.filter(({ horse }) => horse.position === 1).length;
  const places = trainerHorses.filter(
    ({ horse }) => horse.position && horse.position <= 3,
  ).length;
  const winRate = wins / trainerHorses.length;
  const placeRate = places / trainerHorses.length;

  // Recent form (last 30 runners)
  const recentRunners = trainerHorses
    .sort(
      (a, b) =>
        new Date(b.race.date).getTime() - new Date(a.race.date).getTime(),
    )
    .slice(0, 30);
  const recentWins = recentRunners.filter(
    ({ horse }) => horse.position === 1,
  ).length;
  const recentForm =
    recentRunners.length > 0 ? recentWins / recentRunners.length : 0;

  // Course-specific
  const courseRunners = trainerHorses.filter(
    ({ race }) => race.course === currentCourse,
  );
  const courseWinRate =
    courseRunners.length > 0
      ? courseRunners.filter(({ horse }) => horse.position === 1).length /
        courseRunners.length
      : winRate;

  // Distance-specific
  const distanceRunners = trainerHorses.filter(({ race }) => {
    const raceDistance = parseDistanceToMeters(race.distance);
    return (
      Math.abs(raceDistance - currentDistanceMeters) / currentDistanceMeters <=
      0.15
    );
  });
  const distanceWinRate =
    distanceRunners.length > 0
      ? distanceRunners.filter(({ horse }) => horse.position === 1).length /
        distanceRunners.length
      : winRate;

  return {
    trainer_win_rate: winRate,
    trainer_place_rate: placeRate,
    trainer_recent_form: recentForm,
    trainer_course_win_rate: courseWinRate,
    trainer_distance_win_rate: distanceWinRate,
    trainer_total_runs: trainerHorses.length,
  };
}

/**
 * Calculate combination features
 */
function calculateCombinationFeatures(
  currentHorse: RaceHorseEnriched,
  allHistory: HistoricalRaceData[],
): {
  jockey_with_horse_runs: number;
  jockey_with_horse_wins: number;
  jockey_with_horse_win_rate: number;
  jockey_with_horse_place_rate: number;
  trainer_with_horse_runs: number;
  trainer_with_horse_wins: number;
  trainer_with_horse_win_rate: number;
  trainer_with_horse_place_rate: number;
  jockey_trainer_combo_runs: number;
  jockey_trainer_combo_wins: number;
  jockey_trainer_combo_win_rate: number;
  jockey_trainer_combo_place_rate: number;
} {
  // Horse-Jockey combination
  const horseJockeyRuns = allHistory.filter(
    ({ horse }) =>
      horse.id_horse === currentHorse.id_horse &&
      horse.jockey === currentHorse.jockey &&
      horse.position !== null &&
      horse.position > 0,
  );

  const hjWins = horseJockeyRuns.filter(
    ({ horse }) => horse.position === 1,
  ).length;
  const hjPlaces = horseJockeyRuns.filter(
    ({ horse }) => horse.position && horse.position <= 3,
  ).length;

  // Horse-Trainer combination
  const horseTrainerRuns = allHistory.filter(
    ({ horse }) =>
      horse.id_horse === currentHorse.id_horse &&
      horse.trainer === currentHorse.trainer &&
      horse.position !== null &&
      horse.position > 0,
  );

  const htWins = horseTrainerRuns.filter(
    ({ horse }) => horse.position === 1,
  ).length;
  const htPlaces = horseTrainerRuns.filter(
    ({ horse }) => horse.position && horse.position <= 3,
  ).length;

  // Jockey-Trainer combination (any horse)
  const jockeyTrainerRuns = allHistory.filter(
    ({ horse }) =>
      horse.jockey === currentHorse.jockey &&
      horse.trainer === currentHorse.trainer &&
      horse.position !== null &&
      horse.position > 0,
  );

  const jtWins = jockeyTrainerRuns.filter(
    ({ horse }) => horse.position === 1,
  ).length;
  const jtPlaces = jockeyTrainerRuns.filter(
    ({ horse }) => horse.position && horse.position <= 3,
  ).length;

  return {
    jockey_with_horse_runs: horseJockeyRuns.length,
    jockey_with_horse_wins: hjWins,
    jockey_with_horse_win_rate:
      horseJockeyRuns.length > 0 ? hjWins / horseJockeyRuns.length : 0,
    jockey_with_horse_place_rate:
      horseJockeyRuns.length > 0 ? hjPlaces / horseJockeyRuns.length : 0,

    trainer_with_horse_runs: horseTrainerRuns.length,
    trainer_with_horse_wins: htWins,
    trainer_with_horse_win_rate:
      horseTrainerRuns.length > 0 ? htWins / horseTrainerRuns.length : 0,
    trainer_with_horse_place_rate:
      horseTrainerRuns.length > 0 ? htPlaces / horseTrainerRuns.length : 0,

    jockey_trainer_combo_runs: jockeyTrainerRuns.length,
    jockey_trainer_combo_wins: jtWins,
    jockey_trainer_combo_win_rate:
      jockeyTrainerRuns.length > 0 ? jtWins / jockeyTrainerRuns.length : 0,
    jockey_trainer_combo_place_rate:
      jockeyTrainerRuns.length > 0 ? jtPlaces / jockeyTrainerRuns.length : 0,
  };
}

/**
 * Calculate owner features
 */
function calculateOwnerFeatures(
  ownerName: string | null,
  trainerName: string,
  allHistory: HistoricalRaceData[],
): {
  owner_win_rate: number;
  owner_with_trainer_win_rate: number;
  owner_total_runners: number;
} {
  if (!ownerName) {
    return {
      owner_win_rate: 0,
      owner_with_trainer_win_rate: 0,
      owner_total_runners: 0,
    };
  }

  // All horses owned by this owner
  const ownerHorses = allHistory.filter(
    ({ horse }) =>
      horse.owner === ownerName &&
      horse.position !== null &&
      horse.position > 0,
  );

  const ownerWins = ownerHorses.filter(
    ({ horse }) => horse.position === 1,
  ).length;
  const ownerWinRate =
    ownerHorses.length > 0 ? ownerWins / ownerHorses.length : 0;

  // Owner-Trainer combination
  const ownerTrainerHorses = ownerHorses.filter(
    ({ horse }) => horse.trainer === trainerName,
  );
  const otWins = ownerTrainerHorses.filter(
    ({ horse }) => horse.position === 1,
  ).length;
  const otWinRate =
    ownerTrainerHorses.length > 0 ? otWins / ownerTrainerHorses.length : 0;

  return {
    owner_win_rate: ownerWinRate,
    owner_with_trainer_win_rate: otWinRate,
    owner_total_runners: ownerHorses.length,
  };
}

/**
 * Calculate lineage features
 */
function calculateLineageFeatures(
  sireName: string | null,
  damName: string | null,
  allHistory: HistoricalRaceData[],
  currentDistanceMeters: number,
): {
  sire_win_rate: number;
  sire_distance_suitability: number;
  dam_produce_win_rate: number;
} {
  // Sire statistics
  let sireWinRate = 0;
  let sireDistanceSuitability = 0.5; // Default neutral

  if (sireName) {
    const sireProgeny = allHistory.filter(
      ({ horse }) =>
        horse.sire === sireName &&
        horse.position !== null &&
        horse.position > 0,
    );

    if (sireProgeny.length > 0) {
      const sireWins = sireProgeny.filter(
        ({ horse }) => horse.position === 1,
      ).length;
      sireWinRate = sireWins / sireProgeny.length;

      // Distance suitability based on progeny performance at similar distances
      const distanceProgeny = sireProgeny.filter(({ race }) => {
        const raceDistance = parseDistanceToMeters(race.distance);
        return (
          Math.abs(raceDistance - currentDistanceMeters) /
            currentDistanceMeters <=
          0.15
        );
      });

      if (distanceProgeny.length > 0) {
        const distanceWins = distanceProgeny.filter(
          ({ horse }) => horse.position === 1,
        ).length;
        sireDistanceSuitability = distanceWins / distanceProgeny.length;
      }
    }
  }

  // Dam produce statistics
  let damProduceWinRate = 0;

  if (damName) {
    const damProgeny = allHistory.filter(
      ({ horse }) =>
        horse.dam === damName && horse.position !== null && horse.position > 0,
    );

    if (damProgeny.length > 0) {
      const damWins = damProgeny.filter(
        ({ horse }) => horse.position === 1,
      ).length;
      damProduceWinRate = damWins / damProgeny.length;
    }
  }

  return {
    sire_win_rate: sireWinRate,
    sire_distance_suitability: sireDistanceSuitability,
    dam_produce_win_rate: damProduceWinRate,
  };
}

/**
 * Calculate relationship strength indicators
 */
function calculateRelationshipStrength(
  jockeyFeatures: {
    jockey_win_rate: number;
    jockey_total_runs: number;
    jockey_recent_form: number;
  },
  trainerFeatures: {
    trainer_win_rate: number;
    trainer_recent_form: number;
  },
  combinationFeatures: {
    jockey_trainer_combo_runs: number;
    jockey_trainer_combo_win_rate: number;
  },
): {
  stable_confidence: number;
  jockey_reliability: number;
  partnership_strength: number;
} {
  // Stable confidence (trainer's recent form and consistency)
  const stableConfidence =
    trainerFeatures.trainer_recent_form * 0.6 +
    trainerFeatures.trainer_win_rate * 0.4;

  // Jockey reliability (consistency and experience)
  const jockeyReliability = jockeyFeatures.jockey_total_runs
    ? Math.min(
        1,
        (jockeyFeatures.jockey_total_runs / 100) * 0.3 +
          jockeyFeatures.jockey_win_rate * 0.4 +
          jockeyFeatures.jockey_recent_form * 0.3,
      )
    : 0;

  // Partnership strength (how well they work together)
  const hasPartnership = combinationFeatures.jockey_trainer_combo_runs >= 10;
  const partnershipSuccess = combinationFeatures.jockey_trainer_combo_win_rate;
  const partnershipStrength = hasPartnership ? partnershipSuccess : 0.5; // Neutral if limited data

  return {
    stable_confidence: stableConfidence,
    jockey_reliability: jockeyReliability,
    partnership_strength: partnershipStrength,
  };
}

/**
 * Helper function to parse distance to meters
 * (Simplified version - should import from distance.converter.ts)
 */
function parseDistanceToMeters(distance: string): number {
  // This is a simplified implementation
  // In production, import from '../converters/distance.converter'
  const clean = distance.toLowerCase().trim();

  // Try to extract a number
  const match = clean.match(/(\d+)/);
  if (match) {
    const value = Number.parseInt(match[1]);
    // Assume meters if > 1000, yards otherwise
    return value > 1000 ? value : value * 0.9144;
  }

  return 1600; // Default to about a mile
}

/**
 * Analyze relationship dynamics
 */
export function analyzeRelationshipDynamics(features: RelationshipFeatures): {
  teamStrength: "excellent" | "good" | "average" | "below_average" | "poor";
  keyStrengths: string[];
  keyWeaknesses: string[];
  confidence: number;
} {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  let score = 0;

  // Evaluate jockey
  if (features.jockey_win_rate > 0.15) {
    strengths.push("Strong jockey record");
    score += 2;
  } else if (features.jockey_win_rate < 0.08) {
    weaknesses.push("Weak jockey record");
    score -= 1;
  }

  // Evaluate trainer
  if (features.trainer_win_rate > 0.15) {
    strengths.push("Successful trainer");
    score += 2;
  } else if (features.trainer_win_rate < 0.08) {
    weaknesses.push("Struggling trainer");
    score -= 1;
  }

  // Evaluate combinations
  if (
    features.jockey_trainer_combo_runs >= 20 &&
    features.jockey_trainer_combo_win_rate > 0.2
  ) {
    strengths.push("Proven jockey-trainer partnership");
    score += 3;
  }

  if (
    features.jockey_with_horse_runs >= 3 &&
    features.jockey_with_horse_win_rate > 0.3
  ) {
    strengths.push("Successful horse-jockey combination");
    score += 2;
  }

  // Evaluate recent form
  if (features.jockey_recent_form > features.jockey_win_rate * 1.2) {
    strengths.push("Jockey in good form");
    score += 1;
  } else if (features.jockey_recent_form < features.jockey_win_rate * 0.5) {
    weaknesses.push("Jockey out of form");
    score -= 1;
  }

  // Determine team strength
  let teamStrength: "excellent" | "good" | "average" | "below_average" | "poor";
  if (score >= 6) teamStrength = "excellent";
  else if (score >= 3) teamStrength = "good";
  else if (score >= 0) teamStrength = "average";
  else if (score >= -2) teamStrength = "below_average";
  else teamStrength = "poor";

  // Calculate confidence
  const dataPoints =
    features.jockey_total_runs +
    features.trainer_total_runs +
    features.jockey_trainer_combo_runs;
  const confidence = Math.min(1, dataPoints / 200);

  return {
    teamStrength,
    keyStrengths: strengths,
    keyWeaknesses: weaknesses,
    confidence,
  };
}

/**
 * Validate relationship features
 */
export function validateRelationshipFeatures(features: RelationshipFeatures): {
  isValid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Check win rates
  const winRates = [
    features.jockey_win_rate,
    features.trainer_win_rate,
    features.jockey_with_horse_win_rate,
    features.trainer_with_horse_win_rate,
    features.jockey_trainer_combo_win_rate,
  ];

  for (const rate of winRates) {
    if (rate < 0 || rate > 1) {
      issues.push("Invalid win rate detected");
      break;
    }
  }

  // Check logical consistency
  if (features.jockey_with_horse_wins > features.jockey_with_horse_runs) {
    issues.push("Horse-jockey wins exceed runs");
  }

  if (features.trainer_with_horse_wins > features.trainer_with_horse_runs) {
    issues.push("Horse-trainer wins exceed runs");
  }

  if (features.jockey_trainer_combo_wins > features.jockey_trainer_combo_runs) {
    issues.push("Jockey-trainer wins exceed runs");
  }

  // Check for missing critical data
  if (features.trainer_total_runs === 0) {
    issues.push("No trainer history available");
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

/**
 * Get feature importance for relationship features
 */
export function getRelationshipFeatureImportance(): Record<string, number> {
  return {
    // High importance
    trainer_win_rate: 0.85,
    jockey_win_rate: 0.8,
    jockey_trainer_combo_win_rate: 0.75,
    trainer_recent_form: 0.8,

    // Medium-high importance
    jockey_recent_form: 0.7,
    trainer_course_win_rate: 0.7,
    jockey_course_win_rate: 0.65,
    jockey_with_horse_win_rate: 0.7,

    // Medium importance
    trainer_with_horse_win_rate: 0.6,
    partnership_strength: 0.6,
    stable_confidence: 0.55,
    jockey_reliability: 0.55,

    // Lower importance
    owner_win_rate: 0.45,
    sire_win_rate: 0.5,
    sire_distance_suitability: 0.45,
    dam_produce_win_rate: 0.4,
    owner_with_trainer_win_rate: 0.4,

    // Data volume indicators
    jockey_total_runs: 0.3,
    trainer_total_runs: 0.3,
    jockey_trainer_combo_runs: 0.35,
  };
}
