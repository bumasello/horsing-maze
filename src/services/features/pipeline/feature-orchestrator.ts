// features_v4/pipeline/feature-orchestrator.ts

import { getDataSchema, getOutputSchema } from "../../../shared/db-config";
import { withSupabaseRetry } from "../../../shared/retry";

import type {
	HorseFeatures,
	ProcessedHorse,
	ProcessedRace,
	QualityThresholds,
	RaceCardEnriched,
	RaceHorseEnriched,
	ValidationResult,
} from "../types/core.types";

import {
	type FormFeatures,
	type HistoricalFeatures,
	type HistoricalRaceData,
	type MarketFeatures,
	type RpscrapeHistoricalRecord,
	calculateDerivedStaticFeatures,
	extractCompetitiveFeatures,
	extractFieldPaceFeatures,
	extractFormFeatures,
	extractHistoricalFeatures,
	extractMarketFeatures,
	extractPaceFeatures,
	extractRelationshipFeatures,
	extractStaticFeatures,
	paceMatchScore,
} from "../features/index";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
	encodeGoing,
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
export async function generateTrainingFeatures_v4(
	supabase: SupabaseClient,
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
	const races = await fetchRacesWithoutFeatures(supabase, startDate, endDate);
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
			await saveTrainingFeaturesToDatabase(supabase, batchFeatures);
			totalFeaturesGenerated += batchFeatures.length;
		}

		// ⚡ FIX OOM: limpar caches entre batches para evitar acúmulo
		clearHistoryCache();
		clearJockeyTrainerStatsCache();

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
export async function generatePredictionFeatures_v4(
	supabase: SupabaseClient,
	raceIds: string[],
	options: Partial<FeaturePipelineConfig> = {},
): Promise<HorseFeatures[]> {
	console.log(`Generating prediction features for ${raceIds.length} races`);

	const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
	const allFeatures: HorseFeatures[] = [];
	const featuresByRace = new Map<
		string,
		{ features: HorseFeatures[]; raceDate: Date }
	>();

	for (let idx = 0; idx < raceIds.length; idx++) {
		const raceId = raceIds[idx];
		try {
			const race = await fetchRaceById(supabase, raceId);

			if (!race) {
				console.warn(`Race ${raceId} not found`);
				continue;
			}

			const features = await processRaceForPrediction(
				supabase,
				race,
				thresholds,
			);

			if (features.length > 0) {
				allFeatures.push(...features);
				featuresByRace.set(raceId, {
					features,
					raceDate: new Date(race.date),
				});
			}
		} catch (error) {
			console.error(`Error processing race ${raceId} for prediction:`, error);
		}

		// ⚡ FIX OOM: limpar cache de histórico a cada 50 corridas durante predição
		// (NÃO limpar jockeyTrainerStatsCache aqui — queremos que ele persista entre corridas do mesmo dia)
		if ((idx + 1) % 50 === 0) {
			clearHistoryCache();
		}
	}

	// MUDANÇA: Salvar em tabela de predição com data da corrida
	if (options.saveToDatabase !== false && allFeatures.length > 0) {
		for (const [raceId, data] of featuresByRace) {
			await savePredictionFeaturesToDatabase(
				supabase,
				data.features,
				data.raceDate,
			);
		}
	}

	// ⚡ Limpar todos os caches ao final da predição
	clearHistoryCache();
	clearJockeyTrainerStatsCache();

	console.log(`Generated ${allFeatures.length} prediction features`);
	return allFeatures;
}

/**
 * Process a single race and generate features for all horses
 */
