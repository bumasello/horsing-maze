import type { IRaceCard_Spb } from "../../../../models/modelSpb/raceCard_Spb";
import { convertFurlongsToMeters } from "../../../utils/auxFunctions";

export const calculateHistoricalFeatures = (
  historicalResults: any[] | undefined,
  race: IRaceCard_Spb,
): {
  avg_position: number;
  position_variance: number;
  win_rate: number;
  place_rate: number;
  avg_or_rating: number;
  or_trend: number;
  going_performance: number;
  distance_performance: number;
  recent_form: number;
} => {
  // Valores padrão caso não haja histórico suficiente
  const defaultValues = {
    avg_position: 0,
    position_variance: 0,
    win_rate: 0,
    place_rate: 0,
    avg_or_rating: 0,
    or_trend: 0,
    going_performance: 0,
    distance_performance: 0,
    recent_form: 0,
  };

  // Se não houver resultados históricos, retorna valores padrão
  if (!historicalResults || historicalResults.length === 0) {
    return defaultValues;
  }

  // Extrair posições e filtrar valores inválidos
  const positions = historicalResults
    .map((r) => r.position)
    .filter((p) => p !== null && p !== undefined && !Number.isNaN(p));

  // Se não houver posições válidas, retorna valores padrão
  if (positions.length === 0) {
    return defaultValues;
  }

  // Calcular média de posições
  const avg_position =
    positions.reduce((sum, pos) => sum + pos, 0) / positions.length;

  // Calcular variância das posições
  const position_variance =
    positions.reduce((sum, pos) => sum + Math.pow(pos - avg_position, 2), 0) /
    positions.length;

  // Calcular taxa de vitórias e colocações
  const totalResults = positions.length;
  const win_rate = positions.filter((pos) => pos === 1).length / totalResults;
  const place_rate = positions.filter((pos) => pos <= 3).length / totalResults;

  // Calcular média de OR rating e tendência
  const orRatings = historicalResults
    .map((r) => r.or_rating)
    .filter((r) => r !== null && r !== undefined && !Number.isNaN(r));

  const avg_or_rating =
    orRatings.length > 0
      ? orRatings.reduce((sum, rating) => sum + rating, 0) / orRatings.length
      : 0;

  // Tendência do OR rating (diferença entre o último e a média)
  const latestORRating = orRatings.length > 0 ? orRatings[0] : 0;
  const or_trend = latestORRating - avg_or_rating;

  // Desempenho em pistas similares
  const goingResults = historicalResults.filter(
    (r) => r.course === race.course,
  );
  const going_performance =
    goingResults.length > 0
      ? goingResults
          .map((r) => r.position)
          .filter((p) => p !== null && !Number.isNaN(p))
          .reduce((sum, pos) => sum + pos, 0) / goingResults.length
      : 0;

  // Desempenho em distâncias similares
  const currentDistanceMeters = convertFurlongsToMeters(race.distance || "");
  const distanceResults = historicalResults.filter((r) => {
    const rMeters = convertFurlongsToMeters(r.distance || "");
    return (
      currentDistanceMeters > 0 &&
      Math.abs(rMeters - currentDistanceMeters) / currentDistanceMeters < 0.1
    );
  });

  const distance_performance =
    distanceResults.length > 0
      ? distanceResults
          .map((r) => r.position)
          .filter((p) => p !== null && !Number.isNaN(p))
          .reduce((sum, pos) => sum + pos, 0) / distanceResults.length
      : 0;

  // Forma recente (média ponderada das últimas corridas, dando mais peso às mais recentes)
  const recentResults = historicalResults.slice(
    0,
    Math.min(5, historicalResults.length),
  );
  let weightedSum = 0;
  let weightSum = 0;

  recentResults.forEach((r, index) => {
    const weight = recentResults.length - index; // Peso maior para resultados mais recentes
    if (r.position !== null && !Number.isNaN(r.position)) {
      weightedSum += r.position * weight;
      weightSum += weight;
    }
  });

  const recent_form = weightSum > 0 ? weightedSum / weightSum : 0;

  return {
    avg_position,
    position_variance,
    win_rate,
    place_rate,
    avg_or_rating,
    or_trend,
    going_performance,
    distance_performance,
    recent_form,
  };
};
