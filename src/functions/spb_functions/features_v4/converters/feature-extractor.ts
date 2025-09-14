// src/converters/feature-extractor.ts

import {
  ProcessedRace,
  ProcessedHorse,
  HorseFeatures,
  RaceHorseEnriched,
  HorseHistoricalCache,
  JockeyTrainerCache,
  CoursePerformance,
  ImputationStrategy,
  DistanceBand
} from '../types/core.types';
import { DistanceUtils } from './index';


export class FeatureExtractor {
  
  constructor(
    private historicalCache: HorseHistoricalCache,
    private jockeyTrainerCache: JockeyTrainerCache,
    private imputationStrategy: ImputationStrategy = {
      or_rating: 'field_avg',
      missing_form: 'avg_field'
    }
  ) {}

  /**
   * Extrai todas as features para os cavalos de uma corrida
   */
  async extractRaceFeatures(
    race: ProcessedRace, 
    horses: ProcessedHorse[], 
    rawHorses: RaceHorseEnriched[],
    historicalData: Map<number, RaceHorseEnriched[]>
  ): Promise<HorseFeatures[]> {
    
    const features: HorseFeatures[] = [];
    
    // Calcular métricas de campo para imputação
    const fieldMetrics = this.calculateFieldMetrics(horses, rawHorses);
    
    for (let i = 0; i < horses.length; i++) {
      const horse = horses[i];
      const rawHorse = rawHorses[i];
      const history = historicalData.get(horse.horse_id) || [];
      
      const horseFeatures = await this.extractHorseFeatures(
        race,
        horse,
        rawHorse,
        history,
        fieldMetrics,
        horses
      );
      
      features.push(horseFeatures);
    }
    
    return features;
  }

  /**
   * Extrai features para um cavalo específico
   */
  private async extractHorseFeatures(
    race: ProcessedRace,
    horse: ProcessedHorse,
    rawHorse: RaceHorseEnriched,
    history: RaceHorseEnriched[],
    fieldMetrics: FieldMetrics,
    allHorses: ProcessedHorse[]
  ): Promise<HorseFeatures> {
    
    // Calcular features históricas
    const careerStats = this.calculateCareerStats(history);
    const conditionStats = this.calculateConditionSpecificStats(history, race);
    const formStats = this.calculateFormStats(horse, history);
    const ratingFeatures = this.calculateRatingFeatures(rawHorse, fieldMetrics, allHorses);
    const marketFeatures = this.calculateMarketFeatures(horse, allHorses);
    const competitiveFeatures = this.calculateCompetitiveFeatures(rawHorse, allHorses, fieldMetrics);
    const relationshipFeatures = this.calculateRelationshipFeatures(rawHorse);
    const layFeatures = this.calculateLaySpecificFeatures(horse, history);
    
    return {
      // === Identificadores ===
      race_horse_id: horse.id,
      race_id: horse.race_id,
      horse_id: horse.horse_id,
      
      // === Features Estáticas ===
      horse_age: rawHorse.age,
      horse_weight_kg: horse.weight_kg,
      days_since_last_run: rawHorse.last_ran_days_ago || 999,
      
      race_distance_meters: race.distance_meters,
      race_going_encoded: race.going_encoded,
      race_class: race.race_class,
      race_field_size: race.total_runners,
      
      // === Features de Performance Histórica ===
      ...careerStats,
      ...conditionStats,
      
      // === Features de Form ===
      ...formStats,
      
      // === Features de Rating ===
      ...ratingFeatures,
      
      // === Features de Mercado ===
      ...marketFeatures,
      
      // === Features de Contexto Competitivo ===
      ...competitiveFeatures,
      
      // === Features de Relacionamento ===
      ...relationshipFeatures,
      
      // === Features para Lay ===
      ...layFeatures,
      
      // === Target ===
      target: rawHorse.position === 1 ? 0 : 1 // 0 = ganhou (ruim para lay), 1 = não ganhou (bom para lay)
    };
  }

