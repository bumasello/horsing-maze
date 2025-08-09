import { fetchHorsesForRace } from "./utils/fetchHorsesForRace";
import { fetchHorseHistoryBeforeDate } from "./utils/fetchHorseForRace";
import { calculateHistoricalFeatures } from "./utils/calculateHistorialFeatures";
import { calculateJockeyFeatures } from "./utils/calculateJockeyFeatures";
import { convertFurlongsToMeters } from "../../utils/auxFunctions";
import { convertHorseWeightToKg } from "../../utils/auxFunctions";
import { encodeGoing } from "./aux/encodeGoing";
import { fetchUpcoming, fetchUpcomingEntrie } from "./utils/fetchUpcomingRaces";
import { savePredictionFeature } from "./utils/savePredictionFeatures";

import type { PredictionFeature } from "../../tensor_functions/interfaces";
import { calculateTrainerFeatures } from "./utils/calculateTrainerFeatures";

export const generatePredictionFeatures_v3 = async () => {
  try {
    console.log("Iniciando geração de features para previsão...");

    // 1. Buscar corridas não finalizadas
    const upcomingRaces = await fetchUpcomingEntrie();
    console.log(
      `Encontradas ${upcomingRaces.length} corridas pendentes para previsão.`,
    );

    const allPredictionFeatures: any[] = [];

    // 2. Para cada corrida
    for (const race of upcomingRaces) {
      console.log(
        `Processando corrida ${race.id} (${race.course}, ${race.date})...`,
      );

      // 3. Buscar todos os cavalos da corrida
      const horses = await fetchHorsesForRace(race.id);
      console.log(
        `Encontrados ${horses.length} cavalos para a corrida ${race.id}.`,
      );

      const runningHorsesWithOR = horses
        .filter((h) => h.non_runner !== 1 && typeof h.or_rating === "number")
        .map((h) => ({ id: h.id, or_rating: h.or_rating as number }));

      const oppositionRatingsMap = new Map<number, number>();

      if (runningHorsesWithOR.length > 1) {
        const totalOrSum = runningHorsesWithOR.reduce(
          (sum, h) => sum + h.or_rating,
          0,
        );

        for (const horse of runningHorsesWithOR) {
          const oppositionOrSum = totalOrSum - horse.or_rating;
          const oppositionCount = runningHorsesWithOR.length - 1;
          const avg_or_rating_opposition = oppositionOrSum / oppositionCount;
          oppositionRatingsMap.set(horse.id, avg_or_rating_opposition);
        }
      }

      const racePredictionFeatures: any[] = [];

      // 4. Para cada cavalo
      for (const horse of horses) {
        // Pular cavalos que não vão correr
        if (horse.non_runner === 1) {
          console.log(
            `Cavalo ${horse.id} (${horse.horse}) não vai correr, pulando.`,
          );
          continue;
        }

        // 5. Buscar histórico do cavalo até a data atual
        const horseHistory = await fetchHorseHistoryBeforeDate(
          horse.id_horse || 0,
          race.date,
        );

        // 6. Calcular features históricas
        const historicalFeatures = await calculateHistoricalFeatures(
          horseHistory,
          race,
          horse.id_horse || 0,
          horse.jockey,
          horse.or_rating,
        );

        // 7. Calcular features do jóquei
        const jockeyFeatures = await calculateJockeyFeatures(
          horse.jockey || "",
          horse.id_horse || 0,
          race,
        );

        const trainerFeatures = await calculateTrainerFeatures(
          horse.trainer,
          horse.jockey,
          race,
        );

        const avg_or_rating_opposition = oppositionRatingsMap.get(
          horse.id || 0,
        );

        // 8. Combinar todas as features
        const featureEntry = {
          race_horse_id: horse.id,
          race_id: race.id,

          // Features da corrida
          going_encoded: encodeGoing(race.going || ""),
          distance_meters: convertFurlongsToMeters(race.distance || ""),
          field_size: horses.filter((h) => h.non_runner !== 1).length,
          race_class: race.class || 0,

          // Features do cavalo
          horse_age: horse.age || 0,
          weight_kg: convertHorseWeightToKg(horse.weight || ""),
          or_rating: horse.or_rating || 0,

          // Features históricas
          ...historicalFeatures,

          // Features do jóquei
          ...jockeyFeatures,

          ...trainerFeatures,
          avg_or_rating_opposition: avg_or_rating_opposition,
        };

        // 9. Salvar na tabela de features de previsão
        await savePredictionFeature(featureEntry);

        racePredictionFeatures.push(featureEntry);
      }

      allPredictionFeatures.push({
        raceId: race.id,
        features: racePredictionFeatures,
      });
    }

    console.log(
      `Geração de features para previsão concluída. Total de ${allPredictionFeatures.length} corridas processadas.`,
    );
    // return allPredictionFeatures;
  } catch (error) {
    console.error("Erro na geração de features para previsão:", error);
    throw error;
  }
};
