import {
  convertFurlongsToMeters,
  convertHorseWeightToKg,
} from "../../utils/auxFunctions";
import { encodeGoing } from "./aux/encodeGoing";
// Ajuste o caminho para suas funções de utilitários
import { getAverageOdd } from "./utils/bettingLogic";
import { calculateHistoricalFeatures } from "./utils/calculateHistorialFeatures";
import { calculateJockeyFeatures } from "./utils/calculateJockeyFeatures";
import { calculateTrainerFeatures } from "./utils/calculateTrainerFeatures";
import { fetchEnrichedHistory } from "./utils/fetchEnrichedHistory";
import { fetchHorseHistoryBeforeDate } from "./utils/fetchHorseForRace";
import { fetchHorsesForRace } from "./utils/fetchHorsesForRace";
import { fetchUpcomingEntrie } from "./utils/fetchUpcomingRaces";
import { savePredictionFeature } from "./utils/savePredictionFeatures";

export const generatePredictionFeatures_v3 = async () => {
  try {
    console.log(
      "Iniciando geração de features para previsão (com Prob. de Mercado e Sanitização)...",
    );

    const upcomingRaces = await fetchUpcomingEntrie();
    console.log(
      `Encontradas ${upcomingRaces.length} corridas pendentes para previsão.`,
    );

    const allPredictionFeatures: any[] = [];

    for (const race of upcomingRaces) {
      console.log(
        `Processando corrida ${race.id} (${race.course}, ${race.date})...`,
      );

      const horses = await fetchHorsesForRace(race.id);

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

      for (const horse of horses) {
        if (horse.non_runner === 1) {
          console.log(
            `Cavalo ${horse.id} (${horse.horse}) não vai correr, pulando.`,
          );
          continue;
        }

        let market_implied_probability = 0;
        const averageOdd = await getAverageOdd(horse.id);
        if (averageOdd && averageOdd > 1) {
          market_implied_probability = 1 / averageOdd;
        }

        const horseHistory = await fetchHorseHistoryBeforeDate(
          horse.id_horse || 0,
          race.date,
        );

        const enrichedHistoryMap = await fetchEnrichedHistory(
          horse.id_horse || 0,
        );

        const historicalFeatures = await calculateHistoricalFeatures(
          horseHistory || [],
          enrichedHistoryMap,
          race,
          horse.id_horse || 0,
          horse.jockey,
          horse.or_rating,
        );
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
        const avg_or_rating_opposition = oppositionRatingsMap.get(horse.id);

        // --- LÓGICA DE CONSTRUÇÃO E SANITIZAÇÃO ROBUSTA ---
        const featureEntry = {
          race_horse_id: horse.id,
          race_id: race.id,

          // Features da corrida
          going_encoded: encodeGoing(race.going || "") ?? 0,
          distance_meters: convertFurlongsToMeters(race.distance || "") ?? 0,
          field_size: horses.filter((h) => h.non_runner !== 1).length ?? 0,
          race_class: race.class ?? 0,

          // Features do cavalo
          horse_age: horse.age ?? 0,
          weight_kg: convertHorseWeightToKg(horse.weight || "") ?? 0,
          or_rating: horse.or_rating ?? 0,

          // Features históricas
          avg_position: historicalFeatures.avg_position ?? 99,
          position_variance: historicalFeatures.position_variance ?? 0,
          win_rate: historicalFeatures.win_rate ?? 0,
          place_rate: historicalFeatures.place_rate ?? 0,
          avg_or_rating: historicalFeatures.avg_or_rating ?? 0,
          or_trend: historicalFeatures.or_trend ?? 0,
          course_avg_position: historicalFeatures.course_avg_position ?? 99,
          distance_performance: historicalFeatures.distance_performance ?? 99,
          recent_form: historicalFeatures.recent_form ?? 99,
          days_since_last_run: historicalFeatures.days_since_last_run ?? 999,
          course_win_rate: historicalFeatures.course_win_rate ?? 0,
          first_time_out: historicalFeatures.first_time_out ?? 1,
          first_time_jockey: historicalFeatures.first_time_jockey ?? 1,
          first_time_course: historicalFeatures.first_time_course ?? 1,

          // Features do jóquei
          jockey_win_rate: jockeyFeatures.jockey_win_rate ?? 0,
          jockey_horse_win_rate: jockeyFeatures.jockey_horse_win_rate ?? 0,
          jockey_course_win_rate: jockeyFeatures.jockey_course_win_rate ?? 0,

          // Features do treinador
          trainer_win_rate: trainerFeatures.trainer_win_rate ?? 0,
          trainer_course_win_rate: trainerFeatures.trainer_course_win_rate ?? 0,
          jockey_trainer_win_rate: trainerFeatures.jockey_trainer_win_rate ?? 0,

          // Outras features
          avg_or_rating_opposition: avg_or_rating_opposition ?? 0,
          market_implied_probability: market_implied_probability ?? 0,
        };

        await savePredictionFeature(featureEntry);
        racePredictionFeatures.push(featureEntry);
      }

      allPredictionFeatures.push({
        raceId: race.id,
        features: racePredictionFeatures,
      });
    }

    console.log(
      `\nGeração de features para previsão concluída. Total de ${allPredictionFeatures.length} corridas processadas.`,
    );
    // return allPredictionFeatures;
  } catch (error) {
    console.error("Erro na geração de features para previsão:", error);
    throw error;
  }
};
