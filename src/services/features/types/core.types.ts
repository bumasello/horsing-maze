// src/types/core.types.ts

// ===== TIPOS BASE DE DADOS =====
export interface RaceCardEnriched {
  id: number;
  id_race: string;
  course: string;
  date: string;
  off_time_br: string | null;
  title: string | null;
  distance: string;
  age: number | null;
  going: string | null;
  finished: 1 | 0;
  canceled: 1 | 0;
  finish_time: string | null;
  prize: string | null;
  class: number | null;
  race_type: string | null;
  surface: string | null;
}

export interface RaceHorseEnriched {
  id: number;
  racecard_id: number;
  horse: string;
  id_horse: number;
  jockey: string | null;
  trainer: string;
  age: number | null;
  weight: string | null;
  number: number | null;
  last_ran_days_ago: number | null;
  non_runner: 1 | 0;
  form: string | null;
  position: number | null;
  distance_beaten: string | null;
  owner: string | null;
  sire: string | null;
  dam: string | null;
  or_rating: number | null;
  sp: string | null;
}

// ===== TIPOS PROCESSADOS =====
export interface ProcessedRace {
  // Dados originais
  id: number;
  race_id: string;
  course: string;
  date: string;
  race_type?: string;
  surface?: string;
  surface_encoded: number;

  // Dados convertidos
  distance_meters: number;
  going_encoded: number;
  race_class: number | null;
  total_prize_numeric: number;

  // Metadados da corrida
  total_runners: number;
  valid_finishers: number;
  avg_or_rating: number;
  field_quality_std: number;
}

export interface ProcessedHorse {
  // Identificação
  id: number;
  race_id: number;
  horse_id: number;
  horse_name: string;

  // Dados convertidos
  weight_kg: number | null;
  sp_decimal: number | null;
  distance_beaten_lengths: number;

  // Form parseado
  form_data: ParsedForm;

  // Flags de qualidade
  has_or_rating: boolean;
  has_valid_sp: boolean;
  has_form: boolean;
}

export interface ParsedForm {
  figures: number[]; // [1,2,3,4] - posições
  indicators: string[]; // ['F', 'P'] - fell, pulled up
  recent_figures: number[]; // Últimas 3 corridas
  avg_position: number | null;
  consistency_score: number; // 0-1, baseado na variância
  is_improving: boolean;
  has_problems: boolean; // Fell, unseated, etc
}

// ===== FEATURES PARA ML =====
export interface HorseFeatures {
  // === Identificadores ===
  race_horse_id: number;
  race_id: number;
  race_date: string;
  horse_id: number;
  race_type?: string;
  surface_encoded: number;

  // === Static — cavalo ===
  horse_age: number | null;
  horse_weight_kg: number | null;
  days_since_last_run: number;
  horse_number: number | null;
  race_total_prize: number;

  // === Static — corrida ===
  race_distance_meters: number;
  race_going_encoded: number;
  race_class: number | null;
  race_field_size: number;

  // === Static — flags derivadas ===
  is_juvenile: number;
  is_3yo: number;
  is_mature: number;
  is_fresh: number;
  is_quick_backup: number;
  is_normal_rest: number;
  is_small_field: number;
  is_large_field: number;
  is_sprint: number;
  is_mile: number;
  is_middle_distance: number;
  is_long_distance: number;
  is_firm_ground: number;
  is_good_ground: number;
  is_soft_ground: number;
  is_high_class: number;
  is_mid_class: number;
  is_low_class: number;

  // === Historical — carreira ===
  career_runs: number;
  career_wins: number;
  career_places: number;
  career_win_rate: number;
  career_place_rate: number;
  career_avg_position: number;
  career_position_std: number;

  // === Historical — condições específicas ===
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

  // === Historical — recente ===
  recent_runs_30d: number;
  recent_wins_30d: number;
  recent_runs_90d: number;
  recent_wins_90d: number;
  recent_avg_position: number;

  // === Historical — tendências ===
  improvement_rate: number;
  consistency_score: number;
  peak_or_rating: number;
  avg_or_rating: number;
  total_prize_money: number;
  best_distance_meters: number;
  preferred_going: number;
  avg_days_between_runs: number;

