import type { IRaceCard_Spb } from "../../../../models/modelSpb/raceCard_Spb";
import { convertFurlongsToMeters } from "../../../utils/auxFunctions";
import {
  calculateDaysBetween,
  checkDirectHorseResults,
  fetchLastRaceDate,
} from "../aux/fetchLastRaceDate";

export const calculateHistoricalFeatures = async (
  historicalResults: any[] | undefined,
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
  going_performance: number;
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
    going_performance: 99,
    distance_performance: 99,
    recent_form: 99,
    days_since_last_run: 999,
    course_win_rate: 0,
    first_time_out: 1, // Assume que é a primeira vez por padrão
    first_time_jockey: 1,
    first_time_course: 1,
  };

  if (!historicalResults || historicalResults.length === 0) {
    return defaultValues;
  }

  // --- Cálculo dos flags "Primeira Vez" ---
  const first_time_out = 0;
  const hasRacedOnCourse = historicalResults.some(
    (r) => r.course === race.course,
  );
  const first_time_course = hasRacedOnCourse ? 0 : 1;
  const hasRacedWithJockey = historicalResults.some(
    (r) =>
      r.jockey &&
      currentJockey &&
      r.jockey.toLowerCase() === currentJockey.toLowerCase(),
  );
  const first_time_jockey = hasRacedWithJockey ? 0 : 1;

  const lastRace = historicalResults[0];
  const days_since_last_run =
    race.date && lastRace && lastRace.date
      ? calculateDaysBetween(lastRace.date, race.date)
      : 999;

  if (historicalResults.length < 3) {
    return {
      ...defaultValues,
      days_since_last_run,
      first_time_out,
      first_time_course,
      first_time_jockey,
    };
  }

  const positions = historicalResults
    .map((r) => {
      const posNum = parseInt(r.position, 10);
      return Number.isNaN(posNum) ? null : posNum;
    })
    .filter((p): p is number => p !== null);

  if (positions.length < 3) {
    return {
      ...defaultValues,
      days_since_last_run,
      first_time_out,
      first_time_course,
      first_time_jockey,
    };
  }

  // --- CÁLCULOS DE FEATURES GERAIS ---
  const totalResults = positions.length;
  const avg_position =
    positions.reduce((sum, pos) => sum + pos, 0) / totalResults;
  const position_variance =
    positions.reduce((sum, pos) => sum + Math.pow(pos - avg_position, 2), 0) /
    totalResults;
  const win_rate = positions.filter((pos) => pos === 1).length / totalResults;
  const place_rate = positions.filter((pos) => pos <= 3).length / totalResults;

  const orRatings = historicalResults
    .map((r) => r.or_rating)
    .filter((r): r is number => r !== null);
  const avg_or_rating =
    orRatings.length > 0
      ? orRatings.reduce((sum, r) => sum + r, 0) / orRatings.length
      : 0;
  const or_trend = (currentOrRating || avg_or_rating) - avg_or_rating;

  // --- LÓGICA DE PERFORMANCE NA PISTA (COURSE) ---
  const courseHistory = historicalResults.filter(
    (r) => r.course === race.course,
  );
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

  // --- LÓGICA EXISTENTE (Distância e Forma) ---
  const currentDistanceMeters = convertFurlongsToMeters(race.distance || "");
  const distanceResults = historicalResults.filter((r) => {
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

  // --- OBJETO DE RETORNO FINAL E CORRIGIDO ---
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
    going_performance: course_avg_position, // Mantendo a lógica que é possível com seus dados
    first_time_out,
    first_time_jockey,
    first_time_course,
  };
};
