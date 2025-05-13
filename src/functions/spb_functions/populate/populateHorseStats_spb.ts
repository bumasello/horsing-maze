import { supabase } from "../../../index.ts";
import horseStatsData from "../../mdb_functions/getHorseResults_Hr.ts";

import type { IHorseStats_HR } from "../../../models/modelHr/horseStatsHrModel.ts";
import type { Request, Response, NextFunction } from "express";

const populateHorseStats_spb = async (next: NextFunction) => {
  try {
    const horseStats: IHorseStats_HR[] =
      await horseStatsData.getStoredHorseStats_Hr();

    // selecionando todos os cavalos armazenados
    for (const stats of horseStats) {
      const { data: existing, error: checkError } = await supabase
        .from("horse_stats_hr")
        .select("id")
        .eq("id_horse", stats.id_horse);

      if (checkError) {
        throw new Error(`Erro ao verificar existência de ${stats.horse}:`);
      }

      let stats_id: number;

      if (existing && existing.length > 0) {
        stats_id = existing[0].id;
      } else {
        const { data: insertedStats, error: insertError } = await supabase
          .from("horse_stats_hr")
          .insert({
            horse: stats.horse,
            id_horse: stats.id_horse,
          })
          .select("id");
        if (insertError) {
          throw new Error(`Erro ao inserir stats para ${stats.horse}:`);
        }
        stats_id = insertedStats && insertedStats[0]?.id;
      }
      for (const results of stats.results) {
        const { data: existingResult, error: resultCheckError } = await supabase
          .from("horse_results_hr")
          .select("id")
          .eq("stats_id", stats_id)
          .eq("date", results.date)
          .eq("race", results.race);

        if (resultCheckError) {
          throw new Error(
            `Erro ao verificar resultado para ${stats.horse} na data ${results.date}:`,
          );
        }

        if (existingResult && existingResult.length > 0) {
          // console.log(
          //   `Resultado para "${stats.horse}" na data ${results.date} já existe.`,
          // );
        } else {
          if (!results.position) {
            continue;
          }

          const { error: insertResultError } = await supabase
            .from("horse_results_hr")
            .insert({
              stats_id: stats_id,
              date: results.date,
              position: results.position,
              course: results.course,
              distance: results.distance,
              class: results.class || 0,
              weight: results.weight,
              starting_price: results.starting_price,
              jockey: results.jockey,
              trainer: results.trainer,
              or_rating: results.OR || 0,
              race: results.race,
              prize: results.prize,
            });

          if (insertResultError) {
            throw new Error(
              `Erro inserindo resultado para "${stats.horse}" na data ${results.date}:`,
            );
          }
        }
      }
    }
  } catch (error) {
    next(error);
  }
};

export default populateHorseStats_spb;
