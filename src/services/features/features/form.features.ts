// features_v4/features/form.features.ts

import { parseForm } from "../converters/form.parser";
import type {
  ParsedForm,
  ProcessedHorse,
  RaceHorseEnriched,
} from "../types/core.types";

/**
 * Interface for form-based features
 */
export interface FormFeatures {
  // Basic form metrics
  form_last_position: number | null;
  form_last3_avg: number | null;
  form_last5_avg: number | null;
  form_consistency: number;
  form_is_improving: 0 | 1;
  form_has_problems: 0 | 1;

  // Detailed form analysis
  form_wins_in_last5: number;
  form_places_in_last5: number;
  form_consecutive_wins: number;
  form_consecutive_places: number;
  form_worst_recent: number | null;
  form_best_recent: number | null;

  // Form patterns
  form_trend_score: number;
  form_volatility: number;
  form_recovery_rate: number;
  form_peak_position: number;

  // Form quality indicators
  form_data_quality: number;
  form_races_recorded: number;
  form_complete_finishes: number;
  form_dnf_count: number;

  // Weighted form (recent races weighted more)
  form_weighted_avg: number | null;
  form_exponential_avg: number | null;
}

/**
 * Extract form features from horse data
 */
export function extractFormFeatures(
  horse: ProcessedHorse,
  rawHorse: RaceHorseEnriched,
): FormFeatures {
  // Parse form if not already parsed
  const formData = horse.form_data || parseForm(rawHorse.form);

  // Basic form metrics
  const basicMetrics = extractBasicFormMetrics(formData);

  // Detailed analysis
  const detailedAnalysis = extractDetailedFormAnalysis(formData);

  // Form patterns
  const patterns = extractFormPatterns(formData);

  // Quality indicators
  const quality = extractFormQuality(formData);

  // Weighted averages
  const weighted = calculateWeightedFormAverages(formData);

  return {
    // Basic form metrics
    form_last_position: basicMetrics.form_last_position ?? null,
    form_last3_avg: basicMetrics.form_last3_avg ?? null,
    form_last5_avg: basicMetrics.form_last5_avg ?? null,
    form_consistency: basicMetrics.form_consistency ?? 0,
    form_is_improving: basicMetrics.form_is_improving ?? 0,
    form_has_problems: basicMetrics.form_has_problems ?? 0,

    // Detailed analysis
    form_wins_in_last5: detailedAnalysis.form_wins_in_last5 ?? 0,
    form_places_in_last5: detailedAnalysis.form_places_in_last5 ?? 0,
    form_consecutive_wins: detailedAnalysis.form_consecutive_wins ?? 0,
    form_consecutive_places: detailedAnalysis.form_consecutive_places ?? 0,
    form_worst_recent: detailedAnalysis.form_worst_recent ?? null,
    form_best_recent: detailedAnalysis.form_best_recent ?? null,

    // Form patterns
    form_trend_score: patterns.form_trend_score ?? 0,
    form_volatility: patterns.form_volatility ?? 0,
    form_recovery_rate: patterns.form_recovery_rate ?? 0,
    form_peak_position: patterns.form_peak_position ?? 10,

    // Quality indicators
    form_data_quality: quality.form_data_quality ?? 0,
    form_races_recorded: quality.form_races_recorded ?? 0,
    form_complete_finishes: quality.form_complete_finishes ?? 0,
    form_dnf_count: quality.form_dnf_count ?? 0,

    // Weighted averages
    form_weighted_avg: weighted.form_weighted_avg ?? null,
    form_exponential_avg: weighted.form_exponential_avg ?? null,
  };
}

/**
 * Extract basic form metrics
 */
