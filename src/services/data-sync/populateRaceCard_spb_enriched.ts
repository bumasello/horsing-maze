import { supabase } from "../..";
import raceCard from "../../integrations/mongodb/getRaceCard_Hr";

import type { IRaceCard_Hr } from "../../models/modelHr/raceCardHrModel";

export const populateRacecardsEnriched_spb = async () => {
  try {
    const racecards: IRaceCard_Hr[] =
      await raceCard.getUnfinishedRaceCard_Hr(true);

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

      const { error } = await supabase
        .schema("hml")
        .from("racecards_hr_enriched")
        .upsert(
          {
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
          },
          { onConflict: "id_race", ignoreDuplicates: true },
        );

      if (error) {
        throw new Error(
          `Erro no upsert do racecard ${id_race}: ${JSON.stringify(error)}.`,
        );
      }

      console.log(`Racecard ${id_race} inserido/atualizado com sucesso.`);
    }

    console.log("Population de racecards concluída com sucesso.");
  } catch (error) {
    // Relança o erro para o pipeline saber que falhou
    throw error;
  }
};
