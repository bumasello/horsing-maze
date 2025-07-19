import { supabase } from "../../../..";

import type { IRaceCard_Spb } from "../../../../models/modelSpb/raceCard_Spb";

export const calculateJockeyFeatures = async (
  jockey: string | null,
  horseId: number | null,
  race: IRaceCard_Spb | null,
): Promise<{
  jockey_win_rate: number;
  jockey_horse_win_rate: number;
  jockey_course_win_rate: number;
}> => {
  // Valores padrão
  const defaultValues = {
    jockey_win_rate: 0,
    jockey_horse_win_rate: 0,
    jockey_course_win_rate: 0,
  };

  // Se não tiver jóquei, retorna valores padrão
  if (!jockey) {
    return defaultValues;
  }

  if (!race) {
    console.log("Sem race");
    return defaultValues;
  }

  try {
    // Buscar todos os resultados históricos do jóquei
    const { data: jockeyResults, error: jockeyError } = await supabase
      .from("horse_results_hr")
      .select("*")
      .ilike("jockey", jockey)
      .lt("date", race.date);

    if (jockeyError || !jockeyResults || jockeyResults.length === 0) {
      return defaultValues;
    }

    // Taxa de vitórias geral do jóquei
    const jockeyPositions = jockeyResults
      .map((r) => r.position)
      .filter((p) => p !== null && p !== undefined && !Number.isNaN(p));

    const jockey_win_rate =
      jockeyPositions.length > 0
        ? jockeyPositions.filter((pos) => pos === 1).length /
          jockeyPositions.length
        : 0;

    // Taxa de vitórias do jóquei com este cavalo específico
    // Primeiro, precisamos encontrar o stats_id do cavalo
    const { data: horseStats, error: statsError } = await supabase
      .from("horse_stats_hr")
      .select("id")
      .eq("id_horse", horseId)
      .single();

    let jockey_horse_win_rate = 0;

    if (!statsError && horseStats) {
      const { data: jockeyHorseResults, error: jockeyHorseError } =
        await supabase
          .from("horse_results_hr")
          .select("*")
          .eq("stats_id", horseStats.id)
          .ilike("jockey", jockey)
          .lt("date", race.date);

      if (
        !jockeyHorseError &&
        jockeyHorseResults &&
        jockeyHorseResults.length > 0
      ) {
        const jockeyHorsePositions = jockeyHorseResults
          .map((r) => r.position)
          .filter((p) => p !== null && p !== undefined && !Number.isNaN(p));

        jockey_horse_win_rate =
          jockeyHorsePositions.length > 0
            ? jockeyHorsePositions.filter((pos) => pos === 1).length /
              jockeyHorsePositions.length
            : 0;
      }
    }

    // Taxa de vitórias do jóquei nesta pista
    const jockeyCourseResults = jockeyResults.filter(
      (r) => r.course === race.course,
    );
    const jockeyCoursePositions = jockeyCourseResults
      .map((r) => r.position)
      .filter((p) => p !== null && p !== undefined && !Number.isNaN(p));

    const jockey_course_win_rate =
      jockeyCoursePositions.length > 0
        ? jockeyCoursePositions.filter((pos) => pos === 1).length /
          jockeyCoursePositions.length
        : 0;

    return {
      jockey_win_rate,
      jockey_horse_win_rate,
      jockey_course_win_rate,
    };
  } catch (error) {
    console.error(`Erro ao calcular features do jóquei ${jockey}:`, error);
    return defaultValues;
  }
};
