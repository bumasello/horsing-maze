import { supabase } from "../..";

import type { IHorseFeatureEntry_Spb } from "../../models/modelSpb/horseFeatureEntry_Spb";
import { IRaceCard_Spb } from "../../models/modelSpb/raceCard_Spb";

export async function pendingRaces(): Promise<
  {
    raceId: number;
    id_race: string;
    features: IHorseFeatureEntry_Spb[];
  }[]
> {
  const { data: races, error: racesError } = await supabase
    .from("racecards_hr")
    .select("id, id_race")
    .eq("finished", 0);

  if (racesError) throw new Error(racesError.message);

  const result: {
    raceId: number;
    id_race: string;
    features: IHorseFeatureEntry_Spb[];
  }[] = [];

  for (const r of races as IRaceCard_Spb[]) {
    const { data: feats, error: featsError } = await supabase
      .from("horse_features")
      .select("*")
      .eq("race_id", r.id);

    if (featsError) throw new Error(featsError.message);

    result.push({
      raceId: r.id,
      id_race: r.id_race! || "",
      features: feats || [],
    });
  }

  return result;
}

export async function loadTrainingData(): Promise<IHorseFeatureEntry_Spb[]> {
  const { data: racesDone, error: racesError } = await supabase
    .from("racecards_hr")
    .select("id")
    .eq("finished", 0);
  if (racesError) throw new Error(racesError.message);

  const allFeatures: IHorseFeatureEntry_Spb[] = [];
  for (const { id } of racesDone as IRaceCard_Spb[]) {
    const { data: feats, error: featsError } = await supabase
      .from("horse_features")
      .select("*")
      .eq("race_id", id);
    if (featsError) throw new Error(featsError.message);
    allFeatures.push(...(feats || []));
  }
  return allFeatures;
}
