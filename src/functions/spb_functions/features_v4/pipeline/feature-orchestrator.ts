// features_v4/pipeline/feature-orchestrator.ts

import type {
  HorseFeatures,
  ProcessedHorse,
  ProcessedRace,
  QualityThresholds,
  RaceCardEnriched,
  RaceHorseEnriched,
  ValidationResult,
} from "../types/core.types";
import { extractCompetitiveFeatures } from "../features/competitive.features";
import { extractFormFeatures } from "../features/form.features";
import { extractHistoricalFeatures } from "../features/historical.features";
import { extractMarketFeatures } from "../features/market.features";
import { extractRelationshipFeatures } from "../features/relationship.features";
import { extractStaticFeatures } from "../features/static.features";
import type { FormFeatures } from "../features/form.features";
import type { HistoricalFeatures } from "../features/historical.features";
import type { MarketFeatures } from "../features/market.features";
import { parseDistanceBeaten } from "../converters/distance.converter";
import { parseDistanceToMeters } from "../converters/distance.converter";
import { parseForm } from "../converters/form.parser";
import { parseSP } from "../converters/odds.converter";

import {
  parseDistanceBeaten,
  parseDistanceToMeters,
  parseForm,
  parseSP,
  parseToKg,
} from "../converters";

/**
 * Configuration for feature pipeline
 */
export interface FeaturePipelineConfig {
  mode: "training" | "prediction";
  dateRange?: { start: Date; end: Date };
  raceIds?: string[];
  minQualityScore?: number;
  batchSize?: number;
  saveToDatabase?: boolean;
  thresholds?: QualityThresholds;
}

/**
 * Result of feature generation
 */
export interface FeatureGenerationResult {
  featuresGenerated: number;
  racesProcessed: number;
  timeElapsed: number;
}

/**
 * Interface for historical race data
 */
export interface HistoricalRaceData {
  horse: RaceHorseEnriched;
  race: RaceCardEnriched;
}

// Default thresholds
const DEFAULT_THRESHOLDS: QualityThresholds = {
  min_runners: 4,
  min_or_coverage: 0.5,
  min_sp_coverage: 0.7,
  min_quality_score: 0.6,
};

/**
 * Generate features for training (historical data)
 */
export async function generateTrainingFeatures(
  supabase: any,
  startDate: Date,
  endDate: Date,
  options: Partial<FeaturePipelineConfig> = {},
): Promise<FeatureGenerationResult> {
  const startTime = Date.now();
  const batchSize = options.batchSize || 100;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };

  console.log(
    `Starting training feature generation from ${startDate.toISOString()} to ${endDate.toISOString()}`,
  );

  // Fetch races in date range
  const races = await fetchRacesInRange(supabase, startDate, endDate);
  console.log(`Found ${races.length} races to process`);

  let totalFeaturesGenerated = 0;
  let racesProcessed = 0;

  // Process in batches
  for (let i = 0; i < races.length; i += batchSize) {
    const raceBatch = races.slice(i, Math.min(i + batchSize, races.length));
    const batchFeatures: HorseFeatures[] = [];

    for (const race of raceBatch) {
      try {
        const features = await processRace(supabase, race, thresholds);

        if (features.length > 0) {
          batchFeatures.push(...features);
          racesProcessed++;
        }
      } catch (error) {
        console.error(`Error processing race ${race.id_race}:`, error);
      }
    }

    // Save batch to database
    if (batchFeatures.length > 0 && options.saveToDatabase !== false) {
      await saveFeaturesToDatabase(supabase, batchFeatures);
      totalFeaturesGenerated += batchFeatures.length;
    }

    console.log(
      `Processed ${i + raceBatch.length}/${races.length} races, ${totalFeaturesGenerated} features generated`,
    );
  }

  const timeElapsed = Date.now() - startTime;
  console.log(
    `Feature generation complete: ${totalFeaturesGenerated} features in ${timeElapsed}ms`,
  );

  return {
    featuresGenerated: totalFeaturesGenerated,
    racesProcessed,
    timeElapsed,
  };
}

/**
 * Generate features for prediction (upcoming races)
 */
