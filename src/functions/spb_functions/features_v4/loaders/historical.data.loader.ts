// features_v4/loaders/historical.data.loader.ts

import { supabase } from "../../../..";
import type { RaceCardEnriched, RaceHorseEnriched } from "../types/core.types";
import type { HistoricalRaceData } from "../features/historical.features";

/**
 * Cache para histórico de cavalos para evitar queries repetidas
 */
const historyCache = new Map<string, HistoricalRaceData[]>();

/**
 * Buscar histórico de um cavalo com otimizações
 */
export async function fetchHorseHistory(
  horseId: number,
  beforeDate: Date,
  limit: number = 20,
): Promise<HistoricalRaceData[]> {
  const cacheKey = `${horseId}-${beforeDate.toISOString()}-${limit}`;

  // Verificar cache
  if (historyCache.has(cacheKey)) {
    return historyCache.get(cacheKey)!;
  }

  try {
    // Query otimizada com campos específicos
    const { data, error } = await supabase
      .schema("hml")
      .from("race_horses_hr_enriched")
      .select(
        `
        id,
        horse_id,
        horse,
        position,
        or_rating,
        sp_decimal,
        weight,
        distance_beaten,
        non_runner,
        age,
        jockey,
        trainer,
        form,
        racecard_id,
        racecards_hr_enriched!inner (
          id,
          date,
          course,
          distance,
          going,
          class,
          finished,
          canceled,
          title,
          prize
        )
      `,
      )
      .eq("horse_id", horseId)
      .eq("racecards_hr_enriched.finished", 1)
      .eq("racecards_hr_enriched.canceled", 0)
      .lt("racecards_hr_enriched.date", beforeDate.toISOString().split("T")[0])
      .order("racecards_hr_enriched.date", { ascending: false })
      .limit(limit);

    if (error) {
      // Se for timeout, tentar com limite menor
      if (error.code === "57014") {
        console.warn(
          `Timeout fetching history for horse ${horseId}, trying with smaller limit`,
        );
        return fetchHorseHistory(horseId, beforeDate, Math.floor(limit / 2));
      }
      console.error("Error fetching horse history:", error);
      return [];
    }

    // Mapear para o formato esperado
    const history: HistoricalRaceData[] = (data || []).map((record) => ({
      horse: {
        id: record.id,
        horse_id: record.horse_id,
        horse: record.horse,
        position: record.position,
        or_rating: record.or_rating,
        sp_decimal: record.sp_decimal,
        weight: record.weight,
        distance_beaten: record.distance_beaten,
        non_runner: record.non_runner,
        age: record.age,
        jockey: record.jockey,
        trainer: record.trainer,
        form: record.form,
        racecard_id: record.racecard_id,
        // Campos adicionais podem ser null
        number: null,
        dam: null,
        sire: null,
        owner: null,
        last_ran_days_ago: null,
        sp: null,
      } as RaceHorseEnriched,
      race: {
        id: record.racecards_hr_enriched.id,
        date: record.racecards_hr_enriched.date,
        course: record.racecards_hr_enriched.course,
        distance: record.racecards_hr_enriched.distance,
        going: record.racecards_hr_enriched.going,
        class: record.racecards_hr_enriched.class,
        finished: record.racecards_hr_enriched.finished,
        canceled: record.racecards_hr_enriched.canceled,
        title: record.racecards_hr_enriched.title,
        prize: record.racecards_hr_enriched.prize,
        // Campos adicionais
        id_race: "",
        off_time_br: "",
        age: null,
        finish_time: null,
      } as RaceCardEnriched,
    }));

    // Salvar no cache
    historyCache.set(cacheKey, history);

    return history;
  } catch (error) {
    console.error(`Failed to fetch history for horse ${horseId}:`, error);
    return [];
  }
}

/**
 * Buscar histórico para múltiplos cavalos em batch
 */
export async function fetchMultipleHorseHistories(
  horseIds: number[],
  beforeDate: Date,
  limit: number = 20,
): Promise<Map<number, HistoricalRaceData[]>> {
  const results = new Map<number, HistoricalRaceData[]>();

  // Processar em batches para evitar timeout
  const batchSize = 10;
  for (let i = 0; i < horseIds.length; i += batchSize) {
    const batch = horseIds.slice(i, i + batchSize);

    // Processar batch em paralelo
    const batchPromises = batch.map((horseId) =>
      fetchHorseHistory(horseId, beforeDate, limit)
        .then((history) => ({ horseId, history }))
        .catch((error) => {
          console.error(`Error fetching history for horse ${horseId}:`, error);
          return { horseId, history: [] };
        }),
    );

    const batchResults = await Promise.all(batchPromises);

    // Adicionar ao mapa de resultados
    for (const { horseId, history } of batchResults) {
      results.set(horseId, history);
    }

    // Pequeno delay entre batches para não sobrecarregar
    if (i + batchSize < horseIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return results;
}

/**
 * Limpar cache (chamar periodicamente ou quando necessário)
 */
export function clearHistoryCache(): void {
  historyCache.clear();
  console.log("History cache cleared");
}

/**
 * Buscar histórico recente com query mais leve
 */
export async function fetchRecentHistory(
  horseId: number,
  days: number = 90,
  limit: number = 10,
): Promise<HistoricalRaceData[]> {
  const beforeDate = new Date();
  const afterDate = new Date();
  afterDate.setDate(afterDate.getDate() - days);

  try {
    const { data, error } = await supabase
      .schema("hml")
      .from("race_horses_hr_enriched")
      .select(
        `
        id,
        position,
        or_rating,
        sp_decimal,
        racecard_id,
        racecards_hr_enriched!inner (
          id,
          date,
          course,
          distance,
          going,
          class
        )
      `,
      )
      .eq("horse_id", horseId)
      .gte("racecards_hr_enriched.date", afterDate.toISOString().split("T")[0])
      .lt("racecards_hr_enriched.date", beforeDate.toISOString().split("T")[0])
      .order("racecards_hr_enriched.date", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Error fetching recent history:", error);
      return [];
    }

    // Mapear resultados (versão simplificada)
    return (data || []).map((record) => ({
      horse: {
        id: record.id,
        position: record.position,
        or_rating: record.or_rating,
        sp_decimal: record.sp_decimal,
        racecard_id: record.racecard_id,
      } as Partial<RaceHorseEnriched> as RaceHorseEnriched,
      race: {
        id: record.racecards_hr_enriched.id,
        date: record.racecards_hr_enriched.date,
        course: record.racecards_hr_enriched.course,
        distance: record.racecards_hr_enriched.distance,
        going: record.racecards_hr_enriched.going,
        class: record.racecards_hr_enriched.class,
      } as Partial<RaceCardEnriched> as RaceCardEnriched,
    }));
  } catch (error) {
    console.error(
      `Failed to fetch recent history for horse ${horseId}:`,
      error,
    );
    return [];
  }
}
