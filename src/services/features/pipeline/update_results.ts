// features_v4/ml/update_results.ts

import { supabase } from "../../..";
import mdbFunctions_RaceCard from "../../../integrations/mongodb/getRaceCard_Hr";
import mdbFunctions_RaceDetail from "../../../integrations/mongodb/getRaceDetail_Hr";

/**
 * Atualiza racecards e race details do MongoDB para Supabase
 */
export const updateRacecardsAndDetails = async (): Promise<void> => {
  console.log("Iniciando atualização de corridas e cavalos...");

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
    console.log("Nenhuma corrida pendente para atualizar.");
    return;
  }

  console.log(`${unFinished.length} corridas para atualizar.`);

  let updatedRaces = 0;
  let updatedHorses = 0;
  let deletedRaces = 0;

  // Busca todos os cavalos de todas as corridas de uma vez
  const racecardIds = unFinished.map((r) => r.id);
  const { data: allSpbHorses, error: allHorsesError } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select("id, racecard_id, id_horse")
    .in("racecard_id", racecardIds);

  if (allHorsesError) {
    throw new Error(
      `Erro ao carregar cavalos do Supabase: ${allHorsesError.message}`,
    );
  }

  // Mapeia cavalos por racecard_id + id_horse em memória
  const horsesMap = new Map<string, number>();
  for (const h of allSpbHorses || []) {
    horsesMap.set(`${h.racecard_id}:${h.id_horse}`, h.id);
  }

  for (const race of unFinished) {
    try {
      // Busca MongoDB em paralelo
      const [mdbRacecard, mdbRacedetail] = await Promise.all([
        mdbFunctions_RaceCard.getOneStoredRaceCard_Hr(race.id_race),
        mdbFunctions_RaceDetail.getStoredRaceDetail_Hr(race.id_race),
      ]);

      // Se não encontrar no MongoDB, remove do Supabase
      if (!mdbRacecard || !mdbRacedetail || mdbRacedetail.length === 0) {
        console.log(
          `Corrida ${race.id_race} não encontrada no MongoDB, deletando...`,
        );

        const { error: deleteError } = await supabase
          .schema("hml")
          .from("racecards_hr_enriched")
          .delete()
          .eq("id_race", race.id_race);

        if (deleteError) {
          console.error(
            `Erro ao deletar corrida ${race.id_race}:`,
            deleteError.message,
          );
        } else {
          deletedRaces++;
        }
        continue;
      }

      // Upsert do racecard
      const { error: upsertError } = await supabase
        .schema("hml")
        .from("racecards_hr_enriched")
        .upsert(
          {
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
          },
          { onConflict: "id" },
        );

      if (upsertError) {
        console.error(
          `Erro ao atualizar corrida ${race.id}:`,
          upsertError.message,
        );
        continue;
      }

      updatedRaces++;

      if (mdbRacecard.finished === 1) {
        console.log(
          `Corrida ${race.id_race} (${mdbRacecard.course}) finalizada.`,
        );
      }

      // Upsert dos cavalos usando o map em memória — sem queries extras
      for (const detail of mdbRacedetail) {
        for (const horse of detail.horses) {
          const spbHorseId = horsesMap.get(`${race.id}:${horse.id_horse}`);

          if (!spbHorseId) {
            console.warn(
              `Cavalo ${horse.id_horse} (${horse.horse}) não encontrado para corrida ${race.id}.`,
            );
            continue;
          }

          const { error: updateHorseError } = await supabase
            .schema("hml")
            .from("race_horses_hr_enriched")
            .upsert(
              {
                id: spbHorseId,
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
                sp_decimal: convertSpToDecimal(horse.sp),
                trainer: horse.trainer,
                weight: horse.weight,
              },
              { onConflict: "id" },
            );

          if (updateHorseError) {
            console.error(
              `Erro ao atualizar cavalo ${spbHorseId}:`,
              updateHorseError.message,
            );
          } else {
            updatedHorses++;
          }
        }
      }
    } catch (error) {
      console.error(`Erro ao processar corrida ${race.id}:`, error);
    }
  }

  console.log(
    `Resumo: ${updatedRaces} corridas atualizadas, ${updatedHorses} cavalos atualizados, ${deletedRaces} corridas deletadas.`,
  );
};

/**
 * Atualiza resultados dos picks de lay betting
 */
