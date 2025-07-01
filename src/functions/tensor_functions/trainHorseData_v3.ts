import * as tf from "@tensorflow/tfjs-node";
import fs from "node:fs";
import { supabase } from "../..";
import { fetchFinishedRaces } from "../spb_functions/features_v2/utils/fetchFinishedRaces";
import { fetchHorsesForRace } from "../spb_functions/features_v2/utils/fetchHorsesForRace";
import { fetchHorseHistoryBeforeDate } from "../spb_functions/features_v2/utils/fetchHorseForRace";
import { calculateHistoricalFeatures } from "../spb_functions/features_v2/utils/calculateHistorialFeatures";
import { calculateJockeyFeatures } from "../spb_functions/features_v2/utils/calculateJockeyFeatures";
import { convertFurlongsToMeters } from "../utils/auxFunctions";
import { convertHorseWeightToKg } from "../utils/auxFunctions";
import { saveTrainingFeature } from "../spb_functions/features_v2/utils/saveTrainingFeature";
import { encodeGoing } from "../spb_functions/features_v2/aux/encodeGoing";

async function loadTrainingData(): Promise<{
  xs: tf.Tensor2D;
  ys: tf.Tensor2D;
  normalization: { mean: number[]; std: number[]; featureKeys: string[] };
  classWeights: { [key: number]: number };
}> {
  console.log("Carregando features de treinamento do Supabase...");
  const { data: trainingFeatures, error } = await supabase
    .schema("hml")
    .from("training_horse_features")
    .select("*");

  if (error) {
    throw new Error(`Erro ao buscar features de treinamento: ${error.message}`);
  }

  if (!trainingFeatures || trainingFeatures.length === 0) {
    throw new Error("Nenhuma feature de treinamento encontrada.");
  }

  // Calcular contagem de classes para pesos
  const classCounts = trainingFeatures.reduce(
    (acc, feature) => {
      acc[feature.target] = (acc[feature.target] || 0) + 1;
      return acc;
    },
    {} as Record<number, number>,
  );

  const totalSamples = trainingFeatures.length;
  const numClasses = Object.keys(classCounts).length;
  const classWeights: { [key: number]: number } = {};

  for (const classIdStr in classCounts) {
    const classId = Number(classIdStr); // Converter para número
    classWeights[classId] =
      totalSamples / (numClasses * classCounts[classIdStr]);
  }

  console.log("Pesos de classe calculados:", classWeights);

  // Assumindo que as featureKeys são as mesmas que você me forneceu anteriormente
  const featureKeys = [
    "going_encoded",
    "distance_meters",
    "field_size",
    "race_class",
    "horse_age",
    "weight_kg",
    "or_rating",
    "days_since_last_run",
    "avg_position",
    "position_variance",
    "win_rate",
    "place_rate",
    "avg_or_rating",
    "or_trend",
    "going_performance",
    "distance_performance",
    "jockey_win_rate",
    "jockey_horse_win_rate",
    "jockey_course_win_rate",
    "recent_form",
  ];

  const xs = trainingFeatures.map((f) =>
    featureKeys.map((key) => {
      const value = (f as any)[key];
      return value === null || value === undefined ? 0 : (value as number);
    }),
  );
  const ys = trainingFeatures.map((f) => f.target);

  const xTensor = tf.tensor2d(xs);
  const yTensor = tf.tensor2d(ys, [ys.length, 1]);

  // Calcular normalização (mean e std) dos dados de treinamento usando tf.moments
  const { mean, variance } = tf.moments(xTensor, 0);
  const std = tf.sqrt(variance).arraySync() as number[];

  // Evitar divisão por zero para features com std = 0
  const safeStd = std.map((s) => (s === 0 ? 1e-7 : s));

  const normalization = {
    mean: mean.arraySync() as number[],
    std: safeStd,
    featureKeys,
  };

  // Normalizar os dados de treinamento
  const normalizedXs = xTensor.sub(mean).div(safeStd) as tf.Tensor2D;

  // Descartar tensores temporários
  mean.dispose();
  variance.dispose();

  return { xs: normalizedXs, ys: yTensor, normalization, classWeights };
}