function extractBasicFormMetrics(form: ParsedForm): Partial<FormFeatures> {
  const { figures, recent_figures } = form;

  const last3Avg =
    recent_figures.length > 0
      ? recent_figures.reduce((sum, p) => sum + p, 0) / recent_figures.length
      : null;

  const last5Avg =
    figures.length >= 5
      ? figures.slice(-5).reduce((sum, p) => sum + p, 0) / 5
      : figures.length > 0
        ? figures.reduce((sum, p) => sum + p, 0) / figures.length
        : null;

  return {
    form_last_position: recent_figures[recent_figures.length - 1] ?? null, // FIX 1: último = mais recente
    form_last3_avg: last3Avg,
    form_last5_avg: last5Avg,
    form_consistency: form.consistency_score,
    form_is_improving: form.is_improving ? 1 : 0,
    form_has_problems: form.has_problems ? 1 : 0,
  };
}

/**
 * Extract detailed form analysis
 */
function extractDetailedFormAnalysis(form: ParsedForm): Partial<FormFeatures> {
  const { figures } = form;

  if (figures.length === 0) {
    return {
      form_wins_in_last5: 0,
      form_places_in_last5: 0,
      form_consecutive_wins: 0,
      form_consecutive_places: 0,
      form_worst_recent: null,
      form_best_recent: null,
    };
  }

  // FIX 1: slice(-5) para pegar os 5 mais recentes
  const last5 = figures.slice(-5);
  const winsInLast5 = last5.filter((p) => p === 1).length;
  const placesInLast5 = last5.filter((p) => p <= 3).length;

  // FIX 1: iterar do mais recente para o mais antigo
  const reversed = [...figures].reverse();

  let consecutiveWins = 0;
  for (const position of reversed) {
    if (position === 1) consecutiveWins++;
    else break;
  }

  let consecutivePlaces = 0;
  for (const position of reversed) {
    if (position <= 3) consecutivePlaces++;
    else break;
  }

  // FIX 1: slice(-5) para worst/best recentes
  const recentPositions = figures.slice(-5);
  const worstRecent =
    recentPositions.length > 0 ? Math.max(...recentPositions) : null;
  const bestRecent =
    recentPositions.length > 0 ? Math.min(...recentPositions) : null;

  return {
    form_wins_in_last5: winsInLast5,
    form_places_in_last5: placesInLast5,
    form_consecutive_wins: consecutiveWins,
    form_consecutive_places: consecutivePlaces,
    form_worst_recent: worstRecent,
    form_best_recent: bestRecent,
  };
}

/**
 * Extract form patterns and trends
 */
function extractFormPatterns(form: ParsedForm): Partial<FormFeatures> {
  const { figures } = form;

  if (figures.length < 2) {
    return {
      form_trend_score: 0,
      form_volatility: 0,
      form_recovery_rate: 0,
      form_peak_position: figures[0] || 10,
    };
  }

  // Calculate trend score (improvement over time)
  const trendScore = calculateTrendScore(figures);

  // Calculate volatility (standard deviation of positions)
  const volatility = calculateVolatility(figures);

  // Calculate recovery rate (how quickly bounces back from poor runs)
  const recoveryRate = calculateRecoveryRate(figures);

  // Find peak position (best ever)
  const peakPosition = Math.min(...figures);

  return {
    form_trend_score: trendScore,
    form_volatility: volatility,
    form_recovery_rate: recoveryRate,
    form_peak_position: peakPosition,
  };
}

/**
 * Calculate trend score from positions
 */
function calculateTrendScore(positions: number[]): number {
  if (positions.length < 2) return 0;

  // Use linear regression to find trend
  const n = positions.length;
  const indices = Array.from({ length: n }, (_, i) => i);

  // Calculate means
  const xMean = indices.reduce((sum, x) => sum + x, 0) / n;
  const yMean = positions.reduce((sum, y) => sum + y, 0) / n;

  // Calculate slope
  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (positions[i] - yMean);
    denominator += Math.pow(i - xMean, 2);
  }

  if (denominator === 0) return 0;

  const slope = numerator / denominator;

  // Negative slope means improving (lower positions are better)
  // Normalize to -1 to 1 scale
  return Math.max(-1, Math.min(1, -slope / 2));
}

