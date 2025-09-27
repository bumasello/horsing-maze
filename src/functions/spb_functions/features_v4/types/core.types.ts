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

  // Dados convertidos
  distance_meters: number;
  going_encoded: number;
  race_class: number;
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
  horse_id: number;

  // === Features Estáticas (da corrida atual) ===
  // Cavalo
  horse_age: number | null;
  horse_weight_kg: number | null;
  days_since_last_run: number;

  // Corrida
  race_distance_meters: number;
  race_going_encoded: number;
  race_class: number | null;
  race_field_size: number;

  // === Features de Performance Histórica ===
  // Carreira geral
  career_runs: number;
  career_wins: number;
  career_places: number;
  career_win_rate: number;
  career_place_rate: number;
  career_avg_position: number;
  career_position_std: number;

  // Condições específicas
  course_runs: number;
  course_win_rate: number;
  distance_band_runs: number; // ±10% da distância atual
  distance_band_win_rate: number;
  going_runs: number;
  going_win_rate: number;

  // === Features de Form Recente ===
  form_last_position: number | null;
  form_last3_avg: number | null;
  form_last5_avg: number | null;
  form_consistency: number;
  form_is_improving: 0 | 1;
  form_has_problems: 0 | 1;

  // === Features de Rating ===
  or_rating: number | null;
  or_rating_imputed: number; // Sempre preenchido
  or_rating_is_imputed: 0 | 1; // Flag
  or_rank_in_race: number;
  or_percentile_in_race: number;
  or_diff_to_top: number;

  // === Features de Mercado (SP) ===
  sp_decimal: number | null;
  sp_rank: number;
  sp_implied_prob: number | null;
  sp_vs_field_avg: number | null;

  // === Features de Contexto Competitivo ===
  field_avg_or: number;
  field_std_or: number;
  field_avg_career_wins: number;
  stronger_opponents_count: number; // Quantos com OR maior

  // === Features de Relacionamento ===
  jockey_win_rate: number;
  jockey_course_win_rate: number;
  jockey_with_horse_runs: number;
  jockey_with_horse_win_rate: number;
  trainer_win_rate: number;
  trainer_course_win_rate: number;
  jockey_trainer_combo_runs: number;
  jockey_trainer_combo_win_rate: number;

  // === Features Específicas para Lay ===
  out_of_top3_rate: number;
  worst_recent_position: number | null;
  position_volatility: number;
  beaten_favorite_rate: number; // Vezes que foi favorito e perdeu

  // === Target ===
  target: 0 | 1 | null; // 0 = ganhou (ruim para lay), 1 = não ganhou (bom para lay)
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
