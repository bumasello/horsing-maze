import { supabase } from "../../..";

import type { IHorseResult_Spb } from "../../../models/modelSpb/horseResult_Spb";

export const fetchHorseHistoricalResults = async (
  id_horse: number,
  raceDate: string,
): Promise<IHorseResult_Spb[]> => {
  const { data: statsRow, error: statsError } = await supabase
    .from("horse_stats_hr")
    .select("id")
    .eq("id_horse", id_horse)
    .limit(1);

  if (statsError) {
    throw new Error(
      `Erro buscando stats para cavalo ${id_horse}: ${JSON.stringify(statsError)}`,
    );
  }

  if (!statsRow || statsRow.length === 0) {
    return [];
  }

  const stats_id = statsRow[0].id;

  const { data, error } = await supabase
    .from("horse_results_hr")
    .select("*")
    .eq("stats_id", stats_id);

  if (error) {
    throw new Error(
      `Erro buscando históricos para cavalo ${id_horse}: ${JSON.stringify(error)}`,
    );
  }

  return data ?? [];
};
