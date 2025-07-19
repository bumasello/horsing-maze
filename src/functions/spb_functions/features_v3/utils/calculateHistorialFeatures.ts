import type { IRaceCard_Spb } from "../../../../models/modelSpb/raceCard_Spb";
import { convertFurlongsToMeters } from "../../../utils/auxFunctions";
import {
  fetchLastRaceDate,
  calculateDaysBetween,
  checkDirectHorseResults,
} from "../aux/fetchLastRaceDate";

export const calculateHistoricalFeatures = async (
  historicalResults: any[] | undefined,
  race: IRaceCard_Spb,
  horseId: number,
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
}> => {
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
    days_since_last_run: 0,
  };

  // Se não houver resultados históricos, retorna valores padrão
  if (!historicalResults || historicalResults.length === 0) {
    console.log(
      `[AVISO] Sem histórico para cavalo ${horseId}, retornando valores padrão`,
    );
    return defaultValues;
  }

  // Buscar a data da última corrida diretamente via SQL
  let days_since_last_run = 0;
  try {
    console.log(
      `\n[INFO] Calculando days_since_last_run para cavalo ${horseId}`,
    );

    // Verificar se temos uma data de corrida válida
    if (!race.date || typeof race.date !== "string") {
      console.log(
        `[ERRO] Data da corrida inválida para cavalo ${horseId}: ${race.date}`,
      );
      days_since_last_run = 0;
    } else {
      console.log(
        `[DEBUG] Histórico disponível: ${historicalResults.length} corridas anteriores`,
      );

      // Estratégia 1: Buscar via função SQL (usando stats_id)
      console.log(
        `[DEBUG] Estratégia 1: Buscando via função SQL get_last_race_date`,
      );
      let lastRaceDate = await fetchLastRaceDate(horseId, race.date);

      // Estratégia 2: Se não encontrou via SQL, tenta diretamente na tabela
      if (!lastRaceDate) {
        console.log(
          `[DEBUG] Estratégia 2: Buscando diretamente na tabela horse_results_hr`,
        );
        lastRaceDate = await checkDirectHorseResults(horseId, race.date);
      }

      // Estratégia 3: Se ainda não encontrou, usa o histórico local
      if (
        !lastRaceDate &&
        historicalResults.length > 0 &&
        historicalResults[0].date
      ) {
        console.log(`[DEBUG] Estratégia 3: Usando histórico local`);

        // Verificar formato da data no histórico local
        const localDate = historicalResults[0].date;
        console.log(`[DEBUG] Data do histórico local: ${localDate}`);

        // Tentar converter para formato YYYY-MM-DD se estiver em outro formato
        if (localDate.includes("/")) {
          const parts = localDate.split("/");
          if (parts.length === 3) {
            lastRaceDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
            console.log(`[DEBUG] Data local convertida: ${lastRaceDate}`);
          }
        } else {
          lastRaceDate = localDate;
        }
      }

      // Calcular a diferença em dias
      if (lastRaceDate) {
        days_since_last_run = calculateDaysBetween(lastRaceDate, race.date);
        console.log(
          `[INFO] Cavalo ${horseId}: Última corrida em ${lastRaceDate}, dias desde então: ${days_since_last_run}`,
        );
      } else {
        console.log(
          `[AVISO] Cavalo ${horseId}: Nenhuma corrida anterior encontrada após todas as estratégias`,
        );
        days_since_last_run = 0;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[ERRO] Erro ao calcular days_since_last_run para cavalo ${horseId}: ${errorMessage}`,
    );
    days_since_last_run = 0;
  }

  // Extrair posições e filtrar valores inválidos
  const positions = historicalResults
    .map((r) => r.position)
    .filter((p) => p !== null && p !== undefined && !Number.isNaN(p));

  // Se não houver posições válidas, retorna valores padrão
  if (positions.length === 0) {
    console.log(
      `[AVISO] Sem posições válidas para cavalo ${horseId}, retornando valores padrão`,
    );
    return { ...defaultValues, days_since_last_run };
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
    days_since_last_run,
  };
};
