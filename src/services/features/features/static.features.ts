// features_v4/features/static.features.ts

import type {
  ProcessedHorse,
  ProcessedRace,
  RaceHorseEnriched,
} from "../types/core.types";

/**
 * Interface for static features - features that don't change based on history
 */
export interface StaticFeatures {
  // Horse attributes
  horse_age: number | null;
  horse_weight_kg: number | null;
  days_since_last_run: number;

  // Race attributes
  race_distance_meters: number;
  race_going_encoded: number;
  race_class: number | null;
  race_field_size: number;
  race_total_prize: number;

  // Additional static features
  horse_number: number | null;
  is_non_runner: boolean;
  has_valid_weight: boolean;
  has_valid_sp: boolean;
}

/**
 * Extract static features from horse and race data
 * These are features that are fixed for this specific race/horse combination
 */
export function extractStaticFeatures(
  race: ProcessedRace,
  horse: ProcessedHorse,
  rawHorse: RaceHorseEnriched,
): StaticFeatures {
  // Validate and set days since last run
  const daysSinceLastRun = rawHorse.last_ran_days_ago ?? 999;

  // Validate weight
  const hasValidWeight =
    horse.weight_kg !== null && horse.weight_kg > 40 && horse.weight_kg < 80;

  // Validate SP
  const hasValidSP =
    horse.sp_decimal !== null &&
    horse.sp_decimal > 0 &&
    horse.sp_decimal < 1000;

  return {
    // Horse attributes
    horse_age: rawHorse.age,
    horse_weight_kg: horse.weight_kg,
    days_since_last_run: Math.min(daysSinceLastRun, 999), // Cap at 999

    // Race attributes
    race_distance_meters: race.distance_meters,
    race_going_encoded: race.going_encoded,
    race_class: race.race_class,
    race_field_size: race.total_runners,
    race_total_prize: race.total_prize_numeric,

    // Additional features
    horse_number: rawHorse.number,
    is_non_runner: rawHorse.non_runner === 1,
    has_valid_weight: hasValidWeight,
    has_valid_sp: hasValidSP,
  };
}

/**
 * Calculate derived static features
 */
export function calculateDerivedStaticFeatures(
  staticFeatures: StaticFeatures,
): Record<string, number> {
  const derived: Record<string, number> = {};

  // Age categories
  derived.is_juvenile = staticFeatures.horse_age === 2 ? 1 : 0;
  derived.is_3yo = staticFeatures.horse_age === 3 ? 1 : 0;
  derived.is_mature =
    staticFeatures.horse_age !== null && staticFeatures.horse_age >= 4 ? 1 : 0;

  // Weight categories
  if (staticFeatures.horse_weight_kg !== null) {
    derived.is_lightweight = staticFeatures.horse_weight_kg < 55 ? 1 : 0;
    derived.is_heavyweight = staticFeatures.horse_weight_kg > 65 ? 1 : 0;
  }

  // Rest categories
  derived.is_fresh = staticFeatures.days_since_last_run > 60 ? 1 : 0;
  derived.is_quick_backup = staticFeatures.days_since_last_run < 14 ? 1 : 0;
  derived.is_normal_rest =
    staticFeatures.days_since_last_run >= 14 &&
    staticFeatures.days_since_last_run <= 60
      ? 1
      : 0;

  // Field size categories
  derived.is_small_field = staticFeatures.race_field_size < 8 ? 1 : 0;
  derived.is_large_field = staticFeatures.race_field_size > 14 ? 1 : 0;

  // Distance categories (using numeric encoding)
  derived.is_sprint = staticFeatures.race_distance_meters < 1200 ? 1 : 0;
  derived.is_mile =
    staticFeatures.race_distance_meters >= 1200 &&
    staticFeatures.race_distance_meters < 1800
      ? 1
      : 0;
  derived.is_middle_distance =
    staticFeatures.race_distance_meters >= 1800 &&
    staticFeatures.race_distance_meters < 2400
      ? 1
      : 0;
  derived.is_long_distance =
    staticFeatures.race_distance_meters >= 2400 ? 1 : 0;

  // Going categories (simplified)
  derived.is_firm_ground = staticFeatures.race_going_encoded <= 5 ? 1 : 0;
  derived.is_good_ground =
    staticFeatures.race_going_encoded > 5 &&
    staticFeatures.race_going_encoded <= 9
      ? 1
      : 0;
  derived.is_soft_ground = staticFeatures.race_going_encoded > 9 ? 1 : 0;

  // Class categories
  if (staticFeatures.race_class !== null) {
    derived.is_high_class = staticFeatures.race_class <= 3 ? 1 : 0;
    derived.is_mid_class =
      staticFeatures.race_class > 3 && staticFeatures.race_class <= 5 ? 1 : 0;
    derived.is_low_class = staticFeatures.race_class > 5 ? 1 : 0;
  }

  return derived;
}

