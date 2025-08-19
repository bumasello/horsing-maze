import type { IHorseResult_Spb } from "../../../../models/modelSpb/horseResult_Spb";
import type { IRaceCard_Spb } from "../../../../models/modelSpb/raceCard_Spb";
import type { IRaceHorse_Spb } from "../../../../models/modelSpb/raceHorse_Spb";
import { convertFurlongsToMeters } from "../../../utils/auxFunctions";
import { calculateDaysBetween } from "../aux/fetchLastRaceDate";

// Definindo a interface para o histórico combinado para clareza
interface ICombinedHistory {
  date: string | null;
  position: number | null;
  course: string | null;
  distance: string | null;
  jockey: string | null;
  // O OR Rating é enriquecido: usa o do dia da corrida se existir, senão o do resultado.
  or_rating: number | null;
  // Adicione outros campos enriquecidos que queira usar no futuro
  // form: string | null;
  // distance_beaten: string | null;
}

// A assinatura da função agora inclui o novo parâmetro 'enrichedHistoryMap'
export const calculateHistoricalFeatures = async (
  basicHistory: IHorseResult_Spb[],
  enrichedHistoryMap: Map<string, IRaceHorse_Spb>,
  race: IRaceCard_Spb,
  horseId: number,
  currentJockey: string | null,
  currentOrRating: number | null,
): Promise<{
  avg_position: number;
  position_variance: number;
  win_rate: number;
  place_rate: number;
  avg_or_rating: number;
  or_trend: number;
  course_avg_position: number; // Renomeado de 'going_performance' para clareza
  distance_performance: number;
  recent_form: number;
  days_since_last_run: number;
  course_win_rate: number;
  first_time_out: number;
  first_time_jockey: number;
  first_time_course: number;
}> => {
  const defaultValues = {
    avg_position: 99,
    position_variance: 0,
    win_rate: 0,
    place_rate: 0,
    avg_or_rating: 0,
    or_trend: 0,
    course_avg_position: 99,
    distance_performance: 99,
    recent_form: 99,
    days_since_last_run: 999,
    course_win_rate: 0,
    first_time_out: 1,
    first_time_jockey: 1,
    first_time_course: 1,
  };

  if (!basicHistory || basicHistory.length === 0) {
    return defaultValues;
  }

  // --- ETAPA 1: ENRIQUECIMENTO PROGRESSIVO DOS DADOS ---
  const combinedHistory: ICombinedHistory[] = basicHistory.map(
    (basicResult) => {
      const enrichedData = basicResult.date
        ? enrichedHistoryMap.get(basicResult.date)
        : undefined;
      return {
        date: basicResult.date,
        position: basicResult.position,
        course: basicResult.course,
        distance: basicResult.distance,
        jockey: basicResult.jockey,
        // Lógica de enriquecimento: usa o dado rico se existir, senão o fallback do dado básico.
        or_rating: enrichedData?.or_rating ?? basicResult.or_rating,
      };
    },
  );

  // --- ETAPA 2: CÁLCULO DAS FEATURES USANDO O HISTÓRICO COMBINADO ---

  // --- Flags "Primeira Vez" ---
  const first_time_out = 0;
  const hasRacedOnCourse = combinedHistory.some(
    (r) => r.course === race.course,
  );
  const first_time_course = hasRacedOnCourse ? 0 : 1;
  const hasRacedWithJockey = combinedHistory.some(
    (r) =>
      r.jockey &&
      currentJockey &&
      r.jockey.toLowerCase() === currentJockey.toLowerCase(),
  );
  const first_time_jockey = hasRacedWithJockey ? 0 : 1;

  const lastRace = combinedHistory[0];
  const days_since_last_run =
    race.date && lastRace && lastRace.date
      ? calculateDaysBetween(lastRace.date, race.date)
      : 999;

  // Validação de quantidade mínima de corridas
  if (combinedHistory.length < 3) {
    return {
      ...defaultValues,
      days_since_last_run,
      first_time_out,
      first_time_course,
      first_time_jockey,
    };
  }

  const positions = combinedHistory
    .map((r) => r.position)
    .filter((p): p is number => p !== null && !Number.isNaN(p));

  if (positions.length < 3) {
    return {
      ...defaultValues,
      days_since_last_run,
      first_time_out,
      first_time_course,
      first_time_jockey,
    };
  }

  // --- Cálculos de Features Gerais ---
  const totalResults = positions.length;
  const avg_position =
    positions.reduce((sum, pos) => sum + pos, 0) / totalResults;
  const position_variance =
    positions.reduce((sum, pos) => sum + Math.pow(pos - avg_position, 2), 0) /
    totalResults;
  const win_rate = positions.filter((pos) => pos === 1).length / totalResults;
  const place_rate = positions.filter((pos) => pos <= 3).length / totalResults;

  // --- Cálculo de OR (Official Rating) com dados enriquecidos ---
  const historicalOrRatings = combinedHistory
    .map((r) => r.or_rating)
    .filter((r): r is number => r !== null);
  const avg_or_rating =
    historicalOrRatings.length > 0
      ? historicalOrRatings.reduce((sum, r) => sum + r, 0) /
        historicalOrRatings.length
      : 0;
  const or_trend = (currentOrRating || avg_or_rating) - avg_or_rating;

  // --- Lógica de Performance na Pista (Course) ---
  const courseHistory = combinedHistory.filter((r) => r.course === race.course);
  let course_win_rate = 0;
  let course_avg_position = 99;
  if (courseHistory.length > 0) {
    const coursePositions = courseHistory
      .map((r) => r.position)
      .filter((p): p is number => p !== null);
    if (coursePositions.length > 0) {
      course_win_rate =
        coursePositions.filter((p) => p === 1).length / coursePositions.length;
      course_avg_position =
        coursePositions.reduce((a, b) => a + b, 0) / coursePositions.length;
    }
  }

  // --- Lógica de Distância e Forma ---
  const currentDistanceMeters = convertFurlongsToMeters(race.distance || "");
  const distanceResults = combinedHistory.filter((r) => {
    const rMeters = convertFurlongsToMeters(r.distance || "");
    return (
      currentDistanceMeters > 0 &&
      Math.abs(rMeters - currentDistanceMeters) / currentDistanceMeters < 0.1
    );
  });
  const distancePositions = distanceResults
    .map((r) => r.position)
    .filter((p): p is number => p !== null);
  const distance_performance =
    distancePositions.length > 0
      ? distancePositions.reduce((a, b) => a + b, 0) / distancePositions.length
      : 99;

  const recentResults = positions.slice(0, 5);
  const weightedSum = recentResults.reduce(
    (sum, pos, i) => sum + pos * (recentResults.length - i),
    0,
  );
  const weightSum = recentResults.reduce(
    (sum, pos, i) => sum + (recentResults.length - i),
    0,
  );
  const recent_form = weightSum > 0 ? weightedSum / weightSum : 99;

  // --- Objeto de Retorno Final ---
  return {
    avg_position,
    position_variance,
    win_rate,
    place_rate,
    avg_or_rating,
    or_trend,
    distance_performance,
    recent_form,
    days_since_last_run,
    course_win_rate,
    course_avg_position, // Nome corrigido e consistente
    first_time_out,
    first_time_jockey,
    first_time_course,
  };
};
