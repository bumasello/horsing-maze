import { supabase } from "../../..";

import mdbFunctions_RaceCard from "../../mdb_functions/getRaceCard_Hr";
import mdbFunctions_RaceDetail from "../../mdb_functions/getRaceDetail_Hr";

import type { NextFunction } from "express";
import type { IRaceCard_Spb } from "../../../models/modelSpb/raceCard_Spb";
import type { IRaceHorse_Spb } from "../../../models/modelSpb/raceHorse_Spb";

export const updateRacecards_spb = async () => {
  const { data: unFinished, error } = await supabase
    .schema("public")
    .from("racecards_hr")
    .select("id,id_race")
    .eq("finished", "0");

  if (error) {
    throw new Error("Erro ao carregar corridas não finalizadas no Supabase.");
  }

  for (const idRace of unFinished) {
    const mdbRacecard = await mdbFunctions_RaceCard.getOneStoredRaceCard_Hr(
      idRace.id_race,
    );

    const mdbRacedetail = await mdbFunctions_RaceDetail.getStoredRaceDetail_Hr(
      idRace.id_race,
    );

    if (!mdbRacecard || !mdbRacedetail) {
      const { error } = await supabase
        .schema("public")
        .from("racecards_hr")
        .delete()
        .eq("id_race", idRace.id_race);

      if (error) console.error("Erro ao deletar corrida:", error);
      continue;
    }
    const updatedRacecard: IRaceCard_Spb = {
      id: idRace.id,
      id_race: mdbRacecard?.id_race.toString(),
      age: mdbRacecard?.age,
      canceled: mdbRacecard?.canceled,
      class: mdbRacecard?.class,
      course: mdbRacecard?.course,
      date: mdbRacecard?.date,
      distance: mdbRacecard?.distance,
      finish_time: mdbRacecard?.finish_time,
      finished: mdbRacecard?.finished,
      going: mdbRacecard?.going,
      off_time_br: mdbRacecard?.off_time_br,
      prize: mdbRacecard?.prize,
      title: mdbRacecard?.title,
    };

    const { data: upsertData, error: upsertError } = await supabase
      .schema("public")
      .from("racecards_hr")
      .upsert(updatedRacecard, { onConflict: "id" });

    if (upsertError) {
      console.log(upsertError);
      throw new Error(
        `Erro ao realizar o upsert de corridas no supabase. ${upsertError}`,
      );
    }

    for (const detail of mdbRacedetail) {
      for (const horse of detail.horses) {
        const { data: idDetail, error } = await supabase
          .schema("public")
          .from("race_horses_hr")
          .select("id")
          .eq("racecard_id", idRace.id)
          .eq("id_horse", horse.id_horse);

        if (error) {
          throw new Error(
            "Erro ao carregar cavalos das corridas não finalizadas no Supabase.",
          );
        }
        // trata data como array de { id: number }
        const idList = (idDetail ?? []) as { id: number }[];

        if (idList.length === 0) {
          console.warn(
            `Horse ${horse.id_horse} não encontrado em race_horses_hr, talvez não tenha sido inserido antes.`,
          );
          continue;
        }

        for (const { id } of idList) {
          const updatedHorse: IRaceHorse_Spb = {
            id,
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

          const { data: upsertHorse, error: upsertError } = await supabase
            .schema("public")
            .from("race_horses_hr")
            .upsert(updatedHorse, { onConflict: "id" });

          if (upsertError) {
            console.log(upsertError);
            throw new Error(
              `Erro ao realizar o upsert de cavalos no supabase. ${upsertError}`,
            );
          }
        }
      }
    }
  }
};
