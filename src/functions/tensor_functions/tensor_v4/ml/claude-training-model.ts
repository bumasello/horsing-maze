// features_v4/ml/training_final.ts

import * as tf from "@tensorflow/tfjs-node";
import { supabase } from "../../../..";

// Configuração do modelo
const MODEL_NAME = "lay-betting-model";
const BUCKET_NAME = "modelos-tfjs-publicos";
const MODEL_PATH = `horse_probability_model/${MODEL_NAME}`;

interface ModelConfig {
  version: number;
  features: string[];
  normalization: {
    mean: number[];
    std: number[];
    median: number[];
    iqr: number[];
  };
  metrics: {
    trainAccuracy: number;
    valAccuracy: number;
    trainLoss: number;
    valLoss: number;
    timestamp: string;
  };
  training: {
    epochs: number;
    batchSize: number;
    learningRate: number;
    samplesUsed: number;
    classWeights: { [key: number]: number };
  };
}

/**
 * Pipeline principal de treinamento
 */
export async function trainLayBettingModel(): Promise<void> {
  console.log("🚀 Iniciando treinamento do modelo de Lay Betting...\n");

  try {
    // 1. Verificar modelo existente
    const existingConfig = await checkExistingModel();

    // 2. Carregar e preparar dados
    const trainingData = await loadAndPrepareData();

    // 3. Criar ou atualizar modelo
    const model = createModel(trainingData.featureCount);

    // 4. Treinar
    const history = await trainModel(model, trainingData);

    // 5. Preparar configuração
    const config: ModelConfig = {
      version: existingConfig ? existingConfig.version + 1 : 1,
      features: trainingData.features,
      normalization: {
        mean: trainingData.normalization.mean,
        std: trainingData.normalization.std,
        median: trainingData.normalization.median,
        iqr: trainingData.normalization.iqr,
      },
      metrics: {
        trainAccuracy: history.trainAcc,
        valAccuracy: history.valAcc,
        trainLoss: history.trainLoss,
        valLoss: history.valLoss,
        timestamp: new Date().toISOString(),
      },
      training: {
        epochs: history.epochs,
        batchSize: 32,
        learningRate: 0.001,
        samplesUsed: trainingData.sampleCount,
        classWeights: trainingData.classWeights,
      },
    };

    // 6. Salvar no Supabase (substituindo anterior)
    await saveModelToSupabase(model, config);

    // 7. Salvar histórico de métricas
    await saveMetricsHistory(config);

    // 8. Cleanup
    trainingData.trainX.dispose();
    trainingData.trainY.dispose();
    trainingData.valX.dispose();
    trainingData.valY.dispose();
    model.dispose();

    console.log("\n✅ Treinamento completo!");
    console.log(`📊 Versão: ${config.version}`);
    console.log(
      `📊 Acurácia Treino: ${(config.metrics.trainAccuracy * 100).toFixed(2)}%`,
    );
    console.log(
      `📊 Acurácia Validação: ${(config.metrics.valAccuracy * 100).toFixed(2)}%`,
    );
  } catch (error) {
    console.error("❌ Erro no treinamento:", error);
    throw error;
  }
}

/**
 * Verificar modelo existente
 */
