export interface Race {
  id: number;
  course: string;
  date: string;
  going: string;
  distance: string;
  class: number;
  // ... outras propriedades da corrida
}

export interface HorseInRace {
  id: number;
  horse: string;
  jockey: string;
  id_horse: number;
  non_runner: number; // 0 ou 1
  position: number; // Posição final, se aplicável
  age: number;
  weight: string; // Ex: "10-00" (10 stone, 0 pounds)
  or_rating: number;
  // ... outras propriedades do cavalo na corrida
}

export interface HorseHistoryEntry {
  // ... propriedades do histórico do cavalo
}

export interface HistoricalFeatures {
  days_since_last_run: number;
  avg_position: number;
  position_variance: number;
  win_rate: number;
  place_rate: number;
  avg_or_rating: number;
  or_trend: number;
  going_performance: number;
  distance_performance: number;
  recent_form: number;
}

export interface JockeyFeatures {
  jockey_win_rate: number;
  jockey_horse_win_rate: number;
  jockey_course_win_rate: number;
}

export interface BaseFeature {
  race_horse_id: number;
  raceId: number;
  going_encoded: number;
  distance_meters: number;
  field_size: number;
  race_class: number;
  horse_age: number;
  weight_kg: number;
  or_rating: number;
}

export interface TrainingFeature
  extends BaseFeature,
    HistoricalFeatures,
    JockeyFeatures {
  target: number; // 0 (venceu) ou 1 (não venceu)
}

export interface PredictionFeature
  extends BaseFeature,
    HistoricalFeatures,
    JockeyFeatures {}
