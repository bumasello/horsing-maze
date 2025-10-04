// features_v4/ml/update_results.ts

import { supabase } from "../../../..";
import type { IRaceCard_Spb } from "../../../../models/modelSpb/raceCard_Spb";
import type { IRaceHorse_Spb } from "../../../../models/modelSpb/raceHorse_Spb";
import mdbFunctions_RaceCard from "../../../mdb_functions/getRaceCard_Hr";
import mdbFunctions_RaceDetail from "../../../mdb_functions/getRaceDetail_Hr";

/**
 * Atualiza racecards e race details do MongoDB para Supabase
 */
export const updateRacecardsAndDetails = async (): Promise<void> => {
  console.log("🔄 Iniciando atualização de corridas e cavalos...");

  try {
    // Buscar corridas não finalizadas
    const { data: unFinished, error } = await supabase
      .schema("hml")
      .from("racecards_hr_enriched")
      .select("id, id_race")
      .eq("finished", 0)
      .eq("canceled", 0);

    if (error) {
      throw new Error(
        `Erro ao carregar corridas não finalizadas: ${error.message}`,
      );
    }

    if (!unFinished || unFinished.length === 0) {
      console.log("i Nenhuma corrida pendente para atualizar");
      return;
    }

    console.log(`📊 ${unFinished.length} corridas para atualizar`);

    let updatedRaces = 0;
    let updatedHorses = 0;
    let deletedRaces = 0;

    for (const race of unFinished) {
      try {
        // Buscar dados atualizados do MongoDB
        const mdbRacecard = await mdbFunctions_RaceCard.getOneStoredRaceCard_Hr(
          race.id_race,
        );
        const mdbRacedetail =
          await mdbFunctions_RaceDetail.getStoredRaceDetail_Hr(race.id_race);

        // Se não encontrar no MongoDB, deletar do Supabase
        if (!mdbRacecard || !mdbRacedetail) {
          console.log(
            `! Corrida ${race.id_race} não encontrada no MongoDB, deletando...`,
          );

          const { error: deleteError } = await supabase
            .schema("hml")
            .from("racecards_hr_enriched")
            .delete()
            .eq("id_race", race.id_race);

          if (deleteError) {
            console.error(
              `Erro ao deletar corrida ${race.id_race}:`,
              deleteError,
            );
          } else {
            deletedRaces++;
          }
          continue;
        }

        // Preparar dados atualizados da corrida
        const updatedRacecard: IRaceCard_Spb = {
          id: race.id,
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

        // Atualizar corrida
        const { error: upsertError } = await supabase
          .schema("hml")
          .from("racecards_hr_enriched")
          .upsert(updatedRacecard, { onConflict: "id" });

        if (upsertError) {
          console.error(`Erro ao atualizar corrida ${race.id}:`, upsertError);
          continue;
        }

        updatedRaces++;

        // Atualizar cavalos da corrida
        for (const detail of mdbRacedetail) {
          for (const horse of detail.horses) {
            // Buscar ID do cavalo no Supabase
            const { data: horseData, error: horseError } = await supabase
              .schema("hml")
              .from("race_horses_hr_enriched")
              .select("id")
              .eq("racecard_id", race.id)
              .eq("id_horse", horse.id_horse);

            if (horseError) {
              console.error(
                `Erro ao buscar cavalo ${horse.id_horse}:`,
                horseError,
              );
              continue;
            }

            const horses = (horseData ?? []) as { id: number }[];

            if (horses.length === 0) {
              console.warn(
                `Cavalo ${horse.id_horse} (${horse.horse}) não encontrado para corrida ${race.id}`,
              );
              continue;
            }

            // Atualizar cada registro do cavalo
            for (const { id } of horses) {
              const updatedHorse: IRaceHorse_Spb = {
                id,
                id_horse: horse.id_horse,
                horse: horse.horse,
                age: horse.age,
                racecard_id: race.id,
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
                sp_decimal: convertSpToDecimal(horse.sp), // Adicionar SP decimal
                trainer: horse.trainer,
                weight: horse.weight,
              };

              const { error: updateHorseError } = await supabase
                .schema("hml")
                .from("race_horses_hr_enriched")
                .upsert(updatedHorse, { onConflict: "id" });

              if (updateHorseError) {
                console.error(
                  `Erro ao atualizar cavalo ${id}:`,
                  updateHorseError,
                );
              } else {
                updatedHorses++;
              }
            }
          }
        }

        // Log se a corrida foi finalizada
        if (mdbRacecard.finished === 1) {
          console.log(
            `✅ Corrida ${race.id_race} (${mdbRacecard.course}) finalizada`,
          );
        }
      } catch (error) {
        console.error(`Erro ao processar corrida ${race.id}:`, error);
      }
    }

    console.log("\n📊 Resumo da atualização:");
    console.log(`  - Corridas atualizadas: ${updatedRaces}`);
    console.log(`  - Cavalos atualizados: ${updatedHorses}`);
    console.log(`  - Corridas deletadas: ${deletedRaces}`);
  } catch (error) {
    console.error("❌ Erro na atualização de racecards:", error);
    throw error;
  }
};

/**
 * Atualiza resultados dos picks de lay betting
 */
export const updateLayBettingResults = async (): Promise<void> => {
  console.log("\n🎯 Iniciando atualização de resultados dos picks...");

  try {
    // Buscar picks pendentes
    const { data: pendingPicks, error: pickError } = await supabase
      .schema("hml")
      .from("lay_betting_picks")
      .select(
        "id, racecard_id, race_horse_id, predicted_probability, market_odd",
      )
      .eq("result", "PENDING");

    if (pickError) {
      throw new Error(`Erro ao buscar picks pendentes: ${pickError.message}`);
    }

    if (!pendingPicks || pendingPicks.length === 0) {
      console.log("i Nenhum pick pendente para atualizar");
      return;
    }

    console.log(`📊 ${pendingPicks.length} picks para validar`);

    let updated = 0;
    let won = 0;
    let lost = 0;
    let voided = 0;

    for (const pick of pendingPicks) {
      try {
        // Buscar posição do cavalo
        const { data: horseData, error: horseError } = await supabase
          .schema("hml")
          .from("race_horses_hr_enriched")
          .select("position, non_runner")
          .eq("id", pick.race_horse_id)
          .single();

        if (horseError || !horseData) {
          continue; // Corrida ainda não finalizada
        }

        // Verificar se a corrida foi finalizada
        const { data: raceData, error: raceError } = await supabase
          .schema("hml")
          .from("racecards_hr_enriched")
          .select("finished, canceled")
          .eq("id", pick.racecard_id)
          .single();

        if (raceError || !raceData || raceData.finished === 0) {
          continue; // Corrida ainda não finalizada
        }

        let result: string;
        let profitLoss = 0;
        const stake = 100; // Stake padrão

        // Determinar resultado
        if (raceData.canceled === 1 || horseData.non_runner === 1) {
          result = "VOID";
          profitLoss = 0; // Aposta anulada, sem ganho ou perda
          voided++;
        } else if (horseData.position === 1) {
          result = "LOST"; // Cavalo ganhou, lay bet perdeu
          // Calcular liability baseado na odd
          const liability = pick.market_odd
            ? stake * (pick.market_odd - 1)
            : stake;
          profitLoss = -liability;
          lost++;
        } else {
          result = "WON"; // Cavalo não ganhou, lay bet ganhou
          profitLoss = stake;
          won++;
        }

        // Atualizar resultado no banco
        const { error: updateError } = await supabase
          .schema("hml")
          .from("lay_betting_picks")
          .update({
            result: result,
            profit_loss: profitLoss,
            actual_position: horseData.position,
          })
          .eq("id", pick.id);

        if (!updateError) {
          updated++;

          // Log para resultados importantes
          if (result === "LOST") {
            console.log(
              `  ❌ LOST: Cavalo venceu (pos ${horseData.position}) - Perda: ${profitLoss.toFixed(2)}`,
            );
          }
        }

        // Também atualizar na tabela de predições se existir
        await updatePredictionStatus(pick.race_horse_id, horseData.position);
      } catch (error) {
        console.error(`Erro ao processar pick ${pick.id}:`, error);
      }
    }

    // Calcular estatísticas
    const winRate = updated > 0 ? ((won / (won + lost)) * 100).toFixed(1) : "0";

    console.log("\n📊 Resumo dos resultados:");
    console.log(`  - Picks atualizados: ${updated}`);
    console.log(`  - Ganhos (WON): ${won}`);
    console.log(`  - Perdidos (LOST): ${lost}`);
    console.log(`  - Anulados (VOID): ${voided}`);
    console.log(`  - Taxa de acerto: ${winRate}%`);
  } catch (error) {
    console.error("❌ Erro na atualização de resultados:", error);
    throw error;
  }
};

/**
 * Atualiza status das predições após resultado
 */
async function updatePredictionStatus(
  raceHorseId: number,
  actualPosition: number,
): Promise<void> {
  try {
    const { data: prediction, error: fetchError } = await supabase
      .schema("hml")
      .from("prediction_enriched_horse_features")
      .select("id, predicted_probability, lay_recommendation")
      .eq("race_horse_id", raceHorseId)
      .single();

    if (fetchError || !prediction) return;

    // Determinar se a predição estava correta
    let predictionCorrect = false;

    // Para lay betting, correto significa que o cavalo NÃO ganhou
    if (actualPosition !== 1) {
      predictionCorrect = true;
    }

    // Se foi uma recomendação STRONG_LAY ou LAY e o cavalo não ganhou, foi acerto
    if (
      (prediction.lay_recommendation === "STRONG_LAY" ||
        prediction.lay_recommendation === "LAY") &&
      actualPosition !== 1
    ) {
      predictionCorrect = true;
    }

    const { error: updateError } = await supabase
      .schema("hml")
      .from("prediction_enriched_horse_features")
      .update({
        prediction_status: actualPosition === 1 ? "LOST" : "WON",
        actual_position: actualPosition,
        prediction_correct: predictionCorrect,
      })
      .eq("id", prediction.id);

    if (updateError) {
      console.error("Erro ao atualizar status da predição:", updateError);
    }
  } catch (error) {
    console.error("Erro em updatePredictionStatus:", error);
  }
}

/**
 * Converte SP fracional para decimal
 */
function convertSpToDecimal(sp: string | null): number | null {
  if (!sp || sp === "" || sp === "NR") return null;

  // Se já for decimal
  if (sp.includes(".")) {
    return Number.parseFloat(sp);
  }

  // Se for fracional (ex: "5/1", "11/4")
  if (sp.includes("/")) {
    const [numerator, denominator] = sp.split("/").map(Number);
    if (denominator === 0) return null;
    return 1 + numerator / denominator;
  }

  // Se for apenas um número
  const num = Number.parseFloat(sp);
  return Number.isNaN(num) ? null : num;
}
