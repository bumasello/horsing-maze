// features_v4/ml/training_final.ts

import * as tf from "@tensorflow/tfjs-node";
import { supabase } from "../..";
import type { ModelConfig } from "../../shared/types/ml.types";

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

const BUCKET_NAME = "modelos-tfjs-publicos";

type ModelType = "flat" | "jump";

const MODEL_TYPE_CONFIG = {
  flat: {
    name: "claude-ml-model-flat",
    raceTypes: ["Flat"],
    label: "Flat",
  },
  jump: {
    name: "claude-ml-model-jump",
    raceTypes: ["Hurdle", "Chase", "NHF"],
    label: "Jump (Hurdle + Chase + NHF)",
  },
};

function getModelPath(modelType: ModelType): string {
  return `horse_probability_model/${MODEL_TYPE_CONFIG[modelType].name}`;
}

const configGlobal = {
  patience: 25,
  maxEpochs: 150,
  learningRate: 0.0005,
  batchSize: 32,
};

// ============================================================================
// EXPORTS
// ============================================================================

export async function trainAllModels(): Promise<void> {
  console.log("🚀 Iniciando treinamento de modelos Flat + Jump...\n");
  const startTime = Date.now();

  await trainLayBettingModel("flat");

  if (global.gc) global.gc();

  await trainLayBettingModel("jump");

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n🏁 Ambos os modelos treinados em ${totalTime}s`);
}

export async function trainLayBettingModel(
  modelType: ModelType,
): Promise<void> {
  const typeConfig = MODEL_TYPE_CONFIG[modelType];
  const modelPath = getModelPath(modelType);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🏇 Treinando modelo: ${typeConfig.label}`);
  console.log(`📁 Path: ${modelPath}`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    console.log("🔍 [STEP 1/7] Verificando modelo existente...");
    const existingConfig = await checkExistingModel(modelType);
    if (existingConfig) {
      console.log(
        `✅ Modelo existente encontrado (versão ${existingConfig.version})`,
      );
    } else {
      console.log("i  Nenhum modelo existente encontrado. Criando versão 1.");
    }

    console.log("\n📊 [STEP 2/7] Carregando e preparando dados...");
    const trainingData = await loadAndPrepareData(modelType);
    console.log("✅ Dados carregados e preparados com sucesso");

    console.log("\n🏗  [STEP 3/7] Criando arquitetura do modelo...");
    const model = createModel(trainingData.featureCount);
    console.log("✅ Modelo criado com sucesso");

    console.log("\n🏋  [STEP 4/7] Iniciando treinamento...");
    const history = await trainModel(model, trainingData);
    console.log("✅ Treinamento concluído");

    console.log("\n🎯 [STEP 4.5/7] Calibrando threshold...");
    const optimalThreshold = await calibrateThreshold(
      model,
      trainingData.valX,
      trainingData.valY,
    );
    console.log(`✅ Threshold calibrado: ${optimalThreshold.toFixed(2)}`);

    console.log("\n📝 [STEP 5/7] Preparando configuração...");
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
        batchSize: configGlobal.batchSize,
        learningRate: configGlobal.learningRate,
        samplesUsed: trainingData.sampleCount,
        classWeights: trainingData.classWeights,
      },
      optimalThreshold,
    };

    console.log("\n💾 [STEP 6/7] Salvando modelo no Supabase...");
    await saveModelToSupabase(model, config, modelType);
    console.log("✅ Modelo salvo");

    console.log("\n📊 [STEP 7/7] Salvando histórico de métricas...");
    await saveMetricsHistory(config, modelType);
    console.log("✅ Histórico salvo");

    console.log("\n🧹 Limpando recursos...");
    trainingData.trainX.dispose();
    trainingData.trainY.dispose();
    trainingData.valX.dispose();
    trainingData.valY.dispose();
    model.dispose();
    console.log("✅ Recursos liberados");

    console.log(`\n✅ Treinamento ${typeConfig.label} completo!`);
    console.log(`📊 Versão: ${config.version}`);
    console.log(
      `📊 Acurácia Treino: ${(config.metrics.trainAccuracy * 100).toFixed(2)}%`,
    );
    console.log(
      `📊 Acurácia Validação: ${(config.metrics.valAccuracy * 100).toFixed(2)}%`,
    );
  } catch (error) {
    console.error(`\n❌ Erro no treinamento ${typeConfig.label}:`);
    console.error("Tipo do erro:", typeof error);
    console.error("Erro completo:", error);
    if (error instanceof Error) {
      console.error("Nome:", error.name);
      console.error("Mensagem:", error.message);
      console.error("Stack:", error.stack);
    }
    throw error;
  }
}

