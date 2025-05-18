import { supabase } from "../../../..";

export const fetchJockeyWinRate = async (jockey: string): Promise<number> => {
  const { data: allData, error: allError } = await supabase
    .from("horse_results_hr")
    .select("position", { count: "exact" })
    .eq("jockey", jockey);

  if (allError || !allData || allData.length === 0) {
    return 0;
  }

  const total = allData.length;
  const wins = allData.filter((r: any) => r.position === 1).length;
  return wins / total;
};

export const fetchJockeyHorseWinRate = async (
  jockey: string,
  id_horse: number,
): Promise<number> => {
  const { data: pairData, error: pairError } = await supabase
    .from("horse_results_hr")
    .select("position", { count: "exact" })
    .eq("jockey", jockey)
    .eq("id_horse", id_horse);

  if (pairError || !pairData || pairData.length === 0) {
    return 0;
  }

  const total = pairData.length;
  const wins = pairData.filter((r: any) => r.position === 1).length;

  return wins / total;
};
