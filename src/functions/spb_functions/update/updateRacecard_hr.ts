import { supabase } from "../../..";

import mdbFunctions_RaceCard from "../../mdb_functions/getRaceCard_Hr";
import mdbFunctions_RaceDetail from "../../mdb_functions/getRaceDetail_Hr";

import type { IRaceCard_Spb } from "../../../models/modelSpb/raceCard_Spb";
import type { IRaceHorse_Spb } from "../../../models/modelSpb/raceHorse_Spb";

export const updateRacecards_spb = async () => {
  const { data: unFinished, error } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .select("id, id_race")
    .eq("finished", 0);

  if (error) {
    throw new Error(
      `Erro ao carregar corridas não finalizadas: ${error.message}`,
    );
  }

  if (!unFinished || unFinished.length === 0) {
    console.log("Nenhuma corrida não finalizada encontrada.");
    return;
  }

  console.log(`Atualizando ${unFinished.length} corridas no Supabase...`);

  for (const idRace of unFinished) {
    try {
      const [mdbRacecard, mdbRacedetail] = await Promise.all([
        mdbFunctions_RaceCard.getOneStoredRaceCard_Hr(idRace.id_race),
        mdbFunctions_RaceDetail.getStoredRaceDetail_Hr(idRace.id_race),
      ]);

      // Se não existe no MongoDB, remove do Supabase
      if (!mdbRacecard || !mdbRacedetail || mdbRacedetail.length === 0) {
        const { error: deleteError } = await supabase
          .schema("hml")
          .from("racecards_hr_enriched")
          .delete()
          .eq("id_race", idRace.id_race);

        if (deleteError) {
          console.error(
            `Erro ao deletar corrida ${idRace.id_race}:`,
            deleteError.message,
          );
        } else {
          console.log(`Corrida ${idRace.id_race} removida do Supabase.`);
        }
        continue;
      }

      // Upsert do racecard
      const updatedRacecard: IRaceCard_Spb = {
        id: idRace.id,
        id_race: mdbRacecard.id_race.toString(),
        age: mdbRacecard.age,
        canceled: mdbRacecard.canceled,
        class: mdbRacecard.class,
        course: mdbRacecard.course,
        date: mdbRacecard.date,
        distance: mdbRacecard.distance,
        finish_time: mdbRacecard.finish_time,
        finished: mdbRacecard.finished,
        going: mdbRacecard.going,
        off_time_br: mdbRacecard.off_time_br,
        prize: mdbRacecard.prize,
        title: mdbRacecard.title,
      };

      const { error: upsertRaceError } = await supabase
        .schema("hml")
        .from("racecards_hr_enriched")
        .upsert(updatedRacecard, { onConflict: "id" });

      if (upsertRaceError) {
        console.error(
          `Erro ao upsert corrida ${idRace.id_race}:`,
          upsertRaceError.message,
        );
        continue;
      }

      console.log(`Racecard ${idRace.id_race} atualizado.`);

      // Upsert dos cavalos — usa onConflict direto, sem select prévio
      for (const detail of mdbRacedetail) {
        for (const horse of detail.horses) {
          const updatedHorse: Omit<IRaceHorse_Spb, "id"> = {
            id_horse: horse.id_horse,
            horse: horse.horse,
            age: horse.age,
            racecard_id: idRace.id,
            dam: horse.dam,
            distance_beaten: horse.distance_beaten,
            form: horse.form,
            jockey: horse.jockey,
            last_ran_days_ago: horse.last_ran_days_ago,
            non_runner: horse.non_runner,
            number: horse.number,
            or_rating: horse.OR,
            owner: horse.owner,
            position: Number(horse.position),
            sire: horse.sire,
            sp: horse.sp,
            trainer: horse.trainer,
            weight: horse.weight,
          };

          const { error: upsertHorseError } = await supabase
            .schema("hml")
            .from("race_horses_hr_enriched")
            .upsert(updatedHorse, { onConflict: "racecard_id,id_horse" });

          if (upsertHorseError) {
            console.error(
              `Erro ao upsert cavalo ${horse.id_horse} na corrida ${idRace.id_race}:`,
              upsertHorseError.message,
            );
          }
        }
      }

      console.log(`Cavalos da corrida ${idRace.id_race} atualizados.`);
    } catch (error) {
      // Erro numa corrida não para as outras
      console.error(`Erro ao processar corrida ${idRace.id_race}:`, error);
    }
  }

  console.log("Atualização de racecards no Supabase concluída.");
};