export async function generatePredictionFeatures(
  supabase: any,
  raceIds: string[],
  options: Partial<FeaturePipelineConfig> = {},
): Promise<HorseFeatures[]> {
  console.log(`Generating prediction features for ${raceIds.length} races`);

  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const allFeatures: HorseFeatures[] = [];

  for (const raceId of raceIds) {
    try {
      const race = await fetchRaceById(supabase, raceId);

      if (!race) {
        console.warn(`Race ${raceId} not found`);
        continue;
      }

      const features = await processRace(supabase, race, thresholds);
      allFeatures.push(...features);
    } catch (error) {
      console.error(`Error processing race ${raceId} for prediction:`, error);
    }
  }

  console.log(`Generated ${allFeatures.length} prediction features`);
  return allFeatures;
}

/**
 * Process a single race and generate features for all horses
 */
async function processRace(
  supabase: any,
  race: RaceCardEnriched,
  thresholds: QualityThresholds,
): Promise<HorseFeatures[]> {
  // Fetch horses for this race
  const horses = await fetchHorsesForRace(supabase, race.id);

  // Validate race quality
  const validation = validateRace(race, horses, thresholds);
  if (!validation.isValid) {
    console.warn(`Race ${race.id_race} failed validation:`, validation.errors);
    return [];
  }

  // Convert to processed format
  const processedRace = convertRace(race, horses);
  const processedHorses = horses
    .filter((h) => h.non_runner === 0)
    .map((h) => convertHorse(h));

  // Fetch historical data for all horses
  const historicalData = await fetchHistoricalDataForHorses(
    supabase,
    horses.map((h) => h.id_horse),
  );

  // Generate features for each horse
  const features: HorseFeatures[] = [];

  for (let i = 0; i < processedHorses.length; i++) {
    const processedHorse = processedHorses[i];
    const rawHorse = horses[i];

    try {
      const horseFeatures = await generateHorseFeatures(
        processedHorse,
        rawHorse,
        processedRace,
        processedHorses,
        horses,
        historicalData.get(rawHorse.id_horse) || [],
      );

      features.push(horseFeatures);
    } catch (error) {
      console.error(
        `Error generating features for horse ${rawHorse.horse}:`,
        error,
      );
    }
  }

  return features;
}

/**
 * Generate all features for a single horse
 */
