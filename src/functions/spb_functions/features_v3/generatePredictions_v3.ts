import * as tf from "@tensorflow/tfjs-node";
import { supabase } from "../../..";
import { getLatestModelPathFromSupabase_v3 } from "../../tensor_functions/getLatestModelPathFromSupabase";
import type { PredictionFeature } from "../../tensor_functions/interfaces";

// Interface para os parâmetros de normalização
interface NormalizationParams {
  mean: number[];
  std: number[];
  featureKeys: string[];
}

// Função normalizeFeatures corrigida para usar todos os parâmetros
export function normalizeFeatures(
  xTensor: tf.Tensor2D,
  normalization: NormalizationParams,
): tf.Tensor2D {
  return tf.tidy(() => {
    const xMean = tf.tensor1d(normalization.mean);
    const xStd = tf.tensor1d(normalization.std);
    const normalized = xTensor.sub(xMean).div(xStd) as tf.Tensor2D;
    xMean.dispose();
    xStd.dispose();
    return normalized;
  });
}

// Função para carregar o modelo e os parâmetros de normalização
async function loadModelAndNormalization(): Promise<{
  model: tf.LayersModel;
  normalization: NormalizationParams;
} | null> {
  try {
    // Obter os caminhos do modelo e dos parâmetros de normalização
    const modelPaths = await getLatestModelPathFromSupabase_v3();

    if (!modelPaths) {
      console.log("Nenhum modelo encontrado no Supabase.");
      return null;
    }

    const { modelJsonPath, normJsonPath } = modelPaths;

    const { data: modelUrlData } = supabase.storage
      .from("modelos-tfjs-publicos")
      .getPublicUrl(modelJsonPath);

    const { data: normUrlData } = supabase.storage
      .from("modelos-tfjs-publicos")
      .getPublicUrl(normJsonPath);

    if (!modelUrlData?.publicUrl || !normUrlData?.publicUrl) {
      throw new Error(
        "Falha ao obter URLs públicas do modelo ou parâmetrosde normalização.",
      );
    }
    // Carregar o modelo
    console.log(`Carregando modelo de ${modelUrlData.publicUrl}`);
    const model = await tf.loadLayersModel(modelUrlData.publicUrl);

    // Carregar os parâmetros de normalização
    console.log(
      `Carregando parâmetros de normalização de ${normUrlData.publicUrl}`,
    );

    const normResponse = await fetch(normUrlData.publicUrl);
    if (!normResponse.ok) {
      throw new Error(
        `Erro ao buscar normalization.json: ${normResponse.statusText}`,
      );
    }
    const normalization = (await normResponse.json()) as NormalizationParams;

    return { model, normalization };
  } catch (error) {
    console.error(
      "Erro ao carregar modelo e parâmetros de normalização.",
      error,
    );
    return null;
  } // Se modelPaths for uma string (caminho direto do modelo)
}

