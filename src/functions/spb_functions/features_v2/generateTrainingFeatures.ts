import { fetchFinishedRaces } from "./utils/fetchFinishedRaces";
import { fetchHorsesForRace } from "./utils/fetchHorsesForRace";
import { fetchHorseHistoryBeforeDate } from "./utils/fetchHorseForRace";
import { calculateHistoricalFeatures } from "./utils/calculateHistorialFeatures";
import { calculateJockeyFeatures } from "./utils/calculateJockeyFeatures";
import { convertFurlongsToMeters } from "../../utils/auxFunctions";
import { convertHorseWeightToKg } from "../../utils/auxFunctions";
import { saveTrainingFeature } from "./utils/saveTrainingFeature";
import { encodeGoing } from "./aux/encodeGoing";

export const generateTrainingFeatures = async (): Promise<void> => {
  try {
    console.log("Iniciando geração de features para treinamento...");

    // 1. Buscar corridas finalizadas
    const finishedRaces = await fetchFinishedRaces();
    console.log(
      `Encontradas ${finishedRaces.length} corridas finalizadas para processamento.`,
    );

    let featuresCount = 0;

    // 2. Para cada corrida
    for (const race of finishedRaces) {
      console.log(
        `Processando corrida ${race.id} (${race.course}, ${race.date})...`,
      );

      // 3. Buscar todos os cavalos da corrida
      const horses = await fetchHorsesForRace(race.id);
      console.log(
        `Encontrados ${horses.length} cavalos para a corrida ${race.id}.`,
      );

      // 4. Para cada cavalo
      for (const horse of horses) {
        // Pular cavalos que não correram
        if (horse.non_runner === 1) {
          console.log(
            `Cavalo ${horse.id} (${horse.horse}) não correu, pulando.`,
          );
          continue;
        }

        // 5. Buscar histórico do cavalo até a data da corrida
        const horseHistory = await fetchHorseHistoryBeforeDate(
          horse.id_horse || 0,
          race.date,
        );

        // 6. Calcular features históricas
        const historicalFeatures = calculateHistoricalFeatures(
          horseHistory,
          race,
        );

        // 7. Calcular features do jóquei
        const jockeyFeatures = await calculateJockeyFeatures(
          horse.jockey || "",
          horse.id_horse || 0,
          race,
        );

        // 8. Definir target (0 se venceu, 1 se não venceu)
        const target = horse.position === 1 ? 0 : 1;

        // 9. Combinar todas as features
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

          // Target
          target: target,
        };

        // 10. Salvar na tabela de features de treinamento
        await saveTrainingFeature(featureEntry);
        featuresCount++;
      }
    }

    console.log(
      `Geração de features concluída. Total de ${featuresCount} features geradas.`,
    );
  } catch (error) {
    console.log(error);
    console.error("Erro na geração de features para treinamento:", error);
    const detalhe =
      error instanceof Error
        ? `${error.message}\n${error.stack}`
        : JSON.stringify(error, null, 2);
    throw new Error(`Erro ao salvar feature de treinamento: ${detalhe}`);
  }
};
