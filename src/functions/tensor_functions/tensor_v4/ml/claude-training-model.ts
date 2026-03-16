// features_v4/ml/training_final.ts

import * as tf from "@tensorflow/tfjs-node";
import { supabase } from "../../../..";

// Configuração do modelo
const MODEL_NAME = "claude-ml-model";
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
  optimalThreshold: number;
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
 * Carregar e preparar dados com paginação
 */
async function loadAndPrepareData() {
  console.log("📊 Carregando dados de treinamento...");

  const { count: totalCount, error: countError } = await supabase
    .schema("hml")
    .from("training_enriched_horse_features")
    .select("*", { count: "exact", head: true })
    .gte("quality_score", 0.7);

  if (countError) throw countError;
  console.log(`📊 Total de registros disponíveis: ${totalCount}`);

  const allData: any[] = [];
  const pageSize = 1000;
  let currentPage = 0;

  while (currentPage * pageSize < (totalCount || 0)) {
    const from = currentPage * pageSize;
    const to = from + pageSize - 1;

    const { data: pageData, error } = await supabase
      .schema("hml")
      .from("training_enriched_horse_features")
      .select("features, target, quality_score, race_date") // ← race_date adicionado
      .gte("quality_score", 0.7)
      .order("race_date", { ascending: true }) // ← ordenar por data da corrida
      .range(from, to);

    if (error) throw error;
    if (!pageData) break;

    allData.push(...pageData);
    currentPage++;
    console.log(`📥 Carregadas ${allData.length}/${totalCount} amostras...`);
  }

  if (allData.length === 0) throw new Error("Sem dados de treinamento");
  console.log(
    `✅ ${allData.length} amostras carregadas (quality_score >= 0.7)`,
  );

  // Features selecionadas — v4 com novas features do pipeline
  const selectedFeatures = [
    // Performance carreira
    "career_win_rate",
    "career_place_rate",
    "career_avg_position",
    "career_position_std",
    "career_runs",
    "career_wins",

    // Condições específicas
    "course_win_rate",
    "course_runs",
    "distance_band_win_rate",
    "going_win_rate",
    "class_win_rate",

    // Form
    "form_last3_avg",
    "form_last5_avg",
    "form_consistency",
    "form_is_improving",
    "form_has_problems",
    "form_last_position",
    "form_weighted_avg",
    "form_exponential_avg",
    "form_wins_in_last5",
    "form_trend_score",

    // Mercado
    "sp_decimal",
    "sp_implied_prob",
    "sp_rank",
    "sp_vs_field_avg",
    "market_confidence",
    "is_favorite",
    "is_outsider",

    // Ratings
    "or_rating_imputed",
    "or_rank_in_race",
    "or_percentile_in_race",
    "or_diff_to_top",
    "or_advantage_score",

    // Campo competitivo
    "field_avg_or",
    "field_std_or",
    "field_avg_career_wins",
    "race_field_size",
    "stronger_opponents_count",
    "is_competitive_race",

    // Jockey/Trainer
    "jockey_win_rate",
    "jockey_recent_form",
    "jockey_course_win_rate",
    "jockey_total_runs",
    "trainer_win_rate",
    "trainer_recent_form",
    "trainer_course_win_rate",
    "jockey_trainer_combo_win_rate",

    // Condições da corrida
    "race_going_encoded",
    "race_distance_meters",
    "race_class",
    "days_since_last_run",
    "horse_age",
    "horse_weight_kg",

    // Recente
    "recent_avg_position",
    "recent_runs_90d",

    // Lay específicos
    "out_of_top3_rate",
    "position_volatility",
    "beaten_favorite_rate",
    "worst_recent_position",
  ];

  // Split temporal — 80% mais antigo treina, 20% mais recente valida
  const sortedDates = [
    ...new Set(allData.map((r) => r.race_date as string)),
  ].sort();
  const splitDateIdx = Math.floor(sortedDates.length * 0.8);
  const splitDate = sortedDates[splitDateIdx];

  console.log(`📅 Split temporal: treino até ${splitDate}`);
  console.log(`📅 Validação: ${splitDate} em diante`);

  const trainData = allData.filter((r) => (r.race_date as string) < splitDate);
  const valData = allData.filter((r) => (r.race_date as string) >= splitDate);

  console.log(`📊 Treino: ${trainData.length} amostras`);
  console.log(`📊 Validação: ${valData.length} amostras`);

  // Extrair feature vectors
  const trainFeatures: number[][] = [];
  const trainTargets: number[] = [];

  for (const record of trainData) {
    const { vector, valid } = extractFeatureVector(record, selectedFeatures);
    if (valid) {
      trainFeatures.push(vector);
      trainTargets.push(record.target);
    }
  }

  const valFeatures: number[][] = [];
  const valTargets: number[] = [];

  for (const record of valData) {
    const { vector, valid } = extractFeatureVector(record, selectedFeatures);
    if (valid) {
      valFeatures.push(vector);
      valTargets.push(record.target);
    }
  }

  console.log(`✅ ${trainFeatures.length} amostras treino válidas`);
  console.log(`✅ ${valFeatures.length} amostras validação válidas`);

  // Calcular class weights sobre todo o dataset
  const allTargets = [...trainTargets, ...valTargets];
  const classCounts = allTargets.reduce(
    (acc, target) => {
      acc[target] = (acc[target] || 0) + 1;
      return acc;
    },
    {} as Record<number, number>,
  );

  const totalSamples = allTargets.length;
  const numClasses = Object.keys(classCounts).length;
  const classWeights: { [key: number]: number } = {};

  for (const classId in classCounts) {
    classWeights[Number(classId)] =
      totalSamples / (numClasses * classCounts[classId]);
  }

  console.log(
    `⚖ Pesos de classe: 0=${classWeights[0]?.toFixed(2)}, 1=${classWeights[1]?.toFixed(2)}`,
  );

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
 * Função auxiliar para embaralhar array (Fisher-Yates)
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Normalização robusta com quantiles implementados manualmente
 */
function robustNormalize(trainX: tf.Tensor2D, valX: tf.Tensor2D) {
  // Converter para array para calcular quantiles
  const trainData = trainX.arraySync() as number[][];
  const valData = valX.arraySync() as number[][];

  // Calcular quantiles manualmente para cada feature
  const q25: number[] = [];
  const q50: number[] = [];
  const q75: number[] = [];

  for (let col = 0; col < trainData[0].length; col++) {
    // Extrair e ordenar coluna
    const column = trainData.map((row) => row[col]).sort((a, b) => a - b);
    const n = column.length;

    // Calcular índices dos quantiles
    const idx25 = Math.floor(n * 0.25);
    const idx50 = Math.floor(n * 0.5);
    const idx75 = Math.floor(n * 0.75);

    q25.push(column[idx25]);
    q50.push(column[idx50]);
    q75.push(column[idx75]);
  }

  // Calcular IQR (Interquartile Range)
  const iqr = q75.map((v, i) => {
    const range = v - q25[i];
    return range > 0 ? range : 1; // Evitar divisão por zero
  });

  // Normalizar dados usando mediana e IQR
  const normalizedTrain: number[][] = [];
  const normalizedVal: number[][] = [];

  // Normalizar conjunto de treino
  for (let row = 0; row < trainData.length; row++) {
    const normalizedRow: number[] = [];
    for (let col = 0; col < trainData[0].length; col++) {
      const value = (trainData[row][col] - q50[col]) / iqr[col];
      // Clipping para lidar com outliers extremos
      normalizedRow.push(Math.max(-3, Math.min(3, value)));
    }
    normalizedTrain.push(normalizedRow);
  }

  // Normalizar conjunto de validação
  for (let row = 0; row < valData.length; row++) {
    const normalizedRow: number[] = [];
    for (let col = 0; col < valData[0].length; col++) {
      const value = (valData[row][col] - q50[col]) / iqr[col];
      // Clipping para lidar com outliers extremos
      normalizedRow.push(Math.max(-3, Math.min(3, value)));
    }
    normalizedVal.push(normalizedRow);
  }

  // Converter de volta para tensors
  const normalizedTrainX = tf.tensor2d(normalizedTrain);
  const normalizedValX = tf.tensor2d(normalizedVal);

  // Calcular mean e std também (para compatibilidade)
  const { mean, variance } = tf.moments(trainX, 0);
  const std = variance.sqrt().add(1e-7);

  // Cleanup tensors temporários
  variance.dispose();

  return {
    trainX: normalizedTrainX,
    valX: normalizedValX,
    mean: mean.arraySync() as number[],
    std: std.arraySync() as number[],
    median: q50,
    iqr: iqr,
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
 * Treinar modelo com Early Stopping manual
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

  // Variáveis para Early Stopping manual
  let bestValLoss = Infinity;
  let bestWeights: tf.Tensor[] | null = null;
  let patienceCounter = 0;
  const patience = 15;
  const maxEpochs = 100;
  let actualEpochs = 0;

  // Treinar época por época para implementar Early Stopping manual
  for (let epoch = 0; epoch < maxEpochs; epoch++) {
    const history = await model.fit(data.trainX, data.trainY, {
      epochs: 1,
      batchSize: 32,
      validationData: [data.valX, data.valY],
      classWeight: data.classWeights,
      verbose: 0, // Silencioso para controlar output manualmente
    });

    const trainLoss = history.history.loss[0] as number;
    const trainAcc = history.history.acc[0] as number;
    const valLoss = history.history.val_loss[0] as number;
    const valAcc = history.history.val_acc[0] as number;

    // Atualizar métricas finais
    finalMetrics = {
      trainLoss,
      trainAcc,
      valLoss,
      valAcc,
      epochs: epoch + 1,
    };

    // Log a cada 10 épocas
    if (epoch % 10 === 0) {
      console.log(
        `Epoch ${epoch}: loss=${trainLoss.toFixed(4)}, ` +
          `acc=${trainAcc.toFixed(4)}, ` +
          `val_loss=${valLoss.toFixed(4)}, ` +
          `val_acc=${valAcc.toFixed(4)}`,
      );
    }

    // Early Stopping manual
    if (valLoss < bestValLoss) {
      bestValLoss = valLoss;

      // Salvar melhores pesos
      if (bestWeights !== null) {
        // Limpar pesos anteriores
        bestWeights.forEach((w) => w.dispose());
      }
      bestWeights = model.getWeights().map((w) => w.clone());

      patienceCounter = 0;

      // Log quando encontrar melhor modelo
      console.log(
        `📈 Melhor modelo encontrado - Epoch ${epoch}: val_loss=${valLoss.toFixed(4)}`,
      );
    } else {
      patienceCounter++;

      // Parar se patience excedido
      if (patienceCounter >= patience) {
        console.log(
          `\n⏹ Early stopping ativado na época ${epoch} (patience=${patience})`,
        );
        actualEpochs = epoch + 1;
        break;
      }
    }

    actualEpochs = epoch + 1;
  }

  // Restaurar melhores pesos
  if (bestWeights !== null) {
    console.log("♻ Restaurando melhores pesos do modelo...");
    model.setWeights(bestWeights);

    // Recalcular métricas com os melhores pesos
    const finalEval = (await model.evaluate(
      data.valX,
      data.valY,
    )) as tf.Tensor[];
    const finalValLoss = await finalEval[0].data();
    const finalValAcc = await finalEval[1].data();

    finalMetrics.valLoss = finalValLoss[0];
    finalMetrics.valAcc = finalValAcc[0];
    finalMetrics.epochs = actualEpochs;

    // Cleanup tensors de avaliação
    finalEval.forEach((t) => t.dispose());

    // Cleanup pesos salvos
    bestWeights.forEach((w) => w.dispose());
  }

  console.log(`\n✅ Treinamento finalizado em ${actualEpochs} épocas`);
  console.log(`📊 Melhor val_loss: ${bestValLoss.toFixed(4)}`);

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

function extractFeatureVector(
  record: any,
  selectedFeatures: string[],
): { vector: number[]; valid: boolean } {
  const vector: number[] = [];

  for (const featName of selectedFeatures) {
    let value = record.features[featName];

    // SP null = registro inválido para treino
    if (
      (featName === "sp_decimal" || featName === "sp_implied_prob") &&
      (value === null || value === undefined)
    ) {
      return { vector: [], valid: false };
    }

    // Imputação conservadora — 0 para desconhecido
    if (value === null || value === undefined) {
      value = 0;
    }

    vector.push(Number(value));
  }

  return { vector, valid: true };
}