  // === Form — básico ===
  form_last_position: number | null;
  form_last3_avg: number | null;
  form_last5_avg: number | null;
  form_consistency: number;
  form_is_improving: 0 | 1;
  form_has_problems: 0 | 1;

  // === Form — detalhado ===
  form_wins_in_last5: number;
  form_places_in_last5: number;
  form_consecutive_wins: number;
  form_consecutive_places: number;
  form_worst_recent: number | null;
  form_best_recent: number | null;

  // === Form — padrões ===
  form_trend_score: number;
  form_volatility: number;
  form_recovery_rate: number;
  form_peak_position: number;

  // === Form — qualidade ===
  form_data_quality: number;
  form_races_recorded: number;
  form_complete_finishes: number;
  form_dnf_count: number;

  // === Form — ponderado ===
  form_weighted_avg: number | null;
  form_exponential_avg: number | null;

  // === Rating ===
  or_rating: number | null;
  or_rating_imputed: number;
  or_rating_is_imputed: 0 | 1;
  or_rank_in_race: number;
  or_percentile_in_race: number;
  or_diff_to_top: number;
  or_diff_to_avg: number;

  // === Market — básico ===
  sp_decimal: number | null;
  sp_rank: number;
  sp_implied_prob: number | null;
  sp_vs_field_avg: number | null;

  // === Market — posição ===
  is_favorite: 0 | 1;
  is_joint_favorite: 0 | 1;
  is_top3_market: 0 | 1;
  is_outsider: 0 | 1;

  // === Market — campo ===
  field_total_probability: number;
  field_overround: number;
  market_confidence: number;
  sp_concentration: number;

  // === Market — valor ===
  sp_value_rating: number;
  is_overbet: 0 | 1;
  is_underbet: 0 | 1;
  market_inefficiency: number;

  // === Market — relativo ===
  sp_to_favorite_ratio: number | null;
  sp_percentile: number;
  normalized_sp: number | null;
  market_share: number | null;

  // === Competitive — campo ===
  field_avg_or: number;
  field_std_or: number;
  field_max_or: number;
  field_min_or: number;
  field_or_spread: number;

  // === Competitive — posição ===
  stronger_opponents_count: number;
  weaker_opponents_count: number;

  // === Competitive — composição ===
  field_avg_career_wins: number;
  field_avg_win_rate: number;
  field_avg_recent_position: number;
  experienced_runners_count: number;
  maiden_runners_count: number;

  // === Competitive — vantagens ===
  or_advantage_score: number;
  experience_advantage: number;
  form_advantage: number;
  weight_advantage: number;

  // === Competitive — corrida ===
  race_competitiveness_score: number;
  field_depth_score: number;
  quality_concentration: number;
  is_competitive_race: 0 | 1;

  // === Competitive — relativo ===
  better_than_field_avg: 0 | 1;
  in_top_quarter: 0 | 1;
  in_bottom_quarter: 0 | 1;

  // === Relationship — jóquei ===
  jockey_win_rate: number;
  jockey_place_rate: number;
  jockey_recent_form: number;
  jockey_course_win_rate: number;
  jockey_distance_win_rate: number;
  jockey_total_runs: number;

  // === Relationship — treinador ===
  trainer_win_rate: number;
  trainer_place_rate: number;
  trainer_recent_form: number;
  trainer_course_win_rate: number;
  trainer_distance_win_rate: number;
  trainer_total_runs: number;

  // === Relationship — combinações ===
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

  // === Relationship — owner & linhagem ===
  owner_win_rate: number;
  owner_with_trainer_win_rate: number;
  owner_total_runners: number;
  sire_win_rate: number;
  sire_distance_suitability: number;
  dam_produce_win_rate: number;

  // === Relationship — força ===
  stable_confidence: number;
  jockey_reliability: number;
  partnership_strength: number;

  // === Lay-specific ===
  out_of_top3_rate: number;
  worst_recent_position: number | null;
  position_volatility: number;
  beaten_favorite_rate: number;

