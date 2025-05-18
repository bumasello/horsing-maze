import { supabase } from "../../../..";

export const fetchHorseHistoryBeforeDate = async (
  horseId: number | null,
  date: string | Date | null,
) => {
  if (!date) {
    console.log("Sem data");
    return;
  }

  const dateStr =
    typeof date === "object" ? date.toISOString().split("T")[0] : date;

  const { data: horseStats, error: statsError } = await supabase
    .from("horse_stats_hr")
    .select("id")
    .eq("id_horse", horseId)
    .single();

  if (statsError) {
    console.log("Cavalo não encontrado: ", horseId);
    return [];
  }

  if (!horseStats) {
    return [];
  }

  const { data: results, error: resultsError } = await supabase
    .from("horse_results_hr")
    .select("*")
    .eq("stats_id", horseStats.id)
    .lt("date", dateStr)
    .order("date", { ascending: false });

  if (resultsError) {
    throw new Error(
      `Erro buscando histórico do cavalo ${horseId}: ${JSON.stringify(resultsError)}`,
    );
  }

  return results || [];
};