// ============================================================================
// CHECK EXISTING MODEL
// ============================================================================

async function checkExistingModel(
  modelType: ModelType,
): Promise<ModelConfig | null> {
  const modelPath = getModelPath(modelType);
  try {
    console.log(
      `  🔍 Buscando config em: ${BUCKET_NAME}/${modelPath}/config.json`,
    );
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(`${modelPath}/config.json`);
    if (error) {
      console.log(
        `  i  Erro ao buscar config (esperado se for primeira vez):`,
        error.message,
      );
      return null;
    }
    if (!data) {
      console.log(`  i  Nenhum dado retornado`);
      return null;
    }
    const text = await data.text();
    const config = JSON.parse(text);
    console.log(`  ✅ Config carregada: versão ${config.version}`);
    return config;
  } catch (err) {
    console.log(
      `  i  Exceção ao carregar config (normal se for primeira vez):`,
      err,
    );
    return null;
  }
}

// ============================================================================
// MEMORY UTILS
// ============================================================================

function tryGC(): void {
  if (global.gc) global.gc();
}

function logMemory(label: string): void {
  const mem = process.memoryUsage();
  console.log(
    `  📊 [MEM ${label}] RSS: ${(mem.rss / 1024 / 1024).toFixed(0)}MB | Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(0)}/${(mem.heapTotal / 1024 / 1024).toFixed(0)}MB`,
  );
}

// ============================================================================
// LOAD AND PREPARE DATA — COM FILTRO POR TIPO
// ============================================================================

