import { supabase } from "../../../index";

import horseStatsData from "../../mdb_functions/getHorseResults_Hr";
import horseStatsHrModel from "../../../models/modelHr/horseStatsHrModel";

import type { IHorseStats_HR } from "../../../models/modelHr/horseStatsHrModel";

export const populateHorseStats_spb = async () => {
  try {
    console.log(
      "Iniciando população de estatísticas de cavalos no Supabase...",
    );

    // Buscar estatísticas de cavalos marcados como atualizados no MongoDB
    const horseStats: IHorseStats_HR[] =
      await horseStatsData.getStoredHorseStats_Hr();

    console.log(
      `Processando ${horseStats.length} cavalos com estatísticas atualizadas.`,
    );

    // Processar cada cavalo
    for (const stats of horseStats) {
      // Realizar upsert diretamente sem verificação prévia
      const { data: insertedStats, error: upsertError } = await supabase
        .from("horse_stats_hr")
        .upsert(
          {
            horse: stats.horse,
            id_horse: stats.id_horse,
            result_count: stats.result_count || 0,
          },
          { onConflict: "id_horse" }, // Usar id_horse como chave de conflito
        )
        .select("id");

      if (upsertError) {
        throw new Error(
          `Erro ao fazer upsert para ${stats.horse}: ${upsertError.message}`,
        );
      }

      // Obter o ID do registro inserido/atualizado
      const stats_id = insertedStats?.[0]?.id;

      if (!stats_id) {
        console.warn(
          `Aviso: Não foi possível obter ID após upsert para ${stats.horse}`,
        );
        continue;
      }

      // Processar os resultados do cavalo
      for (const results of stats.results) {
        // Verificar se o resultado já existe
        const { data: existingResult, error: resultCheckError } = await supabase
          .from("horse_results_hr")
          .select("id")
          .eq("stats_id", stats_id)
          .eq("date", results.date)
          .eq("race", results.race);

        if (resultCheckError) {
          throw new Error(
            `Erro ao verificar resultado para ${stats.horse} na data ${results.date}: ${resultCheckError.message}`,
          );
        }

        // Inserir apenas se o resultado não existir
        if (!existingResult || existingResult.length === 0) {
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
              `Erro inserindo resultado para "${stats.horse}" na data ${results.date}: ${insertResultError.message}`,
            );
          }
        }
      }

      // Marcar como não atualizado no MongoDB após processamento
      await horseStatsHrModel.updateOne(
        { id_horse: stats.id_horse },
        { $set: { updated: false } },
      );
    }

    console.log("População de estatísticas de cavalos concluída com sucesso.");
  } catch (error) {
    console.error("Erro durante a população de estatísticas:", error);
  }
};