/**
 * Validate static features for quality
 */
export function validateStaticFeatures(features: StaticFeatures): {
  isValid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Check horse age
  if (
    features.horse_age === null ||
    features.horse_age < 2 ||
    features.horse_age > 15
  ) {
    issues.push("Invalid horse age");
  }

  // Check weight
  if (!features.has_valid_weight) {
    issues.push("Invalid or missing weight");
  }

  // Check days since last run
  if (features.days_since_last_run === 999) {
    issues.push("No previous run data");
  }

  // Check race distance
  if (features.race_distance_meters === 0) {
    issues.push("Invalid race distance");
  }

  // Check field size
  if (features.race_field_size < 2) {
    issues.push("Field too small");
  }

  // Check if non-runner
  if (features.is_non_runner) {
    issues.push("Horse is a non-runner");
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

/**
 * Get feature importance weights for static features
 * Used for feature selection and model interpretation
 */
export function getStaticFeatureImportance(): Record<string, number> {
  return {
    horse_age: 0.7,
    horse_weight_kg: 0.6,
    days_since_last_run: 0.8,
    race_distance_meters: 0.9,
    race_going_encoded: 0.7,
    race_class: 0.85,
    race_field_size: 0.5,
    race_total_prize: 0.4,
    horse_number: 0.1,
    is_non_runner: 1.0, // Critical - should exclude
    has_valid_weight: 0.3,
    has_valid_sp: 0.4,
  };
}

/**
 * Normalize static features for ML models
 */
export function normalizeStaticFeatures(
  features: StaticFeatures,
  normalizationParams?: {
    age_mean?: number;
    age_std?: number;
    weight_mean?: number;
    weight_std?: number;
    distance_mean?: number;
    distance_std?: number;
  },
): StaticFeatures {
  // Default normalization parameters
  const params = {
    age_mean: normalizationParams?.age_mean ?? 5,
    age_std: normalizationParams?.age_std ?? 2,
    weight_mean: normalizationParams?.weight_mean ?? 58,
    weight_std: normalizationParams?.weight_std ?? 5,
    distance_mean: normalizationParams?.distance_mean ?? 1600,
    distance_std: normalizationParams?.distance_std ?? 400,
  };

  // Create normalized copy
  const normalized: StaticFeatures = { ...features };

  // Normalize age
  if (features.horse_age !== null) {
    normalized.horse_age =
      (features.horse_age - params.age_mean) / params.age_std;
  }

  // Normalize weight
  if (features.horse_weight_kg !== null) {
    normalized.horse_weight_kg =
      (features.horse_weight_kg - params.weight_mean) / params.weight_std;
  }

  // Normalize distance
  normalized.race_distance_meters =
    (features.race_distance_meters - params.distance_mean) /
    params.distance_std;

  // Days since last run - log transform for skewed distribution
  normalized.days_since_last_run =
    Math.log1p(features.days_since_last_run) / Math.log1p(100);

  // Field size - simple scaling
  normalized.race_field_size = features.race_field_size / 20;

  // Prize money - log transform
  normalized.race_total_prize =
    Math.log1p(features.race_total_prize) / Math.log1p(100000);

  return normalized;
}
