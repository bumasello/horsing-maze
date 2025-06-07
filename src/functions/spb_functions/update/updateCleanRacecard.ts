import { supabase } from "../../..";

import type { NextFunction } from "express";
import RaceCardModel_Hr from "../../../models/modelHr/raceCardHrModel";
import RaceCardDetailModel_Hr from "../../../models/modelHr/raceDetailHrModel";

export const updateCleanRacecard = async () => {
  try {
    const { data, error } = await supabase
      .from("racecards_hr")
      .select("id_race")
      .eq("finished", "0")
      .eq("canceled", "0")
      .eq("create_entry", false);

    if (error) {
      throw new Error(error.message);
    }

    if (!data) return;

    for (const rc of data) {
      await RaceCardModel_Hr.deleteOne({ id_race: rc.id_race });
      await RaceCardDetailModel_Hr.deleteOne({ id_race: rc.id_race });
      await supabase.from("racecards_hr").delete().eq("id_race", rc.id_race);
    }
  } catch (error) {}
};
