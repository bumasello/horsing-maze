import { supabase } from "../../../..";

import type { IRaceCard_Spb } from "../../../../models/modelSpb/raceCard_Spb";

export const fetchRacecards = async (): Promise<IRaceCard_Spb[]> => {
  const { data, error } = await supabase.from("racecards_hr").select("*");

  if (error) {
    throw new Error(
      `Error buscando serviço do racecards: ${JSON.stringify(error)}`,
    );
  }

  return data as IRaceCard_Spb[];
};

export const fetchSingleRacecards = async (
  rc: number,
): Promise<IRaceCard_Spb[]> => {
  const { data, error } = await supabase
    .from("racecards_hr")
    .select("*")
    .eq("id_race", rc);

  if (error) {
    throw new Error(
      `Error buscando serviço do racecards: ${JSON.stringify(error)}`,
    );
  }

  return data as IRaceCard_Spb[];
};

export const fetchRaceHorses = async (racecard_id: number) => {
  const { data, error } = await supabase
    .from("race_horses_hr")
    .select("*")
    .eq("racecard_id", racecard_id);

  if (error) {
    throw new Error(
      `Erro buscando serviço dos cavalos para racecard ${racecard_id}: ${JSON.stringify(error)}`,
    );
  }

  return data;
};