async function generateHorseFeatures(
  processedHorse: ProcessedHorse,
  rawHorse: RaceHorseEnriched,
  race: ProcessedRace,
  allProcessedHorses: ProcessedHorse[],
  allRawHorses: RaceHorseEnriched[],
  historicalData: HistoricalRaceData[],
): Promise<HorseFeatures> {
  // Extract all feature groups
  const staticFeatures = extractStaticFeatures(race, processedHorse, rawHorse);
  const historicalFeatures = extractHistoricalFeatures(historicalData, race);
  const formFeatures = extractFormFeatures(processedHorse, rawHorse);
  const marketFeatures = extractMarketFeatures(
    processedHorse,
    rawHorse,
    allProcessedHorses,
    allRawHorses,
  );
  const competitiveFeatures = extractCompetitiveFeatures(
    processedHorse,
    rawHorse,
    race,
    allProcessedHorses,
    allRawHorses,
  );
  const relationshipFeatures = extractRelationshipFeatures(
    rawHorse,
    historicalData,
    race.course,
    race.distance_meters,
  );

  // Calculate lay-specific features
  const layFeatures = calculateLaySpecificFeatures(
    historicalFeatures,
    formFeatures,
    marketFeatures,
  );

  // Determine target (1 = didn't win = good for lay)
  const target: 0 | 1 =
    rawHorse.position !== null && rawHorse.position !== 1 ? 1 : 0;

  // Combine all features
  return {
    // Identifiers
    race_horse_id: rawHorse.id,
    race_id: race.id,
    horse_id: rawHorse.id_horse,

    // Static features
    horse_age: staticFeatures.horse_age,
    horse_weight_kg: staticFeatures.horse_weight_kg,
    days_since_last_run: staticFeatures.days_since_last_run,
    race_distance_meters: staticFeatures.race_distance_meters,
    race_going_encoded: staticFeatures.race_going_encoded,
    race_class: staticFeatures.race_class,
    race_field_size: staticFeatures.race_field_size,

    // Historical features
    career_runs: historicalFeatures.career_runs,
    career_wins: historicalFeatures.career_wins,
    career_places: historicalFeatures.career_places,
    career_win_rate: historicalFeatures.career_win_rate,
    career_place_rate: historicalFeatures.career_place_rate,
    career_avg_position: historicalFeatures.career_avg_position,
    career_position_std: historicalFeatures.career_position_std,
    course_runs: historicalFeatures.course_runs,
    course_win_rate: historicalFeatures.course_win_rate,
    distance_band_runs: historicalFeatures.distance_band_runs,
    distance_band_win_rate: historicalFeatures.distance_band_win_rate,
    going_runs: historicalFeatures.going_runs,
    going_win_rate: historicalFeatures.going_win_rate,

    // Form features
    form_last_position: formFeatures.form_last_position,
    form_last3_avg: formFeatures.form_last3_avg,
    form_last5_avg: formFeatures.form_last5_avg,
    form_consistency: formFeatures.form_consistency,
    form_is_improving: formFeatures.form_is_improving,
    form_has_problems: formFeatures.form_has_problems,

    // Rating features
    or_rating: rawHorse.or_rating,
    or_rating_imputed: imputeORRating(
      rawHorse,
      competitiveFeatures.field_avg_or,
    ),
    or_rating_is_imputed: rawHorse.or_rating === null ? 1 : 0,
    or_rank_in_race: competitiveFeatures.or_rank_in_race,
    or_percentile_in_race: competitiveFeatures.or_percentile_in_race,
    or_diff_to_top: competitiveFeatures.or_diff_to_top,

    // Market features
    sp_decimal: marketFeatures.sp_decimal,
    sp_rank: marketFeatures.sp_rank,
    sp_implied_prob: marketFeatures.sp_implied_prob,
    sp_vs_field_avg: marketFeatures.sp_vs_field_avg,

    // Competitive features
    field_avg_or: competitiveFeatures.field_avg_or,
    field_std_or: competitiveFeatures.field_std_or,
    field_avg_career_wins: competitiveFeatures.field_avg_career_wins,
    stronger_opponents_count: competitiveFeatures.stronger_opponents_count,

    // Relationship features
    jockey_win_rate: relationshipFeatures.jockey_win_rate,
    jockey_course_win_rate: relationshipFeatures.jockey_course_win_rate,
    jockey_with_horse_runs: relationshipFeatures.jockey_with_horse_runs,
    jockey_with_horse_win_rate: relationshipFeatures.jockey_with_horse_win_rate,
    trainer_win_rate: relationshipFeatures.trainer_win_rate,
    trainer_course_win_rate: relationshipFeatures.trainer_course_win_rate,
    jockey_trainer_combo_runs: relationshipFeatures.jockey_trainer_combo_runs,
    jockey_trainer_combo_win_rate:
      relationshipFeatures.jockey_trainer_combo_win_rate,

    // Lay-specific features
    ...layFeatures,

    // Target
    target,
  };
}

/**
 * Calculate lay-specific features
 */
function calculateLaySpecificFeatures(
  historical: HistoricalFeatures,
  form: FormFeatures,
  market: MarketFeatures,
): {
  out_of_top3_rate: number;
  worst_recent_position: number | null;
  position_volatility: number;
  beaten_favorite_rate: number;
} {
  const out_of_top3_rate =
    historical.career_runs > 0 ? 1 - historical.career_place_rate : 0.7;

  const worst_recent_position = form.form_worst_recent;
  const position_volatility = 1 - form.form_consistency;

  const beaten_favorite_rate = market.is_favorite
    ? 1 - historical.career_win_rate
    : 0;

  return {
    out_of_top3_rate,
    worst_recent_position,
    position_volatility,
    beaten_favorite_rate,
  };
}

/**
 * Convert race to processed format
 */
