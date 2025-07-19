import { supabase } from "../../../..";

import type { IRaceHorse_Spb } from "../../../../models/modelSpb/raceHorse_Spb";

export const fetchHorsesForRace = async (
  raceId: number,
): Promise<IRaceHorse_Spb[]> => {
  const { data, error } = await supabase
    .from("race_horses_hr")
    .select("*")
    .eq("racecard_id", raceId);

  if (error) {
    throw new Error(
      `Erro buscando cavalos para corrida ${raceId}: ${JSON.stringify(error)}`,
    );
  }

  return data as IRaceHorse_Spb[];
};
