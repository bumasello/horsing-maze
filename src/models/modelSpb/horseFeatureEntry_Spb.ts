export interface IHorseFeatureEntry_Spb {
  id?: number;
  race_horse_id: number;
  race_id: number;
  going_encoded: number; // codificação numérica do "going"
  distance_meters: number; // distância da corrida convertida para metros
  field_size: number; // número de cavalos na corrida
  race_class: number;

  // Features do cavalo:
  horse_age: number;
  weight_kg: number; // peso convertido para kg (conversão que você implementa)
  or_rating: number;
  days_since_last_run: number;

  // Histórico de performance:
  avg_position: number;
  position_variance: number;
  win_rate: number;
  place_rate: number;
  avg_or_rating: number;
  or_trend: number; // or_rating atual - média histórica

  // Performance específica:
  going_performance: number;
  distance_performance: number;

  // Jockey:
  jockey_win_rate: number;
  jockey_horse_win_rate: number;

  target: number; // 1 se o cavalo não venceu, 0 se venceu

  created_at?: string;
  updated_at?: string;
}