function convertRace(
  race: RaceCardEnriched,
  horses: RaceHorseEnriched[],
): ProcessedRace {
  const validHorses = horses.filter((h) => h.non_runner === 0);
  const orRatings = horses
    .map((h) => h.or_rating)
    .filter((r) => r !== null && r > 0) as number[];

  return {
    id: race.id,
    race_id: race.id_race,
    course: race.course,
    date: race.date,
    distance_meters: parseDistanceToMeters(race.distance),
    going_encoded: encodeGoing(race.going),
    race_class: race.class || 0,
    total_prize_numeric: parsePrize(race.prize),
    total_runners: validHorses.length,
    valid_finishers: validHorses.filter(
      (h) => h.position !== null && h.position > 0,
    ).length,
    avg_or_rating:
      orRatings.length > 0
        ? orRatings.reduce((a, b) => a + b, 0) / orRatings.length
        : 0,
    field_quality_std: calculateStdDev(orRatings),
  };
}

/**
 * Convert horse to processed format
 */
function convertHorse(horse: RaceHorseEnriched): ProcessedHorse {
  return {
    id: horse.id,
    race_id: horse.racecard_id,
    horse_id: horse.id_horse,
    horse_name: horse.horse,
    weight_kg: parseToKg(horse.weight),
    sp_decimal: parseSP(horse.sp),
    distance_beaten_lengths: parseDistanceBeaten(horse.distance_beaten),
    form_data: parseForm(horse.form),
    has_or_rating: horse.or_rating !== null,
    has_valid_sp: parseSP(horse.sp) !== null,
    has_form: horse.form !== null && horse.form.length > 0,
  };
}

/**
 * Validate race quality
 */
function validateRace(
  race: RaceCardEnriched,
  horses: RaceHorseEnriched[],
  thresholds: QualityThresholds,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check basic race data
  if (!race.id_race) errors.push("Missing race ID");
  if (!race.distance) errors.push("Missing distance");
  if (race.canceled === 1) errors.push("Race was canceled");

  // Check runners
  const runners = horses.filter((h) => h.non_runner === 0);
  if (runners.length < thresholds.min_runners) {
    errors.push(`Too few runners: ${runners.length}`);
  }

  // Check OR coverage
  const orCoverage =
    runners.filter((h) => h.or_rating !== null).length / runners.length;
  if (orCoverage < thresholds.min_or_coverage) {
    warnings.push(`Low OR coverage: ${(orCoverage * 100).toFixed(1)}%`);
  }

  // Check SP coverage
  const spCoverage =
    runners.filter((h) => h.sp !== null).length / runners.length;
  if (spCoverage < thresholds.min_sp_coverage) {
    warnings.push(`Low SP coverage: ${(spCoverage * 100).toFixed(1)}%`);
  }

  // Calculate quality score
  const qualityScore =
    orCoverage * 0.3 +
    spCoverage * 0.3 +
    Math.min(runners.length / 10, 1) * 0.2 +
    (race.finished === 1 ? 0.2 : 0);

  return {
    isValid:
      errors.length === 0 && qualityScore >= thresholds.min_quality_score,
    errors,
    warnings,
    qualityScore,
  };
}

/**
 * Database operations using Supabase
 */
async function fetchRacesInRange(
  supabase: any,
  startDate: Date,
  endDate: Date,
): Promise<RaceCardEnriched[]> {
  const { data, error } = await supabase
    .from("racecards_hr_enriched")
    .select("*")
    .gte("date", startDate.toISOString())
    .lte("date", endDate.toISOString())
    .eq("finished", 1)
    .eq("canceled", 0)
    .order("date", { ascending: true })
    .order("off_time_br", { ascending: true });

  if (error) {
    console.error("Error fetching races:", error);
    throw error;
  }

  return data || [];
}

async function fetchRaceById(
  supabase: any,
  raceId: string,
): Promise<RaceCardEnriched | null> {
  const { data, error } = await supabase
    .from("racecards_hr_enriched")
    .select("*")
    .eq("id_race", raceId)
    .single();

  if (error) {
    console.error("Error fetching race:", error);
    return null;
  }

  return data;
}