  // === Pace / Run-Style (Tier 1 #3, via rpscrape histórico) ===
  pace_E_pct_recent: number;
  pace_EP_pct_recent: number;
  pace_P_pct_recent: number;
  pace_S_pct_recent: number;
  pace_dominant_style_code: number; // 0=U/none, 1=E, 2=EP, 3=P, 4=S
  pace_consistency: number;
  pace_made_all_pct: number;
  pace_held_up_pct: number;
  pace_kept_on_pct: number;
  pace_weakened_pct: number;
  pace_hung_pct: number;
  pace_rpr_avg_recent: number;
  pace_rpr_max_recent: number;
  pace_ts_avg_recent: number;
  pace_ovr_btn_avg_recent: number;
  pace_ovr_btn_min_recent: number;
  pace_data_count: number;
  // Per-race agregados (mesmo valor pra todos os cavalos da corrida)
  field_pace_pressure: number;
  field_n_early: number;
  field_n_pressers: number;
  field_n_held_up: number;
  field_is_lone_speed: number;
  pace_field_size_effective: number;
  // Interaction
  pace_match_score: number;

  // === Target ===
  target: 0 | 1 | null;
  finish_position: number | null;
}

// ===== TIPOS AUXILIARES =====
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  qualityScore: number;
}

export interface ProcessingMetadata {
  processed_at: Date;
  processing_time_ms: number;
  total_races: number;
  valid_races: number;
  rejected_races: number;
  total_horses: number;
  valid_horses: number;
  avg_quality_score: number;
}

export interface ImputationStrategy {
  or_rating: "historical" | "sp_based" | "field_avg" | "none";
  missing_form: "avg_field" | "worst_case" | "none";
}

export interface QualityThresholds {
  min_runners: number; // Default: 4
  min_or_coverage: number; // Default: 0.5 (50%)
  min_sp_coverage: number; // Default: 0.8 (80%)
  min_quality_score: number; // Default: 0.6
}

// ===== TIPOS PARA CACHE E OTIMIZAÇÃO =====
export interface HorseHistoricalCache {
  horse_id: number;
  last_updated: Date;
  total_runs: number;
  career_stats: {
    wins: number;
    places: number;
    avg_position: number;
    avg_or: number;
  };
  course_stats: Map<string, CoursePerformance>;
  recent_runs: RaceHorseEnriched[];
}

export interface CoursePerformance {
  runs: number;
  wins: number;
  places: number;
  avg_position: number;
}

export interface JockeyTrainerCache {
  jockey_stats: Map<string, JockeyStats>;
  trainer_stats: Map<string, TrainerStats>;
  combo_stats: Map<string, ComboStats>; // "jockey|trainer"
  last_updated: Date;
}

export interface JockeyStats {
  total_runs: number;
  wins: number;
  win_rate: number;
  courses: Map<string, CoursePerformance>;
}

export interface TrainerStats {
  total_runs: number;
  wins: number;
  win_rate: number;
  courses: Map<string, CoursePerformance>;
}

export interface ComboStats {
  runs: number;
  wins: number;
  win_rate: number;
}

// ===== ENUMS =====
export enum GoingCondition {
  HARD = 1,
  FAST = 2,
  FIRM = 3,
  GOOD = 4,
  GOOD_TO_FIRM = 5,
  GOOD_TO_YIELDING = 6,
  YIELDING_TO_SOFT = 7,
  YIELDING = 8,
  GOOD_TO_SOFT = 9,
  STANDARD_TO_SLOW = 10,
  STANDARD = 11,
  SOFT_HEAVY = 12,
  HEAVY = 13,
  SOFT = 14,
}

export enum DistanceBand {
  SPRINT = 1, // < 1200m
  MILE = 2, // 1200-1800m
  MIDDLE = 3, // 1800-2400m
  LONG = 4, // > 2400m
}

export enum FormIndicator {
  FELL = "F",
  UNSEATED = "U",
  PULLED_UP = "P",
  REFUSED = "R",
  BROUGHT_DOWN = "B",
  CARRIED_OUT = "C",
  DISQUALIFIED = "D",
}