/**
 * Calculate form volatility
 */
function calculateVolatility(positions: number[]): number {
  if (positions.length < 2) return 0;

  const mean = positions.reduce((sum, p) => sum + p, 0) / positions.length;
  const variance =
    positions.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) /
    positions.length;
  const stdDev = Math.sqrt(variance);

  // Normalize to 0-1 scale (assuming max std dev of 5)
  return Math.min(1, stdDev / 5);
}

/**
 * Calculate recovery rate from poor performances
 */
function calculateRecoveryRate(positions: number[]): number {
  if (positions.length < 3) return 0.5;

  const recoveries: number[] = [];

  // positions ordenado do mais antigo para o mais recente
  // positions[i] = corrida ruim, positions[i+1] = corrida seguinte
  for (let i = 0; i < positions.length - 1; i++) {
    if (positions[i] > 5) {
      const recovery = (positions[i] - positions[i + 1]) / positions[i];
      recoveries.push(Math.max(0, recovery));
    }
  }

  if (recoveries.length === 0) return 0.5;
  return recoveries.reduce((sum, r) => sum + r, 0) / recoveries.length;
}

/**
 * Extract form quality indicators
 */
function extractFormQuality(form: ParsedForm): Partial<FormFeatures> {
  const { figures, indicators } = form;

  // Count different types of results
  const completeFinishes = figures.filter((p) => p > 0 && p <= 10).length;
  const dnfCount = indicators.length;

  // Calculate data quality score (0-1)
  const totalRaces = figures.length + indicators.length;
  const dataQuality = totalRaces > 0 ? completeFinishes / totalRaces : 0;

  return {
    form_data_quality: dataQuality,
    form_races_recorded: totalRaces,
    form_complete_finishes: completeFinishes,
    form_dnf_count: dnfCount,
  };
}

/**
 * Calculate weighted form averages
 */
function calculateWeightedFormAverages(
  form: ParsedForm,
): Partial<FormFeatures> {
  const { figures } = form;

  if (figures.length === 0) {
    return { form_weighted_avg: null, form_exponential_avg: null };
  }

  // Peso maior para os mais recentes (últimos no array)
  let weightedSum = 0;
  let weightSum = 0;

  for (let i = 0; i < figures.length; i++) {
    const weight = i + 1; // i=0 (mais antigo) peso 1, i=n-1 (mais recente) peso n
    weightedSum += figures[i] * weight;
    weightSum += weight;
  }

  const weightedAvg = weightSum > 0 ? weightedSum / weightSum : null;

  // EMA: começa do mais antigo e converge para o mais recente
  const alpha = 0.7;
  let ema = figures[0];
  for (let i = 1; i < figures.length; i++) {
    ema = alpha * figures[i] + (1 - alpha) * ema;
  }

  return { form_weighted_avg: weightedAvg, form_exponential_avg: ema };
}

/**
 * Analyze form string for specific patterns
 */
export function analyzeFormPatterns(formString: string): {
  hasWinningStreak: boolean;
  hasLosingStreak: boolean;
  isErratic: boolean;
  isConsistent: boolean;
  hasDNFIssues: boolean;
} {
  const form = parseForm(formString);
  const reversed = [...form.figures].reverse();

  let winStreak = 0;
  for (const fig of reversed) {
    if (fig === 1) winStreak++;
    else break;
  }

  let loseStreak = 0;
  for (const fig of reversed) {
    if (fig > 5) loseStreak++;
    else break;
  }

  const volatility =
    form.figures.length > 1 ? calculateVolatility(form.figures) : 0;
  const isErratic = volatility > 0.7;
  const isConsistent = form.consistency_score > 0.7;
  const hasDNFIssues = form.indicators.length > 1;

  return {
    hasWinningStreak: winStreak >= 3,
    hasLosingStreak: loseStreak >= 3,
    isErratic,
    isConsistent,
    hasDNFIssues,
  };
}

