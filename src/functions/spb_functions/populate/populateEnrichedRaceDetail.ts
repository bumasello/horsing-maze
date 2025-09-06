import { supabase } from "../../..";
import { getHistoryRaceDetailId } from "../../utils/getHistoryRaceDetailId";
import { insertEnrichedRaceDetail } from "../../utils/insertEnrichedRaceDetail";

interface UnfinishedRaces {
  id: number;
  id_race: string;
}

interface UnfinishedRacesHorse {
  id: number;
  racecard_id: number;
  id_horse: number;
}

export const populateEnrichedRaceDetail_spb = async () => {
  const { data: unfinishedracecards, error: unfinishedracecardsError } =
    await supabase
      .schema("hml")
      .from("racecards_hr_enriched")
      .select("id, id_race")
      .eq("finished", "0")
      .eq("canceled", "0");

  if (unfinishedracecardsError)
    throw new Error("Erro ao carregar corridas não finalizadas no Supabase.");

  // console.log(unfinishedracecards);

  for (const race of unfinishedracecards as UnfinishedRaces[]) {
    // console.log(race.id);
    const { data: raceDetail, error: raceDetailError } = await supabase
      .schema("hml")
      .from("race_horses_hr_enriched")
      .select("id, racecard_id, id_horse")
      .eq("racecard_id", race.id);

    if (raceDetailError)
      throw new Error(
        "Erro ao carregar detalhes de corridas não finalizadas no Supabase.",
      );

    for (const horse of raceDetail as UnfinishedRacesHorse[]) {
      // console.log(horse.id_horse);
      const raceIds = await getHistoryRaceDetailId(horse.id_horse);

      for (const raceId of raceIds) {
        await insertEnrichedRaceDetail(+raceId);
      }
    }
  }
};
