import raceCard from "../mdb_functions/getRaceCard_Hr";
import { supabase } from "../..";
import type { IRaceCard_Hr } from "../../models/modelHr/raceCardHrModel";
import type { NextFunction } from "express";

const populateRacecards_spb = async (next: NextFunction) => {
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

      // Verifica se o racecard com o mesmo id_race já existe no Supabase
      const { data: existingData, error: existingError } = await supabase
        .from("racecards_hr")
        .select("id")
        .eq("id_race", id_race);

      if (existingError) {
        throw new Error(
          `Erro verificando existência do racecard ${id_race}: ${JSON.stringify(
            existingError,
          )}.`,
        );
      }

      // Se já existir, pula para o próximo registro
      if (existingData && existingData.length > 0) {
        console.log(`Racecard ${id_race} já existe. Pulando inserção.`);
        continue;
      }

      // Se não existe, insere o novo racecard
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
          `Erro inserindo racecard ${id_race}: ${JSON.stringify(error)}.`,
        );
      }
      console.log(`Racecard ${id_race} inserido com sucesso.`);
    }
  } catch (error) {
    next(error);
  }
};

export default populateRacecards_spb;
