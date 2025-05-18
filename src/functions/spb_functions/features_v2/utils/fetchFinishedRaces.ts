import { supabase } from "../../../..";

import type { IRaceCard_Spb } from "../../../../models/modelSpb/raceCard_Spb";

export const fetchFinishedRaces = async (): Promise<IRaceCard_Spb[]> => {
  const { data, error } = await supabase
    .from("racecards_hr")
    .select("*")
    .eq("finished", 1)
    .order("date", { ascending: false });

  if (error) {
    throw new Error(
      `Erro buscando corridas finalizadas: ${JSON.stringify(error)}`,
    );
  }

  return data as IRaceCard_Spb[];
};