export const updateLayBettingResults = async (): Promise<void> => {
  console.log("Iniciando atualização de resultados dos picks...");

  const { data: pendingPicks, error: pickError } = await supabase
    .schema("hml")
    .from("lay_betting_picks")
    .select("id, racecard_id, race_horse_id, predicted_probability, market_odd")
    .eq("result", "PENDING");

  if (pickError) {
    throw new Error(`Erro ao buscar picks pendentes: ${pickError.message}`);
  }

  if (!pendingPicks || pendingPicks.length === 0) {
    console.log("Nenhum pick pendente para atualizar.");
    return;
  }

  console.log(`${pendingPicks.length} picks para validar.`);

  // Busca todos os cavalos e corridas relevantes de uma vez
  const raceHorseIds = pendingPicks.map((p) => p.race_horse_id);
  const racecardIds = [...new Set(pendingPicks.map((p) => p.racecard_id))];

  const [
    { data: allHorses, error: horsesError },
    { data: allRaces, error: racesError },
  ] = await Promise.all([
    supabase
      .schema("hml")
      .from("race_horses_hr_enriched")
      .select("id, position, non_runner")
      .in("id", raceHorseIds),
    supabase
      .schema("hml")
      .from("racecards_hr_enriched")
      .select("id, finished, canceled")
      .in("id", racecardIds),
  ]);

  if (horsesError)
    throw new Error(`Erro ao buscar cavalos: ${horsesError.message}`);
  if (racesError)
    throw new Error(`Erro ao buscar corridas: ${racesError.message}`);

  // Maps em memória para lookup O(1)
  const horsesMap = new Map((allHorses || []).map((h) => [h.id, h]));
  const racesMap = new Map((allRaces || []).map((r) => [r.id, r]));

  let updated = 0;
  let won = 0;
  let lost = 0;
  let voided = 0;

  for (const pick of pendingPicks) {
    try {
      const horseData = horsesMap.get(pick.race_horse_id);
      const raceData = racesMap.get(pick.racecard_id);

      // Pula se corrida ainda não finalizada
      if (!horseData || !raceData || raceData.finished === 0) continue;

      const stake = 100;
      let result: string;
      let profitLoss: number;

      if (raceData.canceled === 1 || horseData.non_runner === 1) {
        result = "VOID";
        profitLoss = 0;
        voided++;
      } else if (horseData.position === 1) {
        result = "LOST";
        const liability = pick.market_odd
          ? stake * (pick.market_odd - 1)
          : stake;
        profitLoss = -liability;
        lost++;
        console.log(
          `LOST: Cavalo venceu (pos ${horseData.position}) - Perda: ${profitLoss.toFixed(2)}`,
        );
      } else {
        result = "WON";
        profitLoss = stake;
        won++;
      }

      const { error: updateError } = await supabase
        .schema("hml")
        .from("lay_betting_picks")
        .update({
          result,
          profit_loss: profitLoss,
          actual_position: horseData.position,
        })
        .eq("id", pick.id);

      if (updateError) {
        console.error(
          `Erro ao atualizar pick ${pick.id}:`,
          updateError.message,
        );
        continue;
      }

      updated++;

      // Atualiza predição — position === 0 é VOID, não WON
      await updatePredictionStatus(
        pick.race_horse_id,
        horseData.position,
        raceData.canceled,
        horseData.non_runner,
      );
    } catch (error) {
      console.error(`Erro ao processar pick ${pick.id}:`, error);
    }
  }

  const winRate =
    won + lost > 0 ? ((won / (won + lost)) * 100).toFixed(1) : "0";

  console.log(
    `Resumo: ${updated} atualizados | WON: ${won} | LOST: ${lost} | VOID: ${voided} | Taxa de acerto: ${winRate}%`,
  );
};

/**
 * Atualiza status das predições após resultado
 */
async function updatePredictionStatus(
  raceHorseId: number,
  actualPosition: number,
  canceled: number,
  nonRunner: number,
): Promise<void> {
  try {
    const { data: prediction, error: fetchError } = await supabase
      .schema("hml")
      .from("prediction_enriched_horse_features")
      .select("id")
      .eq("race_horse_id", raceHorseId)
      .single();

    if (fetchError || !prediction) return;

    let predictionStatus: string;
    let predictionCorrect: boolean | null;

    if (canceled === 1 || nonRunner === 1) {
      predictionStatus = "VOID";
      predictionCorrect = null; // Sem resultado válido
    } else if (actualPosition === 1) {
      predictionStatus = "LOST";
      predictionCorrect = false;
    } else {
      predictionStatus = "WON";
      predictionCorrect = true;
    }

    const { error: updateError } = await supabase
      .schema("hml")
      .from("prediction_enriched_horse_features")
      .update({
        prediction_status: predictionStatus,
        actual_position: actualPosition,
        prediction_correct: predictionCorrect,
      })
      .eq("id", prediction.id);

    if (updateError) {
      console.error(
        "Erro ao atualizar status da predição:",
        updateError.message,
      );
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