async function loadAndPrepareData(modelType: ModelType) {
  const featureCount = selectedFeatures.length;
  const typeConfig = MODEL_TYPE_CONFIG[modelType];
  logMemory("INÍCIO");

  console.log(`📊 Carregando dados de treinamento (${typeConfig.label})...`);

  const { count: totalCount, error: countError } = await supabase
    .schema("hml")
    .from("training_enriched_horse_features")
    .select("*", { count: "exact", head: true })
    .gte("quality_score", 0.7)
    .in("race_type", typeConfig.raceTypes);

  if (countError) {
    console.error(
      "❌ Erro detalhado no count:",
      JSON.stringify(countError, null, 2),
    );
    throw new Error(
      `Count query falhou: code=${countError.code} message=${countError.message}`,
    );
  }

  if (!totalCount || totalCount === 0)
    throw new Error(`Sem dados de treinamento para ${typeConfig.label}`);
  console.log(`📊 Total de registros ${typeConfig.label}: ${totalCount}`);

  let capacity = Math.min(totalCount + 1000, 150000);
  let vectors = new Float32Array(capacity * featureCount);
  let targets = new Uint8Array(capacity);
  let dateEpochs = new Float64Array(capacity);
  let validCount = 0;

  const pageSize = 1000;
  const maxAttempts = 3;
  let currentPage = 0;

  console.log("📥 Iniciando streaming de dados...");
  logMemory("ANTES_STREAMING");

  while (currentPage * pageSize < totalCount) {
    const from = currentPage * pageSize;
    const to = from + pageSize - 1;
    let pageData: any[] | null = null;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const { data, error } = await supabase
        .schema("hml")
        .from("training_enriched_horse_features")
        .select("features, target, quality_score, race_date")
        .gte("quality_score", 0.7)
        .in("race_type", typeConfig.raceTypes)
        .order("race_date", { ascending: true })
        .range(from, to);

      if (error) {
        if (error.code === "57014") {
          attempts++;
          console.warn(
            `! Timeout página ${currentPage + 1}, tentativa ${attempts}/${maxAttempts}...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 3000 * attempts));
          continue;
        }
        throw error;
      }
      pageData = data;
      break;
    }

    if (!pageData) {
      console.error(`❌ Falha página ${currentPage + 1}, pulando...`);
      currentPage++;
      continue;
    }

    for (const record of pageData) {
      const features = record.features;
      if (!features) continue;
      if (
        features["sp_decimal"] === null ||
        features["sp_decimal"] === undefined
      )
        continue;

      if (validCount >= capacity) {
        capacity = Math.floor(capacity * 1.5);
        console.log(`  📦 Expandindo buffers para ${capacity}...`);
        const nv = new Float32Array(capacity * featureCount);
        nv.set(vectors);
        vectors = nv;
        const nt = new Uint8Array(capacity);
        nt.set(targets);
        targets = nt;
        const nd = new Float64Array(capacity);
        nd.set(dateEpochs);
        dateEpochs = nd;
      }

      const offset = validCount * featureCount;
      let isValid = true;

      for (let i = 0; i < featureCount; i++) {
        const featName = selectedFeatures[i];
        let value = features[featName];
        if (
          (featName === "sp_decimal" || featName === "sp_implied_prob") &&
          (value === null || value === undefined)
        ) {
          isValid = false;
          break;
        }
        if (value === null || value === undefined) value = 0;
        vectors[offset + i] = Number(value);
      }

      if (!isValid) continue;
      targets[validCount] = record.target ?? 0;
      dateEpochs[validCount] = new Date(record.race_date).getTime();
      validCount++;
    }

    pageData = null;
    currentPage++;
    if (currentPage % 10 === 0 || currentPage * pageSize >= totalCount) {
      console.log(
        `📥 Processadas ${Math.min(currentPage * pageSize, totalCount)}/${totalCount}, ${validCount} válidas...`,
      );
    }
  }

  if (validCount === 0)
    throw new Error(`Sem dados válidos para ${typeConfig.label}`);
  console.log(`✅ ${validCount} amostras válidas (${typeConfig.label})`);
  logMemory("APÓS_STREAMING");
  tryGC();

  vectors = vectors.slice(0, validCount * featureCount);
  targets = targets.slice(0, validCount);
  dateEpochs = dateEpochs.slice(0, validCount);

  console.log("📅 Calculando split temporal...");
  const uniqueEpochs = [...new Set(dateEpochs)].sort((a, b) => a - b);
  const splitIdx = Math.floor(uniqueEpochs.length * 0.8);
  const splitEpoch = uniqueEpochs[splitIdx];
  const splitDate = new Date(splitEpoch).toISOString().split("T")[0];

  let trainCount = 0;
  for (let i = 0; i < validCount; i++) {
    if (dateEpochs[i] < splitEpoch) trainCount++;
  }
  const valCount = validCount - trainCount;

  console.log(`📅 Split: treino até ${splitDate}`);
  console.log(`📊 Treino: ${trainCount} | Validação: ${valCount}`);

  const trainVectors = new Float32Array(trainCount * featureCount);
  const trainTargets = new Float32Array(trainCount);
  const valVectors = new Float32Array(valCount * featureCount);
  const valTargets = new Float32Array(valCount);

  let tIdx = 0;
  let vIdx = 0;
  for (let i = 0; i < validCount; i++) {
    const srcOffset = i * featureCount;
    if (dateEpochs[i] < splitEpoch) {
      trainVectors.set(
        vectors.subarray(srcOffset, srcOffset + featureCount),
        tIdx * featureCount,
      );
      trainTargets[tIdx] = targets[i];
      tIdx++;
    } else {
      valVectors.set(
        vectors.subarray(srcOffset, srcOffset + featureCount),
        vIdx * featureCount,
      );
      valTargets[vIdx] = targets[i];
      vIdx++;
    }
  }

  // @ts-ignore
  vectors = null as any;
  targets = null as any;
  dateEpochs = null as any;
  tryGC();
  logMemory("APÓS_SPLIT");

  console.log("📏 Calculando normalização robusta...");
  const median: number[] = new Array(featureCount);
  const iqr: number[] = new Array(featureCount);
  const mean: number[] = new Array(featureCount);
  const std: number[] = new Array(featureCount);
  const columnBuffer = new Float32Array(trainCount);

  for (let col = 0; col < featureCount; col++) {
    for (let row = 0; row < trainCount; row++)
      columnBuffer[row] = trainVectors[row * featureCount + col];
    const sorted = columnBuffer.slice().sort();
    median[col] = sorted[Math.floor(trainCount * 0.5)];
    const rawIqr =
      sorted[Math.floor(trainCount * 0.75)] -
      sorted[Math.floor(trainCount * 0.25)];
    iqr[col] = rawIqr > 0 ? rawIqr : 1;
    let sum = 0;
    for (let row = 0; row < trainCount; row++) sum += columnBuffer[row];
    mean[col] = sum / trainCount;
    let sumSq = 0;
    for (let row = 0; row < trainCount; row++) {
      const d = columnBuffer[row] - mean[col];
      sumSq += d * d;
    }
    std[col] = Math.sqrt(sumSq / trainCount) + 1e-7;
  }

  console.log("📏 Aplicando normalização in-place...");
  for (let row = 0; row < trainCount; row++) {
    for (let col = 0; col < featureCount; col++) {
      const idx = row * featureCount + col;
      trainVectors[idx] = Math.max(
        -3,
        Math.min(3, (trainVectors[idx] - median[col]) / iqr[col]),
      );
    }
  }
  for (let row = 0; row < valCount; row++) {
    for (let col = 0; col < featureCount; col++) {
      const idx = row * featureCount + col;
      valVectors[idx] = Math.max(
        -3,
        Math.min(3, (valVectors[idx] - median[col]) / iqr[col]),
      );
    }
  }
  logMemory("APÓS_NORMALIZAÇÃO");

  console.log("🔢 Criando tensores finais...");
  const trainX = tf.tensor2d(trainVectors, [trainCount, featureCount]);
  const trainY = tf.tensor2d(trainTargets, [trainCount, 1]);
  const valX = tf.tensor2d(valVectors, [valCount, featureCount]);
  const valY = tf.tensor2d(valTargets, [valCount, 1]);

  let c0 = 0,
    c1 = 0;
  for (let i = 0; i < trainCount; i++) {
    if (trainTargets[i] === 0) c0++;
    else c1++;
  }
  for (let i = 0; i < valCount; i++) {
    if (valTargets[i] === 0) c0++;
    else c1++;
  }
  const tot = c0 + c1;
  const classWeights = { 0: tot / (2 * c0), 1: tot / (2 * c1) };
  console.log(
    `⚖ Pesos de classe: 0=${classWeights[0].toFixed(2)}, 1=${classWeights[1].toFixed(2)}`,
  );
  logMemory("FINAL");

  return {
    trainX,
    trainY,
    valX,
    valY,
    features: selectedFeatures,
    featureCount,
    sampleCount: trainCount,
    classWeights,
    normalization: { mean, std, median, iqr },
  };
}

// ============================================================================
// FEATURES
// ============================================================================

const selectedFeatures = [
  "career_win_rate",
  "career_place_rate",
  "career_avg_position",
  "career_position_std",
  "career_runs",
  "career_wins",
  "course_win_rate",
  "course_runs",
  "distance_band_win_rate",
  "going_win_rate",
  "class_win_rate",
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
  "sp_decimal",
  "sp_implied_prob",
  "sp_rank",
  "sp_vs_field_avg",
  "market_confidence",
  "is_favorite",
  "is_outsider",
  "or_rating_imputed",
  "or_rank_in_race",
  "or_percentile_in_race",
  "or_diff_to_top",
  "or_advantage_score",
  "field_avg_or",
  "field_std_or",
  "field_avg_career_wins",
  "race_field_size",
  "stronger_opponents_count",
  "is_competitive_race",
  "jockey_win_rate",
  "jockey_recent_form",
  "jockey_course_win_rate",
  "jockey_total_runs",
  "trainer_win_rate",
  "trainer_recent_form",
  "trainer_course_win_rate",
  "jockey_trainer_combo_win_rate",
  "race_going_encoded",
  "race_distance_meters",
  "race_class",
  "days_since_last_run",
  "horse_age",
  "horse_weight_kg",
  "recent_avg_position",
  "recent_runs_90d",
  "out_of_top3_rate",
  "position_volatility",
  "beaten_favorite_rate",
  "worst_recent_position",
  "surface_encoded",
];

// ============================================================================
// CREATE MODEL
// ============================================================================

function createModel(inputDim: number): tf.LayersModel {
  console.log(`  🏗  Criando modelo com ${inputDim} features de entrada...`);
  const model = tf.sequential({
    layers: [
      tf.layers.dense({
        inputShape: [inputDim],
        units: 128,
        activation: "relu",
        kernelInitializer: "heNormal",
        kernelRegularizer: tf.regularizers.l2({ l2: 0.001 }),
      }),
      tf.layers.batchNormalization(),
      tf.layers.dropout({ rate: 0.3 }),
      tf.layers.dense({
        units: 64,
        activation: "relu",
        kernelInitializer: "heNormal",
        kernelRegularizer: tf.regularizers.l2({ l2: 0.001 }),
      }),
      tf.layers.batchNormalization(),
      tf.layers.dropout({ rate: 0.25 }),
      tf.layers.dense({
        units: 32,
        activation: "relu",
        kernelInitializer: "heNormal",
      }),
      tf.layers.dropout({ rate: 0.2 }),
      tf.layers.dense({
        units: 16,
        activation: "relu",
        kernelInitializer: "heNormal",
      }),
      tf.layers.dropout({ rate: 0.15 }),
      tf.layers.dense({ units: 1, activation: "sigmoid" }),
    ],
  });
  model.compile({
    optimizer: tf.train.adam(0.0005),
    loss: "binaryCrossentropy",
    metrics: ["accuracy"],
  });
  console.log("  ✅ Modelo criado e compilado");
  model.summary();
  return model;
}

// ============================================================================
// TRAIN MODEL
// ============================================================================

async function trainModel(model: tf.LayersModel, data: any) {
  let finalMetrics = {
    trainLoss: 0,
    trainAcc: 0,
    valLoss: 0,
    valAcc: 0,
    epochs: 0,
  };
  let bestValLoss = Number.POSITIVE_INFINITY;
  let bestWeights: tf.Tensor[] | null = null;
  let patienceCounter = 0;
  let actualEpochs = 0;

  console.log("  📋 Configuração:");
  console.log(`   - Max épocas: ${configGlobal.maxEpochs}`);
  console.log(`   - Patience: ${configGlobal.patience}`);
  console.log(`   - Learning rate: ${configGlobal.learningRate}`);
  console.log("  🚀 Iniciando epochs...\n");

  try {
    for (let epoch = 0; epoch < configGlobal.maxEpochs; epoch++) {
      const history = await model.fit(data.trainX, data.trainY, {
        epochs: 1,
        batchSize: configGlobal.batchSize,
        validationData: [data.valX, data.valY],
        classWeight: data.classWeights,
        verbose: 0,
      });

      const trainLoss = history.history.loss[0] as number;
      const trainAcc = history.history.acc[0] as number;
      const valLoss = history.history.val_loss[0] as number;
      const valAcc = history.history.val_acc[0] as number;
      finalMetrics = {
        trainLoss,
        trainAcc,
        valLoss,
        valAcc,
        epochs: epoch + 1,
      };

      if (epoch % 10 === 0) {
        console.log(
          `  Epoch ${epoch}: loss=${trainLoss.toFixed(4)}, acc=${trainAcc.toFixed(4)}, val_loss=${valLoss.toFixed(4)}, val_acc=${valAcc.toFixed(4)}`,
        );
        logMemory(`Epoch ${epoch}`);
      }

      if (valLoss < bestValLoss) {
        bestValLoss = valLoss;
        if (bestWeights) bestWeights.forEach((w) => w.dispose());
        bestWeights = model.getWeights().map((w) => w.clone());
        patienceCounter = 0;
        console.log(
          `  📈 Melhor modelo - Epoch ${epoch}: val_loss=${valLoss.toFixed(4)}`,
        );
      } else {
        patienceCounter++;
        if (patienceCounter >= configGlobal.patience) {
          console.log(
            `  ⏹  Early stopping na época ${epoch} (patience=${configGlobal.patience})`,
          );
          actualEpochs = epoch + 1;
          break;
        }
      }
      actualEpochs = epoch + 1;
    }

    if (bestWeights) {
      console.log("  ♻  Restaurando melhores pesos...");
      model.setWeights(bestWeights);
      const finalEval = (await model.evaluate(
        data.valX,
        data.valY,
      )) as tf.Tensor[];
      finalMetrics.valLoss = (await finalEval[0].data())[0];
      finalMetrics.valAcc = (await finalEval[1].data())[0];
      finalMetrics.epochs = actualEpochs;
      finalEval.forEach((t) => t.dispose());
      bestWeights.forEach((w) => w.dispose());
    }

    console.log(
      `\n  ✅ Finalizado em ${actualEpochs} épocas, melhor val_loss: ${bestValLoss.toFixed(4)}`,
    );
    return finalMetrics;
  } catch (error) {
    console.error("\n  ❌ ERRO durante treinamento:", error);
    throw error;
  }
}

// ============================================================================
// SAVE MODEL
// ============================================================================

async function saveModelToSupabase(
  model: tf.LayersModel,
  config: ModelConfig,
  modelType: ModelType,
) {
  const modelPath = getModelPath(modelType);
  const maxRetries = 3;
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      const tempPath = `/tmp/model_${modelType}_${Date.now()}`;
      await model.save(`file://${tempPath}`);
      const fs = require("fs");
      const modelJson = fs.readFileSync(`${tempPath}/model.json`);
      const modelWeights = fs.readFileSync(`${tempPath}/weights.bin`);

      const { error: e1 } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(`${modelPath}/model.json`, modelJson, {
          contentType: "application/json",
          upsert: true,
        });
      if (e1) throw new Error(`Upload model.json falhou: ${e1.message}`);

      const { error: e2 } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(`${modelPath}/weights.bin`, modelWeights, {
          contentType: "application/octet-stream",
          upsert: true,
        });
      if (e2) throw new Error(`Upload weights.bin falhou: ${e2.message}`);

      const { error: e3 } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(`${modelPath}/config.json`, JSON.stringify(config, null, 2), {
          contentType: "application/json",
          upsert: true,
        });
      if (e3) throw new Error(`Upload config.json falhou: ${e3.message}`);

      fs.unlinkSync(`${tempPath}/model.json`);
      fs.unlinkSync(`${tempPath}/weights.bin`);
      console.log(`  ✅ Modelo ${modelType} salvo em ${modelPath}`);
      return;
    } catch (error) {
      attempts++;
      console.warn(
        `! Erro ao salvar modelo, tentativa ${attempts}/${maxRetries}:`,
        error,
      );
      if (attempts >= maxRetries) throw error;
      await new Promise((r) => setTimeout(r, 5000 * attempts));
    }
  }
}

// ============================================================================
// SAVE METRICS
// ============================================================================

async function saveMetricsHistory(config: ModelConfig, modelType: ModelType) {
  try {
    const { data, error } = await supabase
      .schema("hml")
      .from("model_metrics_history")
      .insert({
        version: config.version,
        timestamp: config.metrics.timestamp,
        train_accuracy: config.metrics.trainAccuracy,
        val_accuracy: config.metrics.valAccuracy,
        train_loss: config.metrics.trainLoss,
        val_loss: config.metrics.valLoss,
        samples_used: config.training.samplesUsed,
        epochs: config.training.epochs,
        model_type: modelType,
      })
      .select();

    if (error) throw new Error(`Erro ao salvar métricas: ${error.message}`);
    console.log("  ✅ Métricas salvas com sucesso");
  } catch (error) {
    console.error("  ❌ ERRO ao salvar métricas:", error);
    console.log("  !  Continuando apesar do erro...");
  }
}

// ============================================================================
// UTILS
// ============================================================================

async function calibrateThreshold(
  model: tf.LayersModel,
  valX: tf.Tensor2D,
  valY: tf.Tensor2D,
): Promise<number> {
  console.log("\n🎯 Calibrando threshold ótimo...");
  const predictions = model.predict(valX) as tf.Tensor;
  const probs = await predictions.data();
  const trueLabels = await valY.data();
  predictions.dispose();

  const thresholds = Array.from({ length: 50 }, (_, i) => 0.5 + i * 0.01);
  let bestThreshold = 0.85;
  let bestF1 = 0;

  console.log("\n  Threshold | Precision | Recall | F1     | LAY%");
  console.log("  " + "-".repeat(52));

  for (const threshold of thresholds) {
    let tp = 0,
      fp = 0,
      fn = 0;
    for (let i = 0; i < probs.length; i++) {
      const predicted = probs[i] >= threshold ? 1 : 0;
      const actual = trueLabels[i];
      if (predicted === 1 && actual === 1) tp++;
      if (predicted === 1 && actual === 0) fp++;
      if (predicted === 0 && actual === 1) fn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 =
      precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : 0;
    const layPct = ((tp + fp) / probs.length) * 100;

    if (Math.round(threshold * 100) % 5 === 0) {
      console.log(
        `  ${threshold.toFixed(2)}      | ${(precision * 100).toFixed(1)}%     | ${(recall * 100).toFixed(1)}%  | ${f1.toFixed(4)} | ${layPct.toFixed(1)}%`,
      );
    }

    if (precision >= 0.95 && layPct >= 15 && layPct <= 30 && f1 > bestF1) {
      bestF1 = f1;
      bestThreshold = threshold;
    }
  }

  console.log(`\n  ✅ Threshold ótimo: ${bestThreshold.toFixed(2)}`);
  console.log(`  📊 F1: ${bestF1.toFixed(4)}`);
  return bestThreshold;
}
