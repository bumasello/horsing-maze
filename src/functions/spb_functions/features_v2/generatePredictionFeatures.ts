import {
  convertFurlongsToMeters,
  convertHorseWeightToKg,
} from "../../utils/auxFunctions";
import { encodeGoing } from "./aux/encodeGoing";
import { calculateHistoricalFeatures } from "./utils/calculateHistorialFeatures";
import { calculateJockeyFeatures } from "./utils/calculateJockeyFeatures";
import { fetchHorseHistoryBeforeDate } from "./utils/fetchHorseForRace";
import { fetchHorsesForRace } from "./utils/fetchHorsesForRace";
import { fetchUpcoming, fetchUpcomingEntrie } from "./utils/fetchUpcomingRaces";
import { savePredictionFeature } from "./utils/savePredictionFeatures";

export const generatePredictionFeatures = async () => {
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
        );

        // 7. Calcular features do jóquei
        const jockeyFeatures = await calculateJockeyFeatures(
          horse.jockey || "",
          horse.id_horse || 0,
          race,
        );

        // 8. Combinar todas as features
        const featureEntry = {
          race_horse_id: horse.id,
          race_id: race.id,

          // Features da corrida
          going_encoded: encodeGoing(race.going || ""),
          distance_meters: convertFurlongsToMeters(race.distance || ""),
          field_size: horses.length,
          race_class: race.class || 0,

          // Features do cavalo
          horse_age: horse.age || 0,
          weight_kg: convertHorseWeightToKg(horse.weight || ""),
          or_rating: horse.or_rating || 0,

          // Features históricas
          ...historicalFeatures,

          // Features do jóquei
          ...jockeyFeatures,
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