  /**
   * Calcula estatísticas de carreira geral
   */
  private calculateCareerStats(history: RaceHorseEnriched[]): Partial<HorseFeatures> {
    const validRuns = history.filter(h => h.position && h.position > 0);
    
    if (validRuns.length === 0) {
      return {
        career_runs: 0,
        career_wins: 0,
        career_places: 0,
        career_win_rate: 0,
        career_place_rate: 0,
        career_avg_position: 10,
        career_position_std: 5
      };
    }
    
    const wins = validRuns.filter(h => h.position === 1).length;
    const places = validRuns.filter(h => h.position && h.position <= 3).length;
    const positions = validRuns.map(h => h.position!);
    const avgPosition = positions.reduce((a, b) => a + b, 0) / positions.length;
    const positionStd = this.calculateStdDev(positions);
    
    return {
      career_runs: validRuns.length,
      career_wins: wins,
      career_places: places,
      career_win_rate: wins / validRuns.length,
      career_place_rate: places / validRuns.length,
      career_avg_position: avgPosition,
      career_position_std: positionStd
    };
  }

  /**
   * Calcula estatísticas específicas por condições
   */
  private calculateConditionSpecificStats(history: RaceHorseEnriched[], race: ProcessedRace): Partial<HorseFeatures> {
    const courseRuns = history.filter(h => h.id && this.getCourseFromHistory(h) === race.course);
    const courseStats = this.calculateWinStats(courseRuns);
    
    // Distância similar (±10%)
    const distanceRuns = history.filter(h => {
      const histDistance = this.getDistanceFromHistory(h);
      return DistanceUtils.isWithinDistanceBand(histDistance, race.distance_meters, 0.1);
    });
    const distanceStats = this.calculateWinStats(distanceRuns);
    
    // Going similar
    const goingRuns = history.filter(h => this.getGoingFromHistory(h) === race.going_encoded);
    const goingStats = this.calculateWinStats(goingRuns);
    
    return {
      course_runs: courseStats.runs,
      course_win_rate: courseStats.win_rate,
      distance_band_runs: distanceStats.runs,
      distance_band_win_rate: distanceStats.win_rate,
      going_runs: goingStats.runs,
      going_win_rate: goingStats.win_rate
    };
  }

  /**
   * Calcula features de form recente
   */
  private calculateFormStats(horse: ProcessedHorse, history: RaceHorseEnriched[]): Partial<HorseFeatures> {
    const { form_data } = horse;
    
    if (!form_data || form_data.figures.length === 0) {
      return {
        form_last_position: null,
        form_last3_avg: null,
        form_last5_avg: null,
        form_consistency: 0,
        form_is_improving: 0,
        form_has_problems: 0
      };
    }
    
    const { figures } = form_data;
    
    return {
      form_last_position: figures[0] || null,
      form_last3_avg: figures.slice(0, 3).length > 0 ? 
        figures.slice(0, 3).reduce((a, b) => a + b, 0) / figures.slice(0, 3).length : null,
      form_last5_avg: figures.slice(0, 5).length > 0 ? 
        figures.slice(0, 5).reduce((a, b) => a + b, 0) / figures.slice(0, 5).length : null,
      form_consistency: form_data.consistency_score,
      form_is_improving: form_data.is_improving ? 1 : 0,
      form_has_problems: form_data.has_problems ? 1 : 0
    };
  }

  /**
   * Calcula features de rating
   */
  private calculateRatingFeatures(
    rawHorse: RaceHorseEnriched, 
    fieldMetrics: FieldMetrics,
    allHorses: ProcessedHorse[]
  ): Partial<HorseFeatures> {
    
    let orRating = rawHorse.or_rating;
    let isImputed = 0;
    
    // Imputação de OR rating se necessário
    if (!orRating || orRating <= 0) {
      orRating = this.imputeORRating(rawHorse, fieldMetrics);
      isImputed = 1;
    }
    
    // Ranking e percentis no campo
    const validRatings = allHorses
      .map(h => this.getORRating(h, fieldMetrics))
      .filter(r => r > 0)
      .sort((a, b) => b - a); // Ordenar decrescente
    
    const orRank = validRatings.indexOf(orRating!) + 1;
    const orPercentile = 1 - (orRank / validRatings.length);
    const topRating = validRatings[0] || orRating!;
    
    return {
      or_rating: rawHorse.or_rating,
      or_rating_imputed: orRating!,
      or_rating_is_imputed: isImputed,
      or_rank_in_race: orRank,
      or_percentile_in_race: orPercentile,
      or_diff_to_top: topRating - orRating!
    };
  }

