import {
  convertFurlongsToMeters,
  convertHorseWeightToKg,
} from "../../utils/auxFunctions";
import { encodeGoing } from "./aux/encodeGoing";
import { convertOddToDecimal } from "./utils/bettingLogic"; // Importar todas as funções de bettingLogic
import { calculateHistoricalFeatures } from "./utils/calculateHistorialFeatures";
import { calculateJockeyFeatures } from "./utils/calculateJockeyFeatures";
import { calculateTrainerFeatures } from "./utils/calculateTrainerFeatures";
import { fetchFinishedRaces } from "./utils/fetchFinishedRaces";
import { fetchHorseHistoryBeforeDate } from "./utils/fetchHorseForRace";
import { fetchHorsesForRace } from "./utils/fetchHorsesForRace";
import { saveTrainingFeature } from "./utils/saveTrainingFeature";

export const generateTrainingFeatures_v3 = async (): Promise<void> => {
  try {
    console.log(
      "Iniciando geração de features para treinamento (Sanitização Robusta)...",
    );

    const finishedRaces = await fetchFinishedRaces();
    console.log(
      `Encontradas ${finishedRaces.length} corridas finalizadas para processamento.`,
    );

    let featuresCount = 0;

    for (const race of finishedRaces) {
      console.log(
        `Processando corrida ${race.id} (${race.course}, ${race.date})...`,
      );

      const horses = await fetchHorsesForRace(race.id);

      // Calcular avg_or_rating_opposition
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

      for (const horse of horses) {
        if (horse.non_runner === 1) {
          continue; // Pula cavalos não corredores
        }

        // 1. Calcular market_implied_probability
        const decimalOdd = convertOddToDecimal(horse.sp);
        let market_implied_probability = 0;

        if (decimalOdd !== null && decimalOdd > 1) {
          market_implied_probability = 1 / decimalOdd;
        } else {
          console.warn(
            `- [Qualidade] Cavalo ${horse.horse} (ID: ${horse.id}) tem SP inválido: '${horse.sp}'. market_implied_probability será 0.`,
          );
        }

        // 2. Calcular features históricas
        const horseHistory = await fetchHorseHistoryBeforeDate(
          horse.id_horse || 0,
          race.date,
        );
        const historicalFeatures = await calculateHistoricalFeatures(
          horseHistory,
          race,
          horse.id_horse || 0,
          horse.jockey,
          horse.or_rating,
        );

        // 3. Calcular features do jóquei
        const jockeyFeatures = await calculateJockeyFeatures(
          horse.jockey || "",
          horse.id_horse || 0,
          race,
        );

        // 4. Calcular features do treinador
        const trainerFeatures = await calculateTrainerFeatures(
          horse.trainer || "", // Garantir que trainer não seja null
          horse.jockey || "", // Garantir que jockey não seja null
          race,
        );

        // 5. Definir o target
        const target = horse.position === 1 ? 0 : 1;

        // 6. Obter avg_or_rating_opposition
        const avg_or_rating_opposition =
          oppositionRatingsMap.get(horse.id) ?? 0;

        // --- CONSTRUÇÃO FINAL DA FEATURE ENTRY --- //
        // Usamos o operador '??' (Nullish Coalescing) para garantir um valor padrão
        // se a feature for null ou undefined. Isso evita que o modelo receba 'null'.
        const featureEntry = {
          race_horse_id: horse.id,
          race_id: race.id,

          // Features da corrida
          going_encoded: encodeGoing(race.going) ?? 0, // encodeGoing já trata null
          distance_meters: convertFurlongsToMeters(race.distance || "") ?? 0,
          field_size: horses.filter((h) => h.non_runner !== 1).length ?? 0,
          race_class: race.class ?? 0,

          // Features do cavalo
          horse_age: horse.age ?? 0,
          weight_kg: convertHorseWeightToKg(horse.weight || "") ?? 0,
          or_rating: horse.or_rating ?? 0,

          // Features históricas (garantindo que venham de historicalFeatures)
          avg_position: historicalFeatures.avg_position ?? 99, // 99 para indicar ausência/padrão
          position_variance: historicalFeatures.position_variance ?? 0,
          win_rate: historicalFeatures.win_rate ?? 0,
          place_rate: historicalFeatures.place_rate ?? 0,
          avg_or_rating: historicalFeatures.avg_or_rating ?? 0,
          or_trend: historicalFeatures.or_trend ?? 0,
          going_performance: historicalFeatures.going_performance ?? 99,
          distance_performance: historicalFeatures.distance_performance ?? 99,
          recent_form: historicalFeatures.recent_form ?? 99,
          days_since_last_run: historicalFeatures.days_since_last_run ?? 999,
          // Novas features históricas (se existirem na interface e forem calculadas)
          course_win_rate: (historicalFeatures as any).course_win_rate ?? 0, // Exemplo de como acessar se não estiver na interface base
          first_time_out: (historicalFeatures as any).first_time_out ?? 1,
          first_time_jockey: (historicalFeatures as any).first_time_jockey ?? 1,
          first_time_course: (historicalFeatures as any).first_time_course ?? 1,

          // Features do jóquei
          jockey_win_rate: jockeyFeatures.jockey_win_rate ?? 0,
          jockey_horse_win_rate: jockeyFeatures.jockey_horse_win_rate ?? 0,
          jockey_course_win_rate: jockeyFeatures.jockey_course_win_rate ?? 0,

          // Features do treinador
          trainer_win_rate: trainerFeatures.trainer_win_rate ?? 0,
          trainer_course_win_rate: trainerFeatures.trainer_course_win_rate ?? 0,
          jockey_trainer_win_rate: trainerFeatures.jockey_trainer_win_rate ?? 0,

          // Outras features
          avg_or_rating_opposition: avg_or_rating_opposition,
          market_implied_probability: market_implied_probability,

          // Target
          target: target,
        };

        // console.log("Feature Entry sendo enviada:", featureEntry); // Seu console.log aqui
        await saveTrainingFeature(featureEntry);
        featuresCount++;
      }
    }

    console.log(
      `\nGeração de features concluída. Total de ${featuresCount} features de alta qualidade geradas.`,
    );
  } catch (error) {
    console.error("Erro na geração de features para treinamento:", error);
    const detalhe =
      error instanceof Error
        ? `${error.message}\n${error.stack}`
        : JSON.stringify(error, null, 2);
    throw new Error(`Erro ao salvar feature de treinamento: ${detalhe}`);
  }
};