export const generatePredictions_v3 = async (): Promise<void> => {
  try {
    console.log("Iniciando geração de previsões com o modelo treinado...");

    console.log("Carregando modelo treinado mais recente...");
    const loadedModel = await loadModelAndNormalization();

    if (!loadedModel) {
      throw new Error(
        "Nenhum modelo treinado encontrado. Execute o treinamento primeiro.",
      );
    }

    const { model, normalization } = loadedModel;

    // 2. Buscar features de previsão da tabela
    console.log("Buscando features de previsão...");
    const { data: predictionFeatures, error: featuresError } = await supabase
      .schema("hml")
      .from("prediction_horse_features")
      .select("*");

    if (featuresError) {
      throw new Error(
        `Erro ao buscar features de previsão: ${JSON.stringify(featuresError)}`,
      );
    }

    if (!predictionFeatures || predictionFeatures.length === 0) {
      console.log(
        "Nenhuma feature de previsão encontrada. Execute generatePredictionFeatures() primeiro.",
      );
      return;
    }

    const typedPredictionFeatures: PredictionFeature[] =
      predictionFeatures as PredictionFeature[];

    console.log(
      `Encontradas ${typedPredictionFeatures.length} features de previsão para processamento.`,
    );

    // 3. Agrupar features por corrida
    const featuresByRace: Record<number, PredictionFeature[]> = {};

    for (const feature of predictionFeatures) {
      if (!featuresByRace[feature.race_id]) {
        featuresByRace[feature.race_id] = [];
      }
      featuresByRace[feature.race_id].push(feature);
    }

    // 4. Para cada corrida, fazer previsões
    for (const raceId in featuresByRace) {
      const raceFeatures = featuresByRace[raceId];
      console.log(
        `Processando previsões para corrida ${raceId} (${raceFeatures.length} cavalos)...`,
      );

      // Usar as features definidas nos parâmetros de normalização
      const featureKeys = normalization.featureKeys;

      if (!featureKeys || featureKeys.length === 0) {
        throw new Error(
          "Lista de features não encontrada nos parâmetros de normalização.",
        );
      }

      // Preparar dados para o modelo
      const xs = raceFeatures.map((e) =>
        featureKeys.map((k) => {
          const value = (e as any)[k];
          return value === null || value === undefined ? 0 : (value as number);
        }),
      );

      // Normalizar os dados (usando as mesmas estatísticas do treinamento)
      const xsArray = xs.map((arr) =>
        arr.map((val) => (Number.isNaN(val) ? 0 : val)),
      );

      const xTensor = tf.tensor2d(xsArray);

      // Aplicar a mesma normalização usada no treinamento
      const normalizedInput = normalizeFeatures(xTensor, normalization);

      // Fazer previsões com o modelo
      const probsTensor = model.predict(normalizedInput) as tf.Tensor;
      const probArr: number[] = Array.from(probsTensor.dataSync());

      // logica de desempate
      const adjustedProbArr: number[] = [...probArr];
      const PROB_DIFFERENCE_THRESHOLD = 0.0001;

      // encontrar o cavalo com a maior probabilidade de perder
      const maxProb = Math.max(...probArr);
      const topProbHorsesIndices = probArr
        .map((p, i) => (p === maxProb ? i : -1))
        .filter((i) => i !== -1);

      if (topProbHorsesIndices.length > 1) {
        console.warn(
          `ALERTA: Múltiplos cavalos com a maior probabilidade (${maxProb}). Aplicando a lógica de desempate.`,
        );

        const orRatings = topProbHorsesIndices.map(
          (idx) => raceFeatures[idx].or_rating || 0,
        );
        const maxOrRating = Math.max(...orRatings);
        const bestOrRatingHorsesIndices = topProbHorsesIndices.filter(
          (idx) => raceFeatures[idx].or_rating === maxOrRating,
        );

        if (bestOrRatingHorsesIndices.length > 1) {
          console.warn(
            "ALERTA: Múltiplos cavalos com a maior probabilidade e o maior OR rating. Aplicando desempate secundário (recent_form).",
          );
          // Usar recent_form como segundo critério de desempate (menor recent_form é melhor)
          const recentForms = bestOrRatingHorsesIndices.map(
            (idx) => raceFeatures[idx].recent_form || 0,
          );
          const minRecentForm = Math.min(...recentForms);
          const bestRecentFormHorsesIndices = bestOrRatingHorsesIndices.filter(
            (idx) => raceFeatures[idx].recent_form === minRecentForm,
          );

          if (bestRecentFormHorsesIndices.length > 1) {
            console.warn(
              "ALERTA: Ainda há empates após OR rating e recent_form. Selecionando o primeiro cavalo restante.",
            );
            // Se ainda houver empate, selecionar o primeiro da lista (arbitrário)
            const finalIndex = bestRecentFormHorsesIndices[0];
            // Ajustar probabilidades para que apenas o cavalo selecionado tenha a maior probabilidade
            for (let i = 0; i < adjustedProbArr.length; i++) {
              if (i !== finalIndex) {
                adjustedProbArr[i] =
                  adjustedProbArr[i] - PROB_DIFFERENCE_THRESHOLD; // Reduzir ligeiramente a prob dos outros
              }
            }
          } else {
            const finalIndex = bestRecentFormHorsesIndices[0];
            for (let i = 0; i < adjustedProbArr.length; i++) {
              if (i !== finalIndex) {
                adjustedProbArr[i] =
                  adjustedProbArr[i] - PROB_DIFFERENCE_THRESHOLD;
              }
            }
          }
        } else {
          const finalIndex = bestOrRatingHorsesIndices[0];
          for (let i = 0; i < adjustedProbArr.length; i++) {
            if (i !== finalIndex) {
              adjustedProbArr[i] =
                adjustedProbArr[i] - PROB_DIFFERENCE_THRESHOLD;
            }
          }
        }
      }
      const predictions = raceFeatures.map((feature, i) => ({
        racecard_id: Number.parseInt(raceId),
        race_horse_id: feature.race_horse_id,
        probability: adjustedProbArr[i],
      }));

      const { error: deleteError } = await supabase
        .schema("hml")
        .from("horse_predictions")
        .delete()
        .eq("racecard_id", raceId);

      if (deleteError) {
        console.error(
          `Erro ao limpar previsões existentes: ${deleteError.message}`,
        );
      }

      const { error: insertError } = await supabase
        .schema("hml")
        .from("horse_predictions")
        .insert(predictions);

      if (insertError) {
        throw new Error(
          `Erro salvando previsões para corrida ${raceId}: ${insertError.message}`,
        );
      }
      const maxIdx = adjustedProbArr.indexOf(Math.max(...adjustedProbArr));
      const loser = raceFeatures[maxIdx];
      console.log(
        `Corrida ${raceId} (${raceFeatures.length} candidatos):` +
          ` cavalo \'${loser.race_horse_id}\' com prob. ${(adjustedProbArr[maxIdx] * 100).toFixed(1)}% de NÃO vencer.`,
      );

      tf.dispose([xTensor, normalizedInput, probsTensor]);
    }
    console.log("Geração de previsões concluída com sucesso.");
  } catch (error) {
    console.error("Erro na geração de previsões:", error);
    throw error;
  }
};