/**
 * Calculate form rating (0-100)
 */
export function calculateFormRating(features: FormFeatures): number {
  let rating = 50; // Base rating

  // Positive factors
  if (features.form_last_position === 1) rating += 15;
  else if (features.form_last_position && features.form_last_position <= 3)
    rating += 10;

  if (features.form_wins_in_last5 > 0)
    rating += features.form_wins_in_last5 * 5;
  if (features.form_places_in_last5 > 2) rating += 5;

  if (features.form_is_improving) rating += 10;
  if (features.form_consecutive_wins > 0)
    rating += features.form_consecutive_wins * 3;

  if (features.form_consistency > 0.7) rating += 10;
  if (features.form_trend_score > 0.5) rating += 10;

  // Negative factors
  if (features.form_has_problems) rating -= 15;
  if (features.form_volatility > 0.7) rating -= 10;
  if (features.form_dnf_count > 0) rating -= features.form_dnf_count * 5;

  if (features.form_worst_recent && features.form_worst_recent > 7)
    rating -= 10;
  if (features.form_last3_avg && features.form_last3_avg > 6) rating -= 10;

  return Math.max(0, Math.min(100, rating));
}

/**
 * Validate form features
 */
export function validateFormFeatures(features: FormFeatures): {
  isValid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Check data quality
  if (features.form_races_recorded === 0) {
    issues.push("No form data available");
  }

  if (features.form_data_quality < 0.5) {
    issues.push("Poor form data quality");
  }

  // Check for logical inconsistencies
  if (features.form_consecutive_wins > features.form_races_recorded) {
    issues.push("Consecutive wins exceed total races");
  }

  if (
    features.form_best_recent !== null &&
    features.form_worst_recent !== null &&
    features.form_best_recent > features.form_worst_recent
  ) {
    issues.push("Best position worse than worst position");
  }

  // Check for extreme values
  if (features.form_volatility > 0.9) {
    issues.push("Extremely volatile form");
  }

  if (features.form_dnf_count > 3) {
    issues.push("High number of DNFs");
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

/**
 * Get feature importance for form features
 */
export function getFormFeatureImportance(): Record<string, number> {
  return {
    // High importance
    form_last_position: 0.9,
    form_last3_avg: 0.85,
    form_wins_in_last5: 0.85,
    form_weighted_avg: 0.8,

    // Medium-high importance
    form_consistency: 0.75,
    form_is_improving: 0.7,
    form_consecutive_wins: 0.75,
    form_trend_score: 0.7,

    // Medium importance
    form_last5_avg: 0.65,
    form_places_in_last5: 0.6,
    form_exponential_avg: 0.65,
    form_best_recent: 0.6,

    // Lower importance
    form_volatility: 0.5,
    form_recovery_rate: 0.45,
    form_worst_recent: 0.5,
    form_has_problems: 0.55,
    form_dnf_count: 0.4,

    // Quality indicators
    form_data_quality: 0.3,
    form_races_recorded: 0.25,
    form_complete_finishes: 0.25,
  };
}

/**
 * Create form summary for reporting
 */
export function createFormSummary(features: FormFeatures): string {
  const rating = calculateFormRating(features);
  const lastPos = features.form_last_position;
  const trend = features.form_is_improving ? "improving" : "stable/declining";
  const consistency =
    features.form_consistency > 0.7
      ? "consistent"
      : features.form_consistency > 0.4
        ? "moderate"
        : "inconsistent";

  return (
    `Form Rating: ${rating}/100 | Last: ${lastPos || "N/A"} | ` +
    `Trend: ${trend} | Consistency: ${consistency} | ` +
    `Recent Wins: ${features.form_wins_in_last5}/5`
  );
}