async function checkExistingModel(): Promise<ModelConfig | null> {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(`${MODEL_PATH}/config.json`);

    if (error || !data) return null;

    const text = await data.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Carregar e preparar dados
 */
async function loadAndPrepareData() {
  console.log("📊 Carregando dados de treinamento...");

  // Buscar dados COM FILTRO DE QUALIDADE
  const { data, error } = await supabase
    .schema("hml")
    .from("training_enriched_horse_features")
    .select("features, target, quality_score")
    .gte("quality_score", 0.7) // Apenas amostras com qualidade >= 0.7 para treino
    .order("generated_at", { ascending: true });

  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Sem dados de treinamento");

  console.log(`✅ ${data.length} amostras carregadas (quality_score >= 0.7)`);

  // Features selecionadas (42 features importantes)
  const selectedFeatures = [
    // Performance
    "career_win_rate",
    "career_place_rate",
    "career_avg_position",
    "career_position_std",
    "career_runs",
    "career_wins",

    // Curso
    "course_win_rate",
    "course_runs",

    // Forma
    "form_last3_avg",
    "form_last5_avg",
    "form_consistency",
    "form_is_improving",
    "form_has_problems",
    "form_last_position",
    "worst_recent_position",

    // Mercado
    "sp_decimal",
    "sp_implied_prob",
    "sp_rank",
    "sp_vs_field_avg",

    // Ratings
    "or_rating",
    "or_rating_imputed",
    "or_rank_in_race",
    "or_percentile_in_race",
    "or_diff_to_top",

    // Campo
    "field_avg_or",
    "field_std_or",
    "field_avg_career_wins",
    "race_field_size",
    "stronger_opponents_count",

    // Jockey/Trainer
    "jockey_win_rate",
    "jockey_course_win_rate",
    "trainer_win_rate",
    "trainer_course_win_rate",
    "jockey_trainer_combo_win_rate",

    // Condições
    "distance_band_win_rate",
    "going_win_rate",
    "race_going_encoded",
    "race_distance_meters",

    // Outros
    "days_since_last_run",
    "horse_age",
    "horse_weight_kg",
    "race_class",

    // Lay específicos
    "out_of_top3_rate",
    "position_volatility",
    "beaten_favorite_rate",
  ];

  // Extrair features e targets
  const features: number[][] = [];
  const targets: number[] = [];

  for (const record of data) {
    const featureVector: number[] = [];
    let hasNull = false;

    for (const featName of selectedFeatures) {
      let value = record.features[featName];

      // Para SP, pular se null (corridas futuras não teriam)
      if (
        (featName === "sp_decimal" || featName === "sp_implied_prob") &&
        (value === null || value === undefined)
      ) {
        hasNull = true;
        break;
      }

      // Imputar outros nulls
      if (value === null || value === undefined) {
        value = featName.includes("rate") ? 0.5 : 0;
      }

      featureVector.push(Number(value));
    }

    if (!hasNull) {
      features.push(featureVector);
      targets.push(record.target);
    }
  }

  console.log(`✅ ${features.length} amostras válidas após limpeza`);

  // Calcular class weights
  const classCounts = targets.reduce(
    (acc, target) => {
      acc[target] = (acc[target] || 0) + 1;
      return acc;
    },
    {} as Record<number, number>,
  );

  const totalSamples = targets.length;
  const numClasses = Object.keys(classCounts).length;
  const classWeights: { [key: number]: number } = {};

  for (const classId in classCounts) {
    classWeights[Number(classId)] =
      totalSamples / (numClasses * classCounts[classId]);
  }

  console.log(
    `⚖ Pesos de classe: 0=${classWeights[0]?.toFixed(2)}, 1=${classWeights[1]?.toFixed(2)}`,
  );

  // Split 80/20
  const splitIdx = Math.floor(features.length * 0.8);
  const trainFeatures = features.slice(0, splitIdx);
  const trainTargets = targets.slice(0, splitIdx);
  const valFeatures = features.slice(splitIdx);
  const valTargets = targets.slice(splitIdx);

  // Converter para tensors
  const trainX = tf.tensor2d(trainFeatures);
  const trainY = tf.tensor2d(trainTargets, [trainTargets.length, 1]);
  const valX = tf.tensor2d(valFeatures);
  const valY = tf.tensor2d(valTargets, [valTargets.length, 1]);

  // Normalização robusta
  const normalization = robustNormalize(trainX, valX);

  return {
    trainX: normalization.trainX,
    trainY,
    valX: normalization.valX,
    valY,
    features: selectedFeatures,
    featureCount: selectedFeatures.length,
    sampleCount: trainFeatures.length,
    classWeights,
    normalization: {
      mean: normalization.mean,
      std: normalization.std,
      median: normalization.median,
      iqr: normalization.iqr,
    },
  };
}

/**
 * Normalização robusta
 */
function robustNormalize(trainX: tf.Tensor2D, valX: tf.Tensor2D) {
  // Mean e std para normalização padrão
  const { mean, variance } = tf.moments(trainX, 0);
  const std = variance.sqrt().add(1e-7);

  // Percentis para normalização robusta
  const median = tf.quantile(trainX, 0.5, 0);
  const q25 = tf.quantile(trainX, 0.25, 0);
  const q75 = tf.quantile(trainX, 0.75, 0);
  const iqr = q75.sub(q25).add(1e-7);

  // Normalizar usando IQR (mais robusto a outliers)
  const normalizedTrainX = trainX.sub(median).div(iqr).clipByValue(-3, 3);
  const normalizedValX = valX.sub(median).div(iqr).clipByValue(-3, 3);

  return {
    trainX: normalizedTrainX,
    valX: normalizedValX,
    mean: mean.arraySync() as number[],
    std: std.arraySync() as number[],
    median: median.arraySync() as number[],
    iqr: iqr.arraySync() as number[],
  };
}

/**
 * Criar modelo
 */
function createModel(inputDim: number): tf.LayersModel {
  const model = tf.sequential({
    layers: [
      // Entrada
      tf.layers.dense({
        inputShape: [inputDim],
        units: 128,
        activation: "relu",
        kernelInitializer: "heNormal",
        kernelRegularizer: tf.regularizers.l2({ l2: 0.001 }),
      }),
      tf.layers.batchNormalization(),
      tf.layers.dropout({ rate: 0.3 }),

      // Hidden 1
      tf.layers.dense({
        units: 64,
        activation: "relu",
        kernelInitializer: "heNormal",
        kernelRegularizer: tf.regularizers.l2({ l2: 0.001 }),
      }),
      tf.layers.batchNormalization(),
      tf.layers.dropout({ rate: 0.25 }),

      // Hidden 2
      tf.layers.dense({
        units: 32,
        activation: "relu",
        kernelInitializer: "heNormal",
      }),
      tf.layers.dropout({ rate: 0.2 }),

      // Hidden 3
      tf.layers.dense({
        units: 16,
        activation: "relu",
        kernelInitializer: "heNormal",
      }),
      tf.layers.dropout({ rate: 0.15 }),

      // Saída
      tf.layers.dense({
        units: 1,
        activation: "sigmoid",
      }),
    ],
  });

  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: "binaryCrossentropy",
    metrics: ["accuracy"],
  });

  return model;
}