async function processRace(
	supabase: SupabaseClient,
	race: RaceCardEnriched,
	thresholds: QualityThresholds,
): Promise<HorseFeatures[]> {
	const horses = await fetchHorsesForRace(supabase, race.id);

	const validation = validateRace(race, horses, thresholds);
	if (!validation.isValid) {
		console.warn(
			`Race ${race.id_race} failed validation:`,
			validation.errors,
			`quality=${validation.qualityScore.toFixed(2)}`,
			validation.warnings,
		);
		return [];
	}

	const processedRace = convertRace(race, horses);
	const processedHorses = horses
		.filter((h) => h.non_runner !== 1)
		.map((h) => convertHorse(h));

	const historicalData = await fetchHistoricalDataForHorses(
		supabase,
		horses.map((h) => h.id_horse),
		race.date,
	);

	// NOVO: buscar histórico do rpscrape (comments + ovr_btn + secs + RPR/TS)
	// Cobertura parcial (60-88% por ano) — cavalos sem dados ganham defaults neutros
	const rpscrapeHistorical = await fetchRpscrapeHistoricalForHorses(
		supabase,
		horses.map((h) => h.id_horse),
		race.date,
	);

	// NOVO: buscar stats globais de jóqueis/treinadores para esta data
	const jockeyTrainerStats = await fetchJockeyTrainerStats(supabase, race.date);

	const features: HorseFeatures[] = [];

	// 1ª PASSADA: gera features individuais incluindo run_style_mode_recent_5
	for (let i = 0; i < processedHorses.length; i++) {
		const processedHorse = processedHorses[i];
		const rawHorse = horses.find((h) => h.id === processedHorse.id);
		if (!rawHorse) continue;

		try {
			const horseFeatures = await generateHorseFeatures(
				processedHorse,
				rawHorse,
				processedRace,
				processedHorses,
				horses,
				historicalData.get(rawHorse.id_horse) || [],
				rpscrapeHistorical.get(rawHorse.id_horse) || [],
				race.finished === 1,
				jockeyTrainerStats,
			);
			features.push(horseFeatures);
		} catch (error) {
			console.error(
				`Error generating features for horse ${rawHorse.horse}:`,
				error,
			);
		}
	}

	// 2ª PASSADA: calcula field-level pace features (precisa de TODOS os
	// run_style_mode dos cavalos coletados). Mutate features em loco.
	const horseStyles = features.map((f) => f.run_style_mode_recent_5);
	const fieldPace = extractFieldPaceFeatures(horseStyles);
	for (const f of features) {
		f.field_pace_pressure = fieldPace.field_pace_pressure;
		f.is_lone_speed = fieldPace.is_lone_speed as 0 | 1;
		f.field_count_E = fieldPace.field_count_E;
		f.field_count_EP = fieldPace.field_count_EP;
		f.field_count_P = fieldPace.field_count_P;
		f.field_count_S = fieldPace.field_count_S;
		f.pace_match_score = paceMatchScore(f.run_style_mode_recent_5, fieldPace);
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
	rpscrapeHistorical: RpscrapeHistoricalRecord[],
	isFinishedRace: boolean,
	jockeyTrainerStats: JockeyTrainerStatsMap,
): Promise<HorseFeatures> {
	const staticFeatures = extractStaticFeatures(race, processedHorse, rawHorse);
	const derivedStatic = calculateDerivedStaticFeatures(staticFeatures); // NOVO
	const historicalFeatures = extractHistoricalFeatures(
		historicalData,
		race,
		new Date(race.date),
	);
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
		jockeyTrainerStats,
	);
	const layFeatures = calculateLaySpecificFeatures(
		historicalFeatures,
		formFeatures,
		marketFeatures,
	);

	let target: 0 | 1 | null;
	if (isFinishedRace) {
		target = rawHorse.position !== null && rawHorse.position !== 1 ? 1 : 0;
	} else {
		target = null;
	}

	return {
		// Identifiers
		race_horse_id: rawHorse.id,
		race_id: race.id,
		race_date: race.date,
		horse_id: rawHorse.id_horse,
		race_type: race.race_type || undefined,
		surface_encoded: race.surface === "AW" ? 1 : 0,

		// Static features
		horse_age: staticFeatures.horse_age,
		horse_weight_kg: staticFeatures.horse_weight_kg,
		days_since_last_run: staticFeatures.days_since_last_run,
		race_distance_meters: staticFeatures.race_distance_meters,
		race_going_encoded: staticFeatures.race_going_encoded,
		race_class: staticFeatures.race_class,
		race_field_size: staticFeatures.race_field_size,
		race_total_prize: staticFeatures.race_total_prize,
		horse_number: staticFeatures.horse_number,

		// Derived static (binary flags)
		is_juvenile: derivedStatic.is_juvenile,
		is_3yo: derivedStatic.is_3yo,
		is_mature: derivedStatic.is_mature,
		is_fresh: derivedStatic.is_fresh,
		is_quick_backup: derivedStatic.is_quick_backup,
		is_normal_rest: derivedStatic.is_normal_rest,
		is_small_field: derivedStatic.is_small_field,
		is_large_field: derivedStatic.is_large_field,
		is_sprint: derivedStatic.is_sprint,
		is_mile: derivedStatic.is_mile,
		is_middle_distance: derivedStatic.is_middle_distance,
		is_long_distance: derivedStatic.is_long_distance,
		is_firm_ground: derivedStatic.is_firm_ground,
		is_good_ground: derivedStatic.is_good_ground,
		is_soft_ground: derivedStatic.is_soft_ground,
		is_high_class: derivedStatic.is_high_class ?? 0,
		is_mid_class: derivedStatic.is_mid_class ?? 0,
		is_low_class: derivedStatic.is_low_class ?? 0,

		// Historical — career
		career_runs: historicalFeatures.career_runs,
		career_wins: historicalFeatures.career_wins,
		career_places: historicalFeatures.career_places,
		career_win_rate: historicalFeatures.career_win_rate,
		career_place_rate: historicalFeatures.career_place_rate,
		career_avg_position: historicalFeatures.career_avg_position,
		career_position_std: historicalFeatures.career_position_std,

		// Historical — condition specific
		course_runs: historicalFeatures.course_runs,
		course_wins: historicalFeatures.course_wins,
		course_win_rate: historicalFeatures.course_win_rate,
		distance_band_runs: historicalFeatures.distance_band_runs,
		distance_band_wins: historicalFeatures.distance_band_wins,
		distance_band_win_rate: historicalFeatures.distance_band_win_rate,
		going_runs: historicalFeatures.going_runs,
		going_wins: historicalFeatures.going_wins,
		going_win_rate: historicalFeatures.going_win_rate,
		class_runs: historicalFeatures.class_runs,
		class_wins: historicalFeatures.class_wins,
		class_win_rate: historicalFeatures.class_win_rate,

		// Historical — recent
		recent_runs_30d: historicalFeatures.recent_runs_30d,
		recent_wins_30d: historicalFeatures.recent_wins_30d,
		recent_runs_90d: historicalFeatures.recent_runs_90d,
		recent_wins_90d: historicalFeatures.recent_wins_90d,
		recent_avg_position: historicalFeatures.recent_avg_position,

		// Historical — trends
		improvement_rate: historicalFeatures.improvement_rate,
		consistency_score: historicalFeatures.consistency_score,
		peak_or_rating: historicalFeatures.peak_or_rating,
		avg_or_rating: historicalFeatures.avg_or_rating,
		total_prize_money: historicalFeatures.total_prize_money,
		best_distance_meters: historicalFeatures.best_distance_meters,
		preferred_going: historicalFeatures.preferred_going,
		avg_days_between_runs: historicalFeatures.avg_days_between_runs,

		// Form — basic
		form_last_position: formFeatures.form_last_position,
		form_last3_avg: formFeatures.form_last3_avg,
		form_last5_avg: formFeatures.form_last5_avg,
		form_consistency: formFeatures.form_consistency,
		form_is_improving: formFeatures.form_is_improving,
		form_has_problems: formFeatures.form_has_problems,

		// Form — detailed
		form_wins_in_last5: formFeatures.form_wins_in_last5,
		form_places_in_last5: formFeatures.form_places_in_last5,
		form_consecutive_wins: formFeatures.form_consecutive_wins,
		form_consecutive_places: formFeatures.form_consecutive_places,
		form_worst_recent: formFeatures.form_worst_recent,
		form_best_recent: formFeatures.form_best_recent,

		// Form — patterns
		form_trend_score: formFeatures.form_trend_score,
		form_volatility: formFeatures.form_volatility,
		form_recovery_rate: formFeatures.form_recovery_rate,
		form_peak_position: formFeatures.form_peak_position,

		// Form — quality
		form_data_quality: formFeatures.form_data_quality,
		form_races_recorded: formFeatures.form_races_recorded,
		form_complete_finishes: formFeatures.form_complete_finishes,
		form_dnf_count: formFeatures.form_dnf_count,

		// Form — weighted
		form_weighted_avg: formFeatures.form_weighted_avg,
		form_exponential_avg: formFeatures.form_exponential_avg,

		// Rating
		or_rating: rawHorse.or_rating,
		or_rating_imputed: imputeORRating(
			rawHorse,
			competitiveFeatures.field_avg_or,
		),
		or_rating_is_imputed: rawHorse.or_rating === null ? 1 : 0,
		or_rank_in_race: competitiveFeatures.or_rank_in_race,
		or_percentile_in_race: competitiveFeatures.or_percentile_in_race,
		or_diff_to_top: competitiveFeatures.or_diff_to_top,
		or_diff_to_avg: competitiveFeatures.or_diff_to_avg,

		// Market — basic
		sp_decimal: marketFeatures.sp_decimal,
		sp_rank: marketFeatures.sp_rank,
		sp_implied_prob: marketFeatures.sp_implied_prob,
		sp_vs_field_avg: marketFeatures.sp_vs_field_avg,

		// Market — position
		is_favorite: marketFeatures.is_favorite,
		is_joint_favorite: marketFeatures.is_joint_favorite,
		is_top3_market: marketFeatures.is_top3_market,
		is_outsider: marketFeatures.is_outsider,

		// Market — field
		field_total_probability: marketFeatures.field_total_probability,
		field_overround: marketFeatures.field_overround,
		market_confidence: marketFeatures.market_confidence,
		sp_concentration: marketFeatures.sp_concentration,

		// Market — value
		sp_value_rating: marketFeatures.sp_value_rating,
		is_overbet: marketFeatures.is_overbet,
		is_underbet: marketFeatures.is_underbet,
		market_inefficiency: marketFeatures.market_inefficiency,

		// Market — relative
		sp_to_favorite_ratio: marketFeatures.sp_to_favorite_ratio,
		sp_percentile: marketFeatures.sp_percentile,
		normalized_sp: marketFeatures.normalized_sp,
		market_share: marketFeatures.market_share,

		// Competitive — field quality
		field_avg_or: competitiveFeatures.field_avg_or,
		field_std_or: competitiveFeatures.field_std_or,
		field_max_or: competitiveFeatures.field_max_or,
		field_min_or: competitiveFeatures.field_min_or,
		field_or_spread: competitiveFeatures.field_or_spread,

		// Competitive — position
		stronger_opponents_count: competitiveFeatures.stronger_opponents_count,
		weaker_opponents_count: competitiveFeatures.weaker_opponents_count,

		// Competitive — composition
		field_avg_career_wins: competitiveFeatures.field_avg_career_wins,
		field_avg_win_rate: competitiveFeatures.field_avg_win_rate,
		field_avg_recent_position: competitiveFeatures.field_avg_recent_position,
		experienced_runners_count: competitiveFeatures.experienced_runners_count,
		maiden_runners_count: competitiveFeatures.maiden_runners_count,

		// Competitive — advantages
		or_advantage_score: competitiveFeatures.or_advantage_score,
		experience_advantage: competitiveFeatures.experience_advantage,
		form_advantage: competitiveFeatures.form_advantage,
		weight_advantage: competitiveFeatures.weight_advantage,

		// Competitive — race metrics
		race_competitiveness_score: competitiveFeatures.race_competitiveness_score,
		field_depth_score: competitiveFeatures.field_depth_score,
		quality_concentration: competitiveFeatures.quality_concentration,
		is_competitive_race: competitiveFeatures.is_competitive_race,

		// Competitive — relative
		better_than_field_avg: competitiveFeatures.better_than_field_avg,
		in_top_quarter: competitiveFeatures.in_top_quarter,
		in_bottom_quarter: competitiveFeatures.in_bottom_quarter,

		// Relationship — jockey
		jockey_win_rate: relationshipFeatures.jockey_win_rate,
		jockey_place_rate: relationshipFeatures.jockey_place_rate,
		jockey_recent_form: relationshipFeatures.jockey_recent_form,
		jockey_course_win_rate: relationshipFeatures.jockey_course_win_rate,
		jockey_distance_win_rate: relationshipFeatures.jockey_distance_win_rate,
		jockey_total_runs: relationshipFeatures.jockey_total_runs,

		// Relationship — trainer
		trainer_win_rate: relationshipFeatures.trainer_win_rate,
		trainer_place_rate: relationshipFeatures.trainer_place_rate,
		trainer_recent_form: relationshipFeatures.trainer_recent_form,
		trainer_course_win_rate: relationshipFeatures.trainer_course_win_rate,
		trainer_distance_win_rate: relationshipFeatures.trainer_distance_win_rate,
		trainer_total_runs: relationshipFeatures.trainer_total_runs,

		// Relationship — combinations
		jockey_with_horse_runs: relationshipFeatures.jockey_with_horse_runs,
		jockey_with_horse_wins: relationshipFeatures.jockey_with_horse_wins,
		jockey_with_horse_win_rate: relationshipFeatures.jockey_with_horse_win_rate,
		jockey_with_horse_place_rate:
			relationshipFeatures.jockey_with_horse_place_rate,
		trainer_with_horse_runs: relationshipFeatures.trainer_with_horse_runs,
		trainer_with_horse_wins: relationshipFeatures.trainer_with_horse_wins,
		trainer_with_horse_win_rate:
			relationshipFeatures.trainer_with_horse_win_rate,
		trainer_with_horse_place_rate:
			relationshipFeatures.trainer_with_horse_place_rate,
		jockey_trainer_combo_runs: relationshipFeatures.jockey_trainer_combo_runs,
		jockey_trainer_combo_wins: relationshipFeatures.jockey_trainer_combo_wins,
		jockey_trainer_combo_win_rate:
			relationshipFeatures.jockey_trainer_combo_win_rate,
		jockey_trainer_combo_place_rate:
			relationshipFeatures.jockey_trainer_combo_place_rate,

		// Relationship — owner & lineage
		owner_win_rate: relationshipFeatures.owner_win_rate,
		owner_with_trainer_win_rate:
			relationshipFeatures.owner_with_trainer_win_rate,
		owner_total_runners: relationshipFeatures.owner_total_runners,
		sire_win_rate: relationshipFeatures.sire_win_rate,
		sire_distance_suitability: relationshipFeatures.sire_distance_suitability,
		dam_produce_win_rate: relationshipFeatures.dam_produce_win_rate,

		// Relationship — strength
		stable_confidence: relationshipFeatures.stable_confidence,
		jockey_reliability: relationshipFeatures.jockey_reliability,
		partnership_strength: relationshipFeatures.partnership_strength,

		// Lay-specific
		...layFeatures,

		// Pace / Run-Style (individual — field-level setado em 2ª passada no caller)
		...extractPaceFeatures(rpscrapeHistorical, new Date(race.date)),
		field_pace_pressure: 0, // placeholder, sobrescrito na 2ª passada
		is_lone_speed: 0 as 0 | 1,
		field_count_E: 0,
		field_count_EP: 0,
		field_count_P: 0,
		field_count_S: 0,
		pace_match_score: 0,

		// Target
		target: target as 0 | 1,
		finish_position: isFinishedRace ? rawHorse.position : null,
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
	// CORREÇÃO: Filtrar cavalos que não são non-runners confirmados
	const validHorses = horses.filter((h) => h.non_runner !== 1);

	const orRatings = horses
		.map((h) => h.or_rating)
		.filter((r) => r !== null && r > 0) as number[];

	return {
		id: race.id,
		race_id: race.id_race,
		course: race.course,
		date: race.date,
		race_type: race.race_type || undefined,
		surface_encoded: race.surface === "AW" ? 1 : 0,
		distance_meters: parseDistanceToMeters(race.distance),
		going_encoded: encodeGoing(race.going),
		race_class: race.class ?? null,
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

	// CORREÇÃO: Contar runners corretamente
	const runners = horses.filter((h) => h.non_runner !== 1);

	if (runners.length < thresholds.min_runners) {
		errors.push(`Too few runners: ${runners.length}`);
	}

	// Check OR coverage
	const orCoverage =
		runners.filter((h) => h.or_rating !== null).length / runners.length;
	if (orCoverage < thresholds.min_or_coverage) {
		warnings.push(`Low OR coverage: ${(orCoverage * 100).toFixed(1)}%`);
	}

	// Check SP coverage - CORREÇÃO para corridas futuras
	const spCoverage =
		runners.filter((h) => h.sp !== null && h.sp !== "" && h.sp !== "0").length /
		runners.length;

	// Para corridas futuras (finished = 0), SP coverage baixo é esperado
	if (race.finished === 1 && spCoverage < thresholds.min_sp_coverage) {
		warnings.push(`Low SP coverage: ${(spCoverage * 100).toFixed(1)}%`);
	}

	// Calculate quality score - ajustado para corridas futuras
	const qualityScore =
		orCoverage * 0.3 +
		(race.finished === 1 ? spCoverage * 0.3 : 0.3) + // Se não terminou, assume SP OK
		Math.min(runners.length / 10, 1) * 0.2 +
		(race.finished === 1 ? 0.2 : 0.1); // Menos peso para finished em predição

	return {
		isValid:
			errors.length === 0 && qualityScore >= thresholds.min_quality_score,
		errors,
		warnings,
		qualityScore,
	};
}

async function fetchRacesWithoutFeatures(
	supabase: SupabaseClient,
	startDate: Date,
	endDate: Date,
): Promise<any[]> {
	// Buscar IDs de corridas que já têm features geradas
	const { data: existingFeatures } = await supabase
		.schema(getOutputSchema())
		.from("training_enriched_horse_features")
		.select("race_id")
		.eq("model_version", "v5.0");

	const existingRaceIds = new Set(
		(existingFeatures || []).map((f) => f.race_id),
	);

	// Buscar todas as corridas no range
	const allRaces = await fetchRacesInRange(supabase, startDate, endDate);

	// Retornar apenas as que ainda não têm features
	const newRaces = allRaces.filter((r) => !existingRaceIds.has(r.id));

	console.log(
		`📊 ${allRaces.length} corridas no range, ${newRaces.length} sem features ainda`,
	);

	return newRaces;
}

/**
 * Database operations using Supabase
 */
async function fetchRacesInRange(
	supabase: SupabaseClient,
	startDate: Date,
	endDate: Date,
): Promise<any[]> {
	// Primeiro, contar total de registros disponíveis
	const { count: totalCount, error: countError } = await supabase
		.schema(getDataSchema())
		.from("racecards_hr_enriched")
		.select("*", { count: "exact", head: true })
		.gte("date", startDate.toISOString())
		.lte("date", endDate.toISOString())
		.eq("finished", 1)
		.eq("canceled", 0);

	if (countError) {
		console.error("Error counting races:", countError);
		throw countError;
	}

	console.log(`📊 Total de registros disponíveis: ${totalCount}`);

	// Carregar dados com paginação
	const allRaces: any[] = [];
	const pageSize = 1000; // Tamanho seguro de página
	let currentPage = 0;

	while (currentPage * pageSize < (totalCount || 0)) {
		const from = currentPage * pageSize;
		const to = from + pageSize - 1;

		const { data: pageData, error } = await supabase
			.schema(getDataSchema())
			.from("racecards_hr_enriched")
			.select("*")
			.gte("date", startDate.toISOString())
			.lte("date", endDate.toISOString())
			.eq("finished", 1)
			.eq("canceled", 0)
			.order("date", { ascending: true })
			.order("off_time_br", { ascending: true })
			.order("id", { ascending: true })
			.range(from, to);

		if (error) {
			console.error("Error fetching races:", error);
			throw error;
		}

		if (!pageData) break;
		allRaces.push(...pageData);
		currentPage++;

		console.log(`📥 Carregadas ${allRaces.length}/${totalCount} corridas...`);
	}

	return allRaces;
}

async function fetchRaceById(
	supabase: SupabaseClient,
	raceId: string,
): Promise<RaceCardEnriched | null> {
	const { data, error } = await supabase
		.schema(getDataSchema())
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
	supabase: SupabaseClient,
	raceId: number,
): Promise<RaceHorseEnriched[]> {
	const { data, error } = await supabase
		.schema(getDataSchema())
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

// ============================================================================
// CACHES
// ============================================================================

// ⚡ OTIMIZAÇÃO #2: Cache de jockey/trainer stats por data
// Problema: fetchJockeyTrainerStats é chamado 1x por corrida.
// 30 corridas de amanhã = 30 queries gigantes com resultado IDÊNTICO.
// Solução: cachear por data. 30 corridas = 1 query real + 29 cache hits.
const jockeyTrainerStatsCache = new Map<string, JockeyTrainerStatsMap>();

function clearJockeyTrainerStatsCache(): void {
	const size = jockeyTrainerStatsCache.size;
	jockeyTrainerStatsCache.clear();
	if (size > 0) {
		console.log(`♻ Cache de jockey/trainer stats limpo (${size} entries)`);
	}
}

// ⚡ FIX OOM: Cache de histórico com tamanho máximo
const MAX_CACHE_SIZE = 500;
const historyCache = new Map<string, HistoricalRaceData[]>();

function cacheSet(key: string, value: HistoricalRaceData[]): void {
	if (historyCache.size >= MAX_CACHE_SIZE && !historyCache.has(key)) {
		const keysToDelete = [...historyCache.keys()].slice(0, 100);
		for (const k of keysToDelete) {
			historyCache.delete(k);
		}
	}
	historyCache.set(key, value);
}

function clearHistoryCache(): void {
	const size = historyCache.size;
	historyCache.clear();
	if (size > 0) {
		console.log(`♻ Cache de histórico limpo (${size} entries removidas)`);
	}
}

// ============================================================================
// FETCH FUNCTIONS
// ============================================================================

// ⚡ OTIMIZAÇÃO #3: Batch query em vez de 1 query por cavalo
// ANTES: 12 cavalos = 12 queries individuais + 12 queries de enrichment = 24 queries
// DEPOIS: 12 cavalos = 1-2 queries batch + 1-2 queries enrichment = 2-4 queries
async function fetchHistoricalDataForHorses(
	supabase: SupabaseClient,
	horseIds: number[],
	beforeDate?: string,
): Promise<Map<number, HistoricalRaceData[]>> {
	const historicalMap = new Map<number, HistoricalRaceData[]>();

	// ─── PASSO 1: Separar cavalos cacheados dos não-cacheados ───
	const uncachedHorseIds: number[] = [];
	for (const horseId of horseIds) {
		const cacheKey = `${horseId}-${beforeDate?.toString() || "all"}`;
		if (historyCache.has(cacheKey)) {
			historicalMap.set(horseId, historyCache.get(cacheKey)!);
		} else {
			uncachedHorseIds.push(horseId);
		}
	}

	if (uncachedHorseIds.length === 0) {
		return historicalMap;
	}

	console.log(
		`  📊 fetchHistoricalData: ${horseIds.length} cavalos total, ${uncachedHorseIds.length} sem cache`,
	);

	try {
		// ─── PASSO 2: Batch query — buscar registros de TODOS os cavalos de uma vez ───
		// Em vez de 1 query por cavalo (.eq("id_horse", id)), fazemos 1 query com .in()
		const allHorseRecords: any[] = [];
		const inChunkSize = 50; // Limite seguro para cláusula .in() do Supabase

		for (let i = 0; i < uncachedHorseIds.length; i += inChunkSize) {
			const chunk = uncachedHorseIds.slice(i, i + inChunkSize);

			const records = await withSupabaseRetry(
				async () => {
					return await supabase
						.schema(getDataSchema())
						.from("race_horses_hr_enriched")
						.select(
							`id, id_horse, horse, position, or_rating, sp_decimal, weight,
             distance_beaten, non_runner, age, jockey, trainer, form, racecard_id`,
						)
						.in("id_horse", chunk)
						.not("position", "is", null)
						.gt("position", 0);
				},
				`fetchHistoricalData - batch horses ${Math.floor(i / inChunkSize) + 1}`,
			);

			if (records) {
				allHorseRecords.push(...records);
			}
		}

		// ─── PASSO 3: Agrupar por cavalo e limitar a 21 registros (mesmo que o .limit(21) original) ───
		const recordsByHorse = new Map<number, any[]>();
		for (const record of allHorseRecords) {
			const hId = record.id_horse;
			if (!recordsByHorse.has(hId)) {
				recordsByHorse.set(hId, []);
			}
			const arr = recordsByHorse.get(hId)!;
			if (arr.length < 21) {
				arr.push(record);
			}
		}

		// ─── PASSO 4: Batch enrichment — buscar dados de TODAS as corridas referenciadas de uma vez ───
		// Em vez de 1 query por cavalo no enrichWithRaceData, fazemos 1 query para todos
		const allRacecardIds = new Set<number>();
		for (const records of recordsByHorse.values()) {
			for (const r of records) {
				allRacecardIds.add(r.racecard_id);
			}
		}

		const raceMap = new Map<number, any>();
		const racecardIdArray = [...allRacecardIds];
		const raceChunkSize = 200; // Limite seguro para .in() com dados maiores

		for (let i = 0; i < racecardIdArray.length; i += raceChunkSize) {
			const chunk = racecardIdArray.slice(i, i + raceChunkSize);

			const raceData = await withSupabaseRetry(
				async () => {
					let query = supabase
						.schema(getDataSchema())
						.from("racecards_hr_enriched")
						.select(
							"id, date, course, distance, going, class, finished, canceled, title, prize, id_race, off_time_br",
						)
						.in("id", chunk)
						.eq("finished", 1)
						.eq("canceled", 0);

					if (beforeDate) {
						query = query.lt("date", beforeDate);
					}

					return await query;
				},
				`fetchHistoricalData - enrichment batch ${Math.floor(i / raceChunkSize) + 1}`,
			);

			if (raceData) {
				for (const race of raceData) {
					raceMap.set(race.id, race);
				}
			}
		}

		// ─── PASSO 5: Montar HistoricalRaceData por cavalo (mesma lógica do enrichWithRaceData) ───
		for (const horseId of uncachedHorseIds) {
			const horseRecords = recordsByHorse.get(horseId) || [];
			const historicalData: HistoricalRaceData[] = [];

			for (const horse of horseRecords) {
				const race = raceMap.get(horse.racecard_id);
				if (!race) continue;

				historicalData.push({
					horse: {
						id: horse.id,
						id_horse: horse.id_horse,
						horse: horse.horse,
						position: horse.position,
						or_rating: horse.or_rating,
						sp_decimal: horse.sp_decimal,
						weight: horse.weight,
						distance_beaten: horse.distance_beaten,
						non_runner: horse.non_runner,
						age: horse.age,
						jockey: horse.jockey,
						trainer: horse.trainer,
						form: horse.form,
						racecard_id: horse.racecard_id,
						number: horse.number || null,
						dam: horse.dam || null,
						sire: horse.sire || null,
						owner: horse.owner || null,
						last_ran_days_ago: horse.last_ran_days_ago || null,
						sp: horse.sp || null,
					} as RaceHorseEnriched,
					race: {
						id: race.id,
						date: race.date,
						course: race.course,
						distance: race.distance,
						going: race.going,
						class: race.class,
						finished: race.finished,
						canceled: race.canceled,
						title: race.title || "",
						prize: race.prize || "",
						id_race: race.id_race || "",
						off_time_br: race.off_time_br || "",
						age: race.age || null,
						finish_time: race.finish_time || null,
					} as RaceCardEnriched,
				});
			}

			// Ordenar por data (mais recente primeiro) — mesmo que enrichWithRaceData
			historicalData.sort((a, b) => {
				const dateA = new Date(a.race.date).getTime();
				const dateB = new Date(b.race.date).getTime();
				return dateB - dateA;
			});

			// Cache e armazenar resultado
			const cacheKey = `${horseId}-${beforeDate?.toString() || "all"}`;
			cacheSet(cacheKey, historicalData);
			historicalMap.set(horseId, historicalData);
		}
	} catch (error) {
		console.error(
			"❌ Erro crítico no fetchHistoricalDataForHorses batch:",
			error,
		);
		// Fallback: garantir que todos os cavalos tenham uma entrada (mesmo vazia)
		for (const horseId of uncachedHorseIds) {
			if (!historicalMap.has(horseId)) {
				historicalMap.set(horseId, []);
			}
		}
	}

	return historicalMap;
}

/**
 * Busca os últimos N starts no rpscrape_results pra os cavalos solicitados.
 * Retorna Map<id_horse, RpscrapeHistoricalRecord[]> ordenado por race_date DESC.
 *
 * Estratégia: JOIN com race_horses_hr_enriched pra resolver id_horse → race_horse_id
 * (que é a FK no rpscrape_results). Só considera linhas com match_status='matched'.
 *
 * Caveat: cobertura é 60-88% por ano. Cavalos sem dado → array vazio, extractor
 * cai em defaults neutros.
 */
async function fetchRpscrapeHistoricalForHorses(
	supabase: SupabaseClient,
	horseIds: number[],
	beforeDate: string,
): Promise<Map<number, RpscrapeHistoricalRecord[]>> {
	const out = new Map<number, RpscrapeHistoricalRecord[]>();
	if (horseIds.length === 0) return out;

	const uniqueIds = [...new Set(horseIds)];
	const chunkSize = 50;

	for (let i = 0; i < uniqueIds.length; i += chunkSize) {
		const chunk = uniqueIds.slice(i, i + chunkSize);

		// Step 1: descobre race_horse_id → id_horse mapping
		const rhRecords = await withSupabaseRetry(
			async () =>
				await supabase
					.schema(getDataSchema())
					.from("race_horses_hr_enriched")
					.select("id, id_horse")
					.in("id_horse", chunk),
			`fetchRpscrapeHistorical - rh ids chunk ${i / chunkSize}`,
		);
		if (!rhRecords || rhRecords.length === 0) continue;

		const rhIdToHorseId = new Map<number, number>();
		for (const r of rhRecords) rhIdToHorseId.set(r.id, r.id_horse);
		const rhIds = rhRecords.map((r) => r.id);

		// Step 2: busca rpscrape rows pra esses race_horse_id (antes da currentRace)
		const rpsRows = await withSupabaseRetry(
			async () =>
				await supabase
					.schema(getDataSchema())
					.from("rpscrape_results")
					.select(
						"race_horse_id, race_date, comment, ovr_btn, secs, rpr_rating, ts_rating, dist_f",
					)
					.in("race_horse_id", rhIds)
					.eq("match_status", "matched")
					.lt("race_date", beforeDate)
					.order("race_date", { ascending: false }),
			`fetchRpscrapeHistorical - rps rows chunk ${i / chunkSize}`,
		);

		if (!rpsRows) continue;

		// Step 3: agrupa por id_horse, limita a 10 mais recentes (extractor pega 5)
		for (const row of rpsRows) {
			const horseId = rhIdToHorseId.get(row.race_horse_id);
			if (horseId == null) continue;
			if (!out.has(horseId)) out.set(horseId, []);
			const arr = out.get(horseId)!;
			if (arr.length < 10) arr.push(row as RpscrapeHistoricalRecord);
		}
	}

	return out;
}

/**
 * Enriquecer registros de cavalos com dados das corridas
 * NOTA: Esta função não é mais chamada por fetchHistoricalDataForHorses (otimização #3),
 * que agora faz o enrichment em batch. Mantida para uso em outros contextos se necessário.
 */
async function enrichWithRaceData(
	supabase: SupabaseClient,
	horseRecords: any[],
	beforeDate?: string,
): Promise<HistoricalRaceData[]> {
	if (!horseRecords || horseRecords.length === 0) {
		return [];
	}

	// Obter IDs únicos de racecards
	const racecardIds = [...new Set(horseRecords.map((h) => h.racecard_id))];

	// Buscar dados das corridas
	let raceQuery = supabase
		.schema(getDataSchema())
		.from("racecards_hr_enriched")
		.select(
			"id, date, course, distance, going, class, finished, canceled, title, prize, id_race, off_time_br",
		)
		.in("id", racecardIds)
		.eq("finished", 1)
		.eq("canceled", 0);

	// Adicionar filtro de data se fornecido
	if (beforeDate) {
		raceQuery = raceQuery.lt("date", beforeDate);
	}

	const { data: raceData, error: raceError } = await raceQuery;

	if (raceError) {
		console.error("Error fetching race data:", raceError);
		return [];
	}

	// Criar mapa de corridas
	const raceMap = new Map<number, any>();
	(raceData || []).forEach((race) => {
		raceMap.set(race.id, race);
	});

	// Combinar dados e filtrar por corridas válidas
	const historicalData: HistoricalRaceData[] = [];

	for (const horse of horseRecords) {
		const race = raceMap.get(horse.racecard_id);
		if (!race) continue; // Pular se não encontrar a corrida

		historicalData.push({
			horse: {
				id: horse.id,
				id_horse: horse.id_horse,
				horse: horse.horse,
				position: horse.position,
				or_rating: horse.or_rating,
				sp_decimal: horse.sp_decimal,
				weight: horse.weight,
				distance_beaten: horse.distance_beaten,
				non_runner: horse.non_runner,
				age: horse.age,
				jockey: horse.jockey,
				trainer: horse.trainer,
				form: horse.form,
				racecard_id: horse.racecard_id,
				number: horse.number || null,
				dam: horse.dam || null,
				sire: horse.sire || null,
				owner: horse.owner || null,
				last_ran_days_ago: horse.last_ran_days_ago || null,
				sp: horse.sp || null,
			} as RaceHorseEnriched,
			race: {
				id: race.id,
				date: race.date,
				course: race.course,
				distance: race.distance,
				going: race.going,
				class: race.class,
				finished: race.finished,
				canceled: race.canceled,
				title: race.title || "",
				prize: race.prize || "",
				id_race: race.id_race || "",
				off_time_br: race.off_time_br || "",
				age: race.age || null,
				finish_time: race.finish_time || null,
			} as RaceCardEnriched,
		});
	}

	// Ordenar por data (mais recente primeiro)
	historicalData.sort((a, b) => {
		const dateA = new Date(a.race.date).getTime();
		const dateB = new Date(b.race.date).getTime();
		return dateB - dateA;
	});

	return historicalData;
}

async function saveTrainingFeaturesToDatabase(
	supabase: SupabaseClient,
	features: HorseFeatures[],
): Promise<void> {
	const records = features.map((f) => ({
		race_horse_id: f.race_horse_id,
		race_id: f.race_id,
		horse_id: f.horse_id,
		features: f,
		target: f.target,
		finish_position: f.finish_position,
		generated_at: new Date().toISOString(),
		model_version: "v5.0",
		quality_score: calculateFeatureQuality(f),
		race_date: f.race_date,
		race_type: f.race_type || null,
	}));

	// FIX: salvar em chunks de 100 em vez de tudo de uma vez
	const chunkSize = 50;
	const maxRetries = 3;

	for (let i = 0; i < records.length; i += chunkSize) {
		const chunk = records.slice(i, i + chunkSize);
		let attempts = 0;
		let saved = false;

		while (attempts < maxRetries && !saved) {
			const { error } = await supabase
				.schema(getOutputSchema())
				.from("training_enriched_horse_features")
				.upsert(chunk, {
					onConflict: "race_horse_id,model_version",
					ignoreDuplicates: false,
				});

			if (error) {
				if (error.code === "57014") {
					attempts++;
					console.warn(
						`! Timeout ao salvar chunk ${i}-${i + chunkSize}, tentativa ${attempts}/${maxRetries}...`,
					);
					await new Promise((resolve) => setTimeout(resolve, 2000 * attempts));
					continue;
				}
				console.error("Error saving training features:", error);
				throw error;
			}

			saved = true;
		}

		if (!saved) {
			console.error(
				`❌ Falha ao salvar chunk ${i}-${i + chunkSize} após ${maxRetries} tentativas`,
			);
			throw new Error("Timeout persistente ao salvar features");
		}
	}

	console.log(`Saved ${records.length} training features to database`);
}

/**
 * Save PREDICTION features to database
 */
async function savePredictionFeaturesToDatabase(
	supabase: SupabaseClient,
	features: HorseFeatures[],
	raceDate: Date,
): Promise<void> {
	const records = features.map((f) => ({
		race_horse_id: f.race_horse_id,
		race_id: f.race_id,
		horse_id: f.horse_id,
		features: f, // JSONB com todas as features
		predicted_probability: null, // Será preenchido quando rodar o modelo ML
		lay_recommendation: null, // Será preenchido quando rodar o modelo ML
		race_date: raceDate.toISOString().split("T")[0], // Apenas data
		generated_at: new Date().toISOString(),
		model_version: "v5.0",
		quality_score: calculateFeatureQuality(f),
		prediction_status: "PENDING",
	}));

	// Salvar na tabela de PREDIÇÃO
	const { error } = await supabase
		.schema(getOutputSchema())
		.from("prediction_enriched_horse_features")
		.upsert(records, {
			onConflict: "race_horse_id,model_version",
			ignoreDuplicates: false,
		});

	if (error) {
		console.error("Error saving prediction features:", error);
		throw error;
	}

	console.log(`Saved ${records.length} prediction features to database`);
}

/**
 * Helper functions
 */

function parsePrize(prize: string | null): number {
	if (!prize) return 0;
	const clean = prize.replace(/[£$€,]/g, "").trim();
	const num = Number.parseFloat(clean);
	return Number.isNaN(num) ? 0 : num;
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

	// OR rating — usar imputed que sempre existe
	if (features.or_rating_imputed > 0) quality++;
	checks++;

	// SP — crítico para mercado
	if (features.sp_decimal !== null) quality++;
	checks++;

	// Histórico de corridas
	if (features.career_runs > 0) quality++;
	checks++;

	// Form — null apenas para estreantes
	if (features.form_last_position !== null) quality++;
	checks++;

	// Jóquei — checar se tem histórico, não se tem vitórias
	if (features.jockey_total_runs > 0) quality++;
	checks++;

	return checks > 0 ? quality / checks : 0;
}

// ============================================================================
// JOCKEY / TRAINER STATS
// ============================================================================

// Tipos para o map de stats
interface RiderStat {
	runs: number;
	wins: number;
	places: number;
	byCourse: Map<string, { runs: number; wins: number }>;
	byDistance: Map<number, { runs: number; wins: number }>;
	recent: Array<{ date: string; position: number }>;
}

export interface JockeyTrainerStatsMap {
	jockeys: Map<string, RiderStat>;
	trainers: Map<string, RiderStat>;
}

async function fetchJockeyTrainerStats(
	supabase: SupabaseClient,
	beforeDate: string,
): Promise<JockeyTrainerStatsMap> {
	// ⚡ OTIMIZAÇÃO #2: verificar cache antes de qualquer query
	if (jockeyTrainerStatsCache.has(beforeDate)) {
		console.log(`📋 Cache hit: jockey/trainer stats (${beforeDate})`);
		return jockeyTrainerStatsCache.get(beforeDate)!;
	}

	console.log(
		`🔍 Buscando jockey/trainer stats (${beforeDate}) — sem cache, executando queries...`,
	);

	// Query 1: buscar corridas filtradas por data com Retry
	const raceRows = await withSupabaseRetry(async () => {
		return await supabase
			.schema(getDataSchema())
			.from("racecards_hr_enriched")
			.select("id, date, course, distance")
			.lt("date", beforeDate)
			.eq("finished", 1)
			.eq("canceled", 0);
	}, "fetchJockeyTrainerStats - initial races");

	if (!raceRows || raceRows.length === 0) {
		return { jockeys: new Map(), trainers: new Map() };
	}

	// Criar mapa de corridas por id
	const raceMap = new Map<
		number,
		{ date: string; course: string; distance: string }
	>();
	for (const race of raceRows) {
		raceMap.set(race.id, {
			date: race.date,
			course: race.course,
			distance: race.distance,
		});
	}

	const validRaceIds = [...raceMap.keys()];
	const chunkSize = 500;
	const allHorseRows: any[] = [];

	// Query 2: buscar cavalos em chunks com Retry individual por pedaço
	for (let i = 0; i < validRaceIds.length; i += chunkSize) {
		const chunk = validRaceIds.slice(i, i + chunkSize);

		const horseChunk = await withSupabaseRetry(
			async () => {
				return await supabase
					.schema(getDataSchema())
					.from("race_horses_hr_enriched")
					.select("jockey, trainer, position, racecard_id")
					.in("racecard_id", chunk)
					.not("position", "is", null)
					.gt("position", 0)
					.neq("non_runner", 1);
			},
			`fetchJockeyTrainerStats - horse chunk ${i / chunkSize + 1}`,
		);

		if (horseChunk) {
			allHorseRows.push(...horseChunk);
		} else {
			// Se um chunk falhar mesmo após retries, avisamos no log mas continuamos os outros
			console.warn(
				`! Pulando chunk começando em ${i} devido a falhas persistentes.`,
			);
		}
	}

	// ⚡ OTIMIZAÇÃO #2: salvar no cache antes de retornar
	const result = buildJockeyTrainerMaps(allHorseRows, raceMap);
	jockeyTrainerStatsCache.set(beforeDate, result);
	console.log(
		`💾 Jockey/trainer stats cacheados para ${beforeDate} (${allHorseRows.length} registros processados)`,
	);
	return result;
}

function buildJockeyTrainerMaps(
	horseRows: any[],
	raceMap: Map<number, { date: string; course: string; distance: string }>,
): JockeyTrainerStatsMap {
	const jockeys = new Map<string, RiderStat>();
	const trainers = new Map<string, RiderStat>();

	const initStat = (): RiderStat => ({
		runs: 0,
		wins: 0,
		places: 0,
		byCourse: new Map(),
		byDistance: new Map(),
		recent: [],
	});

	const updateStat = (
		map: Map<string, RiderStat>,
		key: string | null | undefined,
		position: number,
		course: string,
		distance: string,
		date: string,
	) => {
		if (!key) return;
		if (!map.has(key)) map.set(key, initStat());
		const stat = map.get(key)!;

		stat.runs++;
		if (position === 1) stat.wins++;
		if (position <= 3) stat.places++;

		// Por pista
		const cs = stat.byCourse.get(course) || { runs: 0, wins: 0 };
		cs.runs++;
		if (position === 1) cs.wins++;
		stat.byCourse.set(course, cs);

		// Por distância (banda de 200m)
		const meters = parseDistanceToMeters(distance);
		const band = Math.round(meters / 200) * 200;
		const ds = stat.byDistance.get(band) || { runs: 0, wins: 0 };
		ds.runs++;
		if (position === 1) ds.wins++;
		stat.byDistance.set(band, ds);

		// Recent — guardamos todas e depois cortamos
		stat.recent.push({ date, position });
	};

	for (const row of horseRows) {
		const race = raceMap.get(row.racecard_id);
		if (!race) continue; // corrida fora do range de datas — ignorar

		updateStat(
			jockeys,
			row.jockey,
			row.position,
			race.course,
			race.distance,
			race.date,
		);
		updateStat(
			trainers,
			row.trainer,
			row.position,
			race.course,
			race.distance,
			race.date,
		);
	}

	// Ordenar recent por data desc e manter só 30
	for (const stat of [...jockeys.values(), ...trainers.values()]) {
		stat.recent = stat.recent
			.sort((a, b) => b.date.localeCompare(a.date))
			.slice(0, 30);
	}

	return { jockeys, trainers };
}

async function fetchOddsForRace(
	supabase: SupabaseClient,
	raceId: number,
): Promise<Map<number, number>> {
	// Retorna Map<race_horse_id, avg_odd>

	const { data, error } = await supabase
		.schema(getDataSchema())
		.from("odds_enriched")
		.select("race_horse_id, odd, last_update")
		.in(
			"race_horse_id",
			// Subquery: buscar os race_horse_ids desta corrida
			(
				await supabase
					.schema(getDataSchema())
					.from("race_horses_hr_enriched")
					.select("id")
					.eq("racecard_id", raceId)
			).data?.map((r) => r.id) || [],
		);

	if (error) {
		console.error(`Error fetching odds for race ${raceId}:`, error);
		return new Map();
	}

	// Agrupar por race_horse_id e calcular média das odds mais recentes
	const oddsMap = new Map<number, number[]>();
	for (const row of data || []) {
		if (!oddsMap.has(row.race_horse_id)) {
			oddsMap.set(row.race_horse_id, []);
		}
		oddsMap.get(row.race_horse_id)!.push(Number(row.odd));
	}

	// Calcular média por cavalo
	const avgOddsMap = new Map<number, number>();
	oddsMap.forEach((odds, horseId) => {
		const avg = odds.reduce((sum, o) => sum + o, 0) / odds.length;
		avgOddsMap.set(horseId, avg);
	});

	return avgOddsMap;
}

async function processRaceForPrediction(
	supabase: SupabaseClient,
	race: RaceCardEnriched,
	thresholds: QualityThresholds,
): Promise<HorseFeatures[]> {
	const horses = await fetchHorsesForRace(supabase, race.id);

	const validation = validateRace(race, horses, thresholds);
	if (!validation.isValid) {
		console.warn(
			`Race ${race.id_race} failed validation:`,
			validation.errors,
			`quality=${validation.qualityScore.toFixed(2)}`,
			validation.warnings,
		);
		return [];
	}

	// Buscar odds pré-corrida e injetar nos cavalos
	const oddsMap = await fetchOddsForRace(supabase, race.id);

	// Injetar odds nos cavalos — sp e sp_decimal ficam disponíveis para as features
	const horsesWithOdds = horses.map((h) => {
		const avgOdd = oddsMap.get(h.id);
		if (avgOdd) {
			return {
				...h,
				sp_decimal: avgOdd,
				sp: String(avgOdd),
			};
		}
		return h;
	});

	const processedRace = convertRace(race, horsesWithOdds);
	const processedHorses = horsesWithOdds
		.filter((h) => h.non_runner !== 1)
		.map((h) => convertHorse(h));

	const historicalData = await fetchHistoricalDataForHorses(
		supabase,
		horsesWithOdds.map((h) => h.id_horse),
		race.date,
	);

	const rpscrapeHistorical = await fetchRpscrapeHistoricalForHorses(
		supabase,
		horsesWithOdds.map((h) => h.id_horse),
		race.date,
	);

	const jockeyTrainerStats = await fetchJockeyTrainerStats(supabase, race.date);

	const features: HorseFeatures[] = [];

	for (let i = 0; i < processedHorses.length; i++) {
		const processedHorse = processedHorses[i];
		const rawHorse = horsesWithOdds.find((h) => h.id === processedHorse.id);
		if (!rawHorse) continue;

		try {
			const horseFeatures = await generateHorseFeatures(
				processedHorse,
				rawHorse,
				processedRace,
				processedHorses,
				horsesWithOdds,
				historicalData.get(rawHorse.id_horse) || [],
				rpscrapeHistorical.get(rawHorse.id_horse) || [],
				false, // isFinishedRace = false → target = null
				jockeyTrainerStats,
			);
			features.push(horseFeatures);
		} catch (error) {
			console.error(
				`Error generating features for horse ${rawHorse.horse}:`,
				error,
			);
		}
	}

	// 2ª passada: field-level pace features
	const horseStyles = features.map((f) => f.run_style_mode_recent_5);
	const fieldPace = extractFieldPaceFeatures(horseStyles);
	for (const f of features) {
		f.field_pace_pressure = fieldPace.field_pace_pressure;
		f.is_lone_speed = fieldPace.is_lone_speed as 0 | 1;
		f.field_count_E = fieldPace.field_count_E;
		f.field_count_EP = fieldPace.field_count_EP;
		f.field_count_P = fieldPace.field_count_P;
		f.field_count_S = fieldPace.field_count_S;
		f.pace_match_score = paceMatchScore(f.run_style_mode_recent_5, fieldPace);
	}

	return features;
}
