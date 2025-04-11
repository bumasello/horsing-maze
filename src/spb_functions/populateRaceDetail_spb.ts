import { supabase } from "..";
import raceDetail from "../mdb_functions/getRaceDetail_Hr";
import { IHorse_Hr } from "../modelHr/horseHrModel";

const populateRaceDetail_spb = async () => {
  const { data: racecards, error } = await supabase
    .from("racecards_hr")
    .select("id, id_race");

  if (error) {
    console.error("Erro ao selecionar racecards_hr: ", error);
    return;
  }

  for (const race of racecards) {
    const details = await raceDetail.getStoredRaceDetail_Hr(race.id_race);
    if (!details) {
      console.warn(`Detalhes não encontrados para a corrida ${race.id_race}`);
    }

    for (const rc_detail of details) {
      const horses = rc_detail.horses;
      if (!horses || horses.length === 0) {
        console.warn(`Nenhum cavalo encontrado para a corrida ${race.id_race}`);
      }

      const horsesToInsert = horses.map((h: IHorse_Hr) => ({
        racecard_id: race.id,
        horse: h.horse || null,
        id_horse: h.id_horse || null,
        jockey: h.jockey || null,
        trainer: h.trainer || null,
        age: h.age || null,
        weight: h.weight || null,
        number: h.number || null,
        last_ran_days_ago: h.last_ran_days_ago || null,
        non_runner: h.non_runner || null,
        form: h.form || null,
        position: h.position || null,
        distance_beaten: h.distance_beaten || null,
        owner: h.owner || null,
        sire: h.sire || null,
        dam: h.dam || null,
        or_rating: h.OR || null,
        sp: h.sp || null,
      }));

      const { data: insertData, error: insertError } = await supabase
        .from("race_horses_hr")
        .insert(horsesToInsert)
        .select("id");

      if (insertError) {
        console.error(
          `Erro inserindo cavalos para a corrida ${race.id_race}: ${JSON.stringify(insertError)}`,
        );
      } else {
        console.log(
          `Inseridos ${insertData?.length || 0} cavalos para a corrida ${race.id_race}`,
        );
      }
    }
  }
};

export default populateRaceDetail_spb;