/**
 * Treinar modelo
 */
async function trainModel(model: tf.LayersModel, data: any) {
  console.log("\n🏋 Treinando modelo...\n");

  let finalMetrics = {
    trainLoss: 0,
    trainAcc: 0,
    valLoss: 0,
    valAcc: 0,
    epochs: 0,
  };

  await model.fit(data.trainX, data.trainY, {
    epochs: 100,
    batchSize: 32,
    validationData: [data.valX, data.valY],
    classWeight: data.classWeights,
    callbacks: [
      tf.callbacks.earlyStopping({
        monitor: "val_loss",
        patience: 15,
        mode: "min",
        restoreBestWeights: true,
      }),
      {
        onEpochEnd: (epoch, logs) => {
          if (epoch % 10 === 0) {
            console.log(
              `Epoch ${epoch}: loss=${logs?.loss?.toFixed(4)}, ` +
                `acc=${logs?.acc?.toFixed(4)}, ` +
                `val_loss=${logs?.val_loss?.toFixed(4)}, ` +
                `val_acc=${logs?.val_acc?.toFixed(4)}`,
            );
          }
          finalMetrics = {
            trainLoss: logs?.loss || 0,
            trainAcc: logs?.acc || 0,
            valLoss: logs?.val_loss || 0,
            valAcc: logs?.val_acc || 0,
            epochs: epoch + 1,
          };
        },
      },
    ],
  });

  return finalMetrics;
}

/**
 * Salvar modelo no Supabase (substitui anterior)
 */
async function saveModelToSupabase(model: tf.LayersModel, config: ModelConfig) {
  console.log("\n💾 Salvando modelo no Supabase Storage...");

  // Salvar temporariamente
  const tempPath = `/tmp/model_${Date.now()}`;
  await model.save(`file://${tempPath}`);

  const fs = require("fs");
  const modelJson = fs.readFileSync(`${tempPath}/model.json`);
  const modelWeights = fs.readFileSync(`${tempPath}/weights.bin`);

  // Upload (upsert substitui arquivo existente)
  await supabase.storage
    .from(BUCKET_NAME)
    .upload(`${MODEL_PATH}/model.json`, modelJson, {
      contentType: "application/json",
      upsert: true,
    });

  await supabase.storage
    .from(BUCKET_NAME)
    .upload(`${MODEL_PATH}/weights.bin`, modelWeights, {
      contentType: "application/octet-stream",
      upsert: true,
    });

  await supabase.storage
    .from(BUCKET_NAME)
    .upload(`${MODEL_PATH}/config.json`, JSON.stringify(config, null, 2), {
      contentType: "application/json",
      upsert: true,
    });

  // Limpar temporários
  fs.unlinkSync(`${tempPath}/model.json`);
  fs.unlinkSync(`${tempPath}/weights.bin`);

  console.log("✅ Modelo salvo com sucesso!");
}

/**
 * Salvar histórico de métricas (para acompanhar evolução)
 */
async function saveMetricsHistory(config: ModelConfig) {
  const history = {
    version: config.version,
    timestamp: config.metrics.timestamp,
    train_accuracy: config.metrics.trainAccuracy,
    val_accuracy: config.metrics.valAccuracy,
    train_loss: config.metrics.trainLoss,
    val_loss: config.metrics.valLoss,
    samples_used: config.training.samplesUsed,
    epochs: config.training.epochs,
  };

  await supabase.schema("hml").from("model_metrics_history").insert(history);
}