  /**
   * Calcula features de mercado (SP)
   */
  private calculateMarketFeatures(horse: ProcessedHorse, allHorses: ProcessedHorse[]): Partial<HorseFeatures> {
    const sp = horse.sp_decimal;
    
    if (!sp || sp <= 0) {
      return {
        sp_decimal: null,
        sp_rank: allHorses.length,
        sp_implied_prob: null,
        sp_vs_field_avg: null
      };
    }
    
    // Ranking de SP (menor SP = melhor ranking)
    const validSPs = allHorses
      .map(h => h.sp_decimal)
      .filter(s => s && s > 0)
      .sort((a, b) => a! - b!);
    
    const spRank = validSPs.indexOf(sp) + 1;
    const impliedProb = 1 / sp;
    
    // Comparação com média do campo
    const fieldAvgSP = validSPs.reduce((a, b) => a! + b!, 0) / validSPs.length;
    const spVsFieldAvg = sp - fieldAvgSP;
    
    return {
      sp_decimal: sp,
      sp_rank: spRank,
      sp_implied_prob: impliedProb,
      sp_vs_field_avg: spVsFieldAvg
    };
  }

  /**
   * Calcula features de contexto competitivo
   */
  private calculateCompetitiveFeatures(
    rawHorse: RaceHorseEnriched,
    allHorses: ProcessedHorse[],
    fieldMetrics: FieldMetrics
  ): Partial<HorseFeatures> {
    
    const horseOR = this.getORRating(rawHorse, fieldMetrics);
    const strongerCount = allHorses.filter(h => {
      const otherOR = this.getORRating(h, fieldMetrics);
      return otherOR > horseOR;
    }).length;
    
    return {
      field_avg_or: fieldMetrics.avgOR,
      field_std_or: fieldMetrics.stdOR,
      field_avg_career_wins: fieldMetrics.avgCareerWins,
      stronger_opponents_count: strongerCount
    };
  }

  /**
   * Calcula features de relacionamentos (jockey/trainer)
   */
  private calculateRelationshipFeatures(rawHorse: RaceHorseEnriched): Partial<HorseFeatures> {
    // Implementação simplificada - em produção usaria o cache
    return {
      jockey_win_rate: 0.1, // Placeholder
      jockey_course_win_rate: 0.1,
      jockey_with_horse_runs: 1,
      jockey_with_horse_win_rate: 0,
      trainer_win_rate: 0.15,
      trainer_course_win_rate: 0.15,
      jockey_trainer_combo_runs: 5,
      jockey_trainer_combo_win_rate: 0.12
    };
  }

  /**
   * Calcula features específicas para lay betting
   */
  private calculateLaySpecificFeatures(horse: ProcessedHorse, history: RaceHorseEnriched[]): Partial<HorseFeatures> {
    const validRuns = history.filter(h => h.position && h.position > 0);
    
    if (validRuns.length === 0) {
      return {
        out_of_top3_rate: 0.7,
        worst_recent_position: 10,
        position_volatility: 5,
        beaten_favorite_rate: 0
      };
    }
    
    const outOfTop3 = validRuns.filter(h => h.position! > 3).length;
    const recentPositions = validRuns.slice(0, 5).map(h => h.position!);
    const worstRecent = Math.max(...recentPositions);
    const volatility = this.calculateStdDev(recentPositions);
    
    // Taxa de vezes que foi favorito e perdeu (simplificado)
    const favoriteBeaten = validRuns.filter