// Função para treinar o modelo
export const trainHorseData_v3 = async (): Promise<void> => {
  try {
    console.log(
      "Iniciando treinamento do modelo de probabilidade de cavalos...",
    );

    const { xs, ys, normalization, classWeights } = await loadTrainingData();

    // Definir a arquitetura do modelo
    const model = tf.sequential({
      layers: [
        tf.layers.dense({
          units: 64,
          activation: "relu",
          inputShape: [xs.shape[1]],
        }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({ units: 32, activation: "relu" }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({ units: 1, activation: "sigmoid" }), // Saída para probabilidade de perda
      ],
    });

    // Compilar o modelo com otimizador e função de perda
    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: "binaryCrossentropy",
      metrics: ["accuracy"],
    });

    // Treinar o modelo com pesos de classe
    console.log("Treinando o modelo...");
    await model.fit(xs, ys, {
      epochs: 50, // Ajuste conforme necessário
      batchSize: 32, // Ajuste conforme necessário
      validationSplit: 0.2, // Usar 20% dos dados para validação
      callbacks: tf.callbacks.earlyStopping({
        monitor: "val_loss",
        patience: 5,
      }),
      classWeight: classWeights, // Aplicar pesos de classe aqui
    });

    console.log("Treinamento concluído. Salvando modelo e normalização...");

    // Salvar o modelo localmente
    const modelDir = "./src/functions/tensor_functions/temp_model_save";
    const modelSavePath = `file://${modelDir}`;
    await model.save(modelSavePath);
    console.log(`Modelo salvo localmente em: ${modelSavePath}`);

    // Salvar os parâmetros de normalização localmente
    const normalizationSavePath = `${modelDir}/normalization.json`;
    fs.writeFileSync(normalizationSavePath, JSON.stringify(normalization));
    console.log(
      `Parâmetros de normalização salvos localmente em: ${normalizationSavePath}`,
    );

    console.log(
      "Iniciando upload do modelo e normalização para Supabase Storage...",
    );

    // Upload do model.json
    const modelJsonContent = fs.readFileSync(`${modelDir}/model.json`);
    const { error: modelUploadError } = await supabase.storage
      .from("modelos-tfjs-publicos")
      .upload("horse_probability_model/model.json", modelJsonContent, {
        upsert: true,
      });

    if (modelUploadError) {
      throw new Error(
        `Erro ao fazer upload de model.json: ${modelUploadError.message}`,
      );
    }
    console.log("model.json uploaded to Supabase Storage.");

    // Upload do weights.bin
    const weightsBinContent = fs.readFileSync(`${modelDir}/weights.bin`);
    const { error: weightsUploadError } = await supabase.storage
      .from("modelos-tfjs-publicos")
      .upload("horse_probability_model/weights.bin", weightsBinContent, {
        upsert: true,
      });

    if (weightsUploadError) {
      throw new Error(
        `Erro ao fazer upload de weights.bin: ${weightsUploadError.message}`,
      );
    }
    console.log("weights.bin uploaded to Supabase Storage.");

    // Upload do normalization.json
    const normalizationContent = fs.readFileSync(normalizationSavePath);
    const { error: normUploadError } = await supabase.storage
      .from("modelos-tfjs-publicos")
      .upload(
        "horse_probability_model/normalization.json",
        normalizationContent,
        { upsert: true },
      );

    if (normUploadError) {
      throw new Error(
        `Erro ao fazer upload de normalization.json: ${normUploadError.message}`,
      );
    }
    console.log("normalization.json uploaded to Supabase Storage.");

    console.log("Upload para Supabase Storage concluído com sucesso.");

    // Limpar tensores
    xs.dispose();
    ys.dispose();
    model.dispose();
  } catch (error) {
    console.error("Erro no treinamento do modelo:", error);
    throw error;
  }
};
