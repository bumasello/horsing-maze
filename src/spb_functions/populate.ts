import RaceCard from "../modelHr/raceCardHrModel";
import raceCard from "../mdb_functions/getRaceCard_Hr";
import { supabase } from "..";

import type { IRaceCard_Hr } from "../modelHr/raceCardHrModel";

const populateRacecards_spb = async () => {
  const racecards: IRaceCard_Hr[] = await raceCard.getStoredRaceCard_Hr();

  for (const rc of racecards) {
    const {
      id_race,
      course,
      date,
      off_time_br,
      title,
      distance,
      age,
      going,
      finished,
      canceled,
      finish_time,
      prize,
      class: raceclass,
    } = rc;

    const { data, error } = await supabase
      .from("racecards_hr")
      .insert({
        id_race,
        course,
        date,
        off_time_br,
        title,
        distance,
        age,
        going,
        finished,
        canceled,
        finish_time,
        prize,
        class: raceclass,
      })
      .select("id");

    if (error) {
      throw new Error(
        `Erro inserindo racecard, ${id_race}, ${JSON.stringify(error)}.`,
      );
    }
  }
};

export default { populateRacecards_spb };