async function fetchHorsesForRace(
  supabase: any,
  raceId: number,
): Promise<RaceHorseEnriched[]> {
  const { data, error } = await supabase
    .from("race_horses_hr_enriched")
    .select("*")
    .eq("racecard_id", raceId)
    .order("number", { ascending: true });

  if (error) {
    console.error("Error fetching horses:", error);
    throw error;
  }

  return data || [];
}

async function fetchHistoricalDataForHorses(
  supabase: any,
  horseIds: number[],
): Promise<Map<number, HistoricalRaceData[]>> {
  // Supabase doesn't support direct JOINs in the same way, so we'll need to fetch in two steps

  // First, fetch all historical horse records
  const { data: horseRecords, error: horseError } = await supabase
    .from("race_horses_hr_enriched")
    .select("*, racecard_id")
    .in("id_horse", horseIds)
    .not("position", "is", null);

  if (horseError) {
    console.error("Error fetching horse history:", horseError);
    throw horseError;
  }

  if (!horseRecords || horseRecords.length === 0) {
    return new Map();
  }

  // Get unique racecard IDs
  const racecardIds = [...new Set(horseRecords.map((h) => h.racecard_id))];

  // Fetch corresponding race data
  const { data: raceData, error: raceError } = await supabase
    .from("racecards_hr_enriched")
    .select("*")
    .in("id", racecardIds)
    .eq("finished", 1);

  if (raceError) {
    console.error("Error fetching race history:", raceError);
    throw raceError;
  }

  // Create a map of race data for quick lookup
  const raceMap = new Map<number, RaceCardEnriched>();
  raceData?.forEach((race) => {
    raceMap.set(race.id, race);
  });

  // Group by horse ID
  const historicalMap = new Map<number, HistoricalRaceData[]>();

  horseRecords.forEach((horse) => {
    const race = raceMap.get(horse.racecard_id);
    if (!race) return; // Skip if race data not found

    const horseId = horse.id_horse;
    const data: HistoricalRaceData = { horse, race };

    if (!historicalMap.has(horseId)) {
      historicalMap.set(horseId, []);
    }
    historicalMap.get(horseId)!.push(data);
  });

  // Sort each horse's history by date (most recent first)
  historicalMap.forEach((history) => {
    history.sort((a, b) => {
      const dateA = new Date(a.race.date).getTime();
      const dateB = new Date(b.race.date).getTime();
      return dateB - dateA;
    });
  });

  return historicalMap;
}

async function saveFeaturesToDatabase(
  supabase: any,
  features: HorseFeatures[],
): Promise<void> {
  const records = features.map((f) => ({
    race_horse_id: f.race_horse_id,
    race_id: f.race_id,
    horse_id: f.horse_id,
    features: f, // Supabase handles JSONB automatically
    generated_at: new Date().toISOString(),
    model_version: "v4.0",
    quality_score: calculateFeatureQuality(f),
  }));

  // Batch insert using Supabase
  const { error } = await supabase.from("horse_features").insert(records);

  if (error) {
    console.error("Error saving features:", error);
    throw error;
  }
}

/**
 * Helper functions
 */
function encodeGoing(going: string | null): number {
  if (!going) return 4;

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

  return goingMap[going.toLowerCase()] || 4;
}

function parsePrize(prize: string | null): number {
  if (!prize) return 0;
  const clean = prize.replace(/[£$€,]/g, "").trim();
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) /
    values.length;
  return Math.sqrt(variance);
}

function imputeORRating(horse: RaceHorseEnriched, fieldAvg: number): number {
  if (horse.or_rating !== null) return horse.or_rating;

  const sp = parseSP(horse.sp);
  if (sp && sp < 20) {
    return Math.round(100 - sp * 3);
  }

  if (fieldAvg > 0) {
    return Math.round(fieldAvg * 0.85);
  }

  return 60;
}

function calculateFeatureQuality(features: HorseFeatures): number {
  let quality = 0;
  let checks = 0;

  if (features.or_rating !== null) quality++;
  checks++;

  if (features.sp_decimal !== null) quality++;
  checks++;

  if (features.career_runs > 0) quality++;
  checks++;

  if (features.form_last_position !== null) quality++;
  checks++;

  if (features.jockey_win_rate > 0) quality++;
  checks++;

  return checks > 0 ? quality / checks : 0;
}
