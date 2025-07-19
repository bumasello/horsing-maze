"use strict";
// import * as tf from "@tensorflow/tfjs-node";
// import { supabase } from "../../..";
// import { getLatestModelPathFromSupabase } from "../../tensor_functions/trainHorseData_v2";
//
// // Interface para os parâmetros de normalização
// interface NormalizationParams {
//   mean: number[];
//   std: number[];
//   featureKeys: string[];
// }
//
// // Interface para o retorno de getLatestModelPathFromSupabase
// interface ModelPaths {
//   modelJsonPath: string;
//   normJsonPath: string;
// }
//
// // Função normalizeFeatures corrigida para usar todos os parâmetros
// export function normalizeFeatures(
//   xTensor: tf.Tensor2D,
//   normalization: NormalizationParams,
// ): tf.Tensor2D {
//   const xMean = tf.tensor1d(normalization.mean);
//   const xStd = tf.tensor1d(normalization.std);
//
//   return tf.tidy(() => {
//     const normalized = xTensor.sub(xMean).div(xStd) as tf.Tensor2D;
//     // Limpar tensores temporários
//     xMean.dispose();
//     xStd.dispose();
//     return normalized;
//   });
// }
//
// // Função para carregar o modelo e os parâmetros de normalização
// async function loadModelAndNormalization(): Promise<{
//   model: tf.LayersModel;
//   normalization: NormalizationParams;
// } | null> {
//   try {
//     // Obter os caminhos do modelo e dos parâmetros de normalização
//     const modelPaths = await getLatestModelPathFromSupabase();
//
//     if (!modelPaths) {
//       console.log("Nenhum modelo encontrado no Supabase.");
//       return null;
//     }
//
//     // Verificar se modelPaths é um objeto com modelJsonPath e normJsonPath
//     if (
//       typeof modelPaths === "object" &&
//       modelPaths !== null &&
//       "modelJsonPath" in modelPaths &&
//       "normJsonPath" in modelPaths
//     ) {
//       // Fazer cast explícito para o tipo ModelPaths
//       const paths = modelPaths as ModelPaths;
//
//       // Obter URLs públicas
//       const { data: modelUrlData } = supabase.storage
//         .from("modelos-tfjs-publicos")
//         .getPublicUrl(paths.modelJsonPath);
//
//       const { data: normUrlData } = supabase.storage
//         .from("modelos-tfjs-publicos")
//         .getPublicUrl(paths.normJsonPath);
//
//       if (!modelUrlData?.publicUrl || !normUrlData?.publicUrl) {
//         throw new Error(
//           "Falha ao obter URLs públicas do modelo ou parâmetros de normalização.",
//         );
//       }
//
//       // Carregar o modelo
//       console.log(`Carregando modelo de ${modelUrlData.publicUrl}`);
//       const model = await tf.loadLayersModel(modelUrlData.publicUrl);
//
//       // Carregar os parâmetros de normalização
//       console.log(
//         `Carregando parâmetros de normalização de ${normUrlData.publicUrl}`,
//       );
//       const normResponse = await fetch(normUrlData.publicUrl);
//       if (!normResponse.ok) {
//         throw new Error(
//           `Erro ao buscar normalization.json: ${normResponse.statusText}`,
//         );
//       }
//       const normalization = (await normResponse.json()) as NormalizationParams;
//
//       return { model, normalization };
//     }
//     // Se modelPaths for uma string (caminho direto do modelo)
//     if (typeof modelPaths === "string") {
//       // Obter URL pública do modelo
//       const { data: modelUrlData } = supabase.storage
//         .from("modelos-tfjs-publicos")
//         .getPublicUrl(modelPaths);
//
//       if (!modelUrlData?.publicUrl) {
//         throw new Error("Falha ao obter URL pública do modelo.");
//       }
//
//       // Carregar o modelo
//       console.log(`Carregando modelo de ${modelUrlData.publicUrl}`);
//       const model = await tf.loadLayersModel(modelUrlData.publicUrl);
//
//       // Tentar carregar os parâmetros de normalização
//       const normJsonPath = modelPaths.replace(
//         "model.json",
//         "normalization.json",
//       );
//       const { data: normUrlData } = supabase.storage
//         .from("modelos-tfjs-publicos")
//         .getPublicUrl(normJsonPath);
//
//       if (!normUrlData?.publicUrl) {
//         throw new Error(
//           "Falha ao obter URL pública dos parâmetros de normalização.",
//         );
//       }
//
//       const normResponse = await fetch(normUrlData.publicUrl);
//       if (!normResponse.ok) {
//         throw new Error(
//           `Erro ao buscar normalization.json: ${normResponse.statusText}`,
//         );
//       }
//       const normalization = (await normResponse.json()) as NormalizationParams;
//
//       return { model, normalization };
//     }
//
//     throw new Error("Formato de caminho do modelo não reconhecido.");
//   } catch (error) {
//     console.error(
//       "Erro ao carregar modelo e parâmetros de normalização:",
//       error,
//     );
//     return null;
//   }
// }
//
// export const generatePredictions = async (): Promise<void> => {
//   try {
//     console.log("Iniciando geração de previsões com o modelo treinado...");
//
//     // 1. Carregar o modelo treinado mais recente e os parâmetros de normalização
//     console.log("Carregando modelo treinado mais recente...");
//     const loadedModel = await loadModelAndNormalization();
//
//     if (!loadedModel) {
//       throw new Error(
//         "Nenhum modelo treinado encontrado. Execute o treinamento primeiro.",
//       );
//     }
//
//     const { model, normalization } = loadedModel;
//
//     // 2. Buscar features de previsão da tabela
//     console.log("Buscando features de previsão...");
//     const { data: predictionFeatures, error: featuresError } = await supabase
//       .schema("hml")
//       .from("prediction_horse_features")
//       .select("*");
//
//     if (featuresError) {
//       throw new Error(
//         `Erro ao buscar features de previsão: ${JSON.stringify(featuresError)}`,
//       );
//     }
//
//     if (!predictionFeatures || predictionFeatures.length === 0) {
//       console.log(
//         "Nenhuma feature de previsão encontrada. Execute generatePredictionFeatures() primeiro.",
//       );
//       return;
//     }
//
//     console.log(
//       `Encontradas ${predictionFeatures.length} features de previsão para processamento.`,
//     );
//     console.log(
//       "LOG: predictionFeatures (primeiros 5):",
//       predictionFeatures.slice(0, 5),
//     );
//
//     // 3. Agrupar features por corrida
//     const featuresByRace: Record<number, any[]> = {};
//     for (const feature of predictionFeatures) {
//       if (!featuresByRace[feature.race_id]) {
//         featuresByRace[feature.race_id] = [];
//       }
//       featuresByRace[feature.race_id].push(feature);
//     }
//
//     // 4. Para cada corrida, fazer previsões
//     for (const raceId in featuresByRace) {
//       const raceFeatures = featuresByRace[raceId];
//       console.log(
//         `Processando previsões para corrida ${raceId} (${raceFeatures.length} cavalos)...`,
//       );
//
//       // Usar as features definidas nos parâmetros de normalização
//       const featureKeys = normalization.featureKeys;
//
//       if (!featureKeys || featureKeys.length === 0) {
//         throw new Error(
//           "Lista de features não encontrada nos parâmetros de normalização.",
//         );
//       }
//
//       // Preparar dados para o modelo
//       const xs = raceFeatures.map((e) =>
//         featureKeys.map((k) => {
//           const value = (e as any)[k];
//           return value === null || value === undefined ? 0 : (value as number);
//         }),
//       );
//       console.log(
//         "LOG: xs (primeiros 5, antes da normalização):",
//         xs.slice(0, 5),
//       );
//
//       // Normalizar os dados (usando as mesmas estatísticas do treinamento)
//       const xsArray = xs.map((arr) =>
//         arr.map((val) => (Number.isNaN(val) ? 0 : val)),
//       );
//       const xTensor = tf.tensor2d(xsArray);
//
//       // Aplicar a mesma normalização usada no treinamento
//       const normalizedInput = normalizeFeatures(xTensor, normalization);
//       console.log(
//         "LOG: normalizedInput (após normalização):",
//         normalizedInput.arraySync(),
//       );
//
//       // Fazer previsões com o modelo
//       const probsTensor = model.predict(normalizedInput) as tf.Tensor;
//       const probArr: number[] = Array.from(probsTensor.dataSync());
//       console.log("LOG: probsTensor (após previsão):", probsTensor.arraySync());
//       console.log("LOG: probArr (após previsão):", probArr);
//
//       // Verificar se TODAS as probabilidades são EXATAMENTE 1
//       const allExactlyOne = probArr.every((p) => p === 1);
//       console.log("LOG: allExactlyOne:", allExactlyOne);
//
//       // Apenas se todas as probabilidades forem exatamente 1, aplicar a lógica alternativa
//       if (allExactlyOne) {
//         console.warn(
//           "ALERTA: Todas as probabilidades são exatamente 1. Aplicando lógica alternativa.",
//         );
//
//         // Usar OR rating para diferenciar os cavalos apenas neste caso extremo
//         const orRatings = raceFeatures.map((f) => f.or_rating || 0);
//         const maxRating = Math.max(...orRatings);
//         const minRating = Math.min(...orRatings);
//
//         if (maxRating > minRating) {
//           for (let i = 0; i < probArr.length; i++) {
//             // Inverter a escala (maior OR rating = menor probabilidade de perder)
//             const normalizedRating =
//               (orRatings[i] - minRating) / (maxRating - minRating);
//             // Ajustar probabilidade para estar entre 0.9 e 0.99
//             probArr[i] = 0.9 + normalizedRating * 0.09;
//           }
//           console.log(
//             "Probabilidades ajustadas com base no OR rating devido a erro no modelo.",
//           );
//           console.log("LOG: probArr (após lógica alternativa):", probArr);
//         }
//       }
//
//       // Preparar resultados para salvar
//       const predictions = raceFeatures.map((feature, i) => ({
//         racecard_id: Number.parseInt(raceId),
//         race_horse_id: feature.race_horse_id,
//         probability: probArr[i],
//       }));
//       console.log(
//         "LOG: predictions (antes de salvar no Supabase):",
//         predictions,
//       );
//
//       // Limpar previsões existentes para esta corrida
//       const { error: deleteError } = await supabase
//         .schema("hml")
//         .from("horse_predictions")
//         .delete()
//         .eq("racecard_id", raceId);
//
//       if (deleteError) {
//         console.error(
//           `Erro ao limpar previsões existentes: ${deleteError.message}`,
//         );
//       }
//
//       // Salvar novas previsões
//       const { error: insertError } = await supabase
//         .schema("hml")
//         .from("horse_predictions")
//         .insert(predictions);
//
//       if (insertError) {
//         throw new Error(
//           `Erro salvando previsões para corrida ${raceId}: ${insertError.message}`,
//         );
//       }
//
//       // Identificar o cavalo com maior probabilidade de perder
//       const maxIdx = probArr.indexOf(Math.max(...probArr));
//       const loser = raceFeatures[maxIdx];
//       console.log(
//         `Corrida ${raceId} (${raceFeatures.length} candidatos):` +
//           ` cavalo \'${loser.race_horse_id}\' com prob. ${(probArr[maxIdx] * 100).toFixed(1)}% de NÃO vencer.`,
//       );
//
//       // Limpar tensores
//       tf.dispose([xTensor, normalizedInput, probsTensor]);
//     }
//
//     console.log("Geração de previsões concluída com sucesso.");
//   } catch (error) {
//     console.error("Erro na geração de previsões:", error);
//     throw error;
//   }
// };
