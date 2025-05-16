import { types } from "node:util";
import { supabase } from "../../..";
import { create } from "node:domain";

interface CheckHorseResultLength {
  id_horse: number;
  horse_results_hr:
    | {
        count: number;
      }[]
    | { count: number };
}

export const checkHorseResultLength = async () => {
  const { data: horsesWithStats, error } = await supabase
    .from("horse_stats_hr")
    .select("id_horse, horse_results_hr(count)");

  if (error) {
    throw new Error(`Erro ao executar query: ${error}`);
  }

  if (!horsesWithStats) return;

  // console.log(horsesWithStats);

  const qualifiedHorseIds = new Set<number>();
  for (const stats of horsesWithStats as CheckHorseResultLength[]) {
    let count = 0;
    if (
      stats.horse_results_hr &&
      Array.isArray(stats.horse_results_hr) &&
      stats.horse_results_hr.length > 0
    ) {
      count = stats.horse_results_hr[0].count;
    }

    if (stats.id_horse !== null && stats.id_horse !== 0 && count >= 3) {
      qualifiedHorseIds.add(stats.id_horse);
    }
  }

  if (qualifiedHorseIds.size === 0) {
    console.log("Sem cavalos com mais de 3 corridas.");
    return;
  }

  const { data: unfinishedRaceCards, error: raceCardError } = await supabase
    .from("racecards_hr")
    .select("id")
    .eq("finished", "0");

  if (raceCardError) {
    throw new Error(`Erro ao executar query: ${error}`);
  }

  if (!unfinishedRaceCards) return;

  const racecardIdToUpdate: number[] = [];

  for (const racecard of unfinishedRaceCards) {
    const racecardId = racecard.id;

    const { data: horses, error: horsesError } = await supabase
      .from("race_horses_hr")
      .select("id_horse")
      .eq("racecard_id", racecardId);

    if (horsesError) {
      throw new Error(`Erro ao executar query: ${error}`);
    }

    if (!horses || horses.length === 0) {
      continue;
    }

    let allHorsesAreQualified = true;
    for (const hr of horses) {
      if (hr.id_horse === null || !qualifiedHorseIds.has(hr.id_horse)) {
        allHorsesAreQualified = false;
        break;
      }
    }

    if (allHorsesAreQualified) {
      racecardIdToUpdate.push(racecardId);
    }
  }

  if (racecardIdToUpdate.length > 0) {
    const { data: updateData, error: updateError } = await supabase
      .from("racecards_hr")
      .update({ create_entry: true })
      .in("id", racecardIdToUpdate);

    if (updateError) {
      throw new Error(`Erro ao executar query: ${error}`);
    }
  }
};
