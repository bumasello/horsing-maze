// src/services/ml/training_final.ts
//
// RACE-LEVEL SOFTMAX TRAINING (Conditional Logit)
// Substitui o modelo anterior de sigmoid independente por horse.
//
// Mudanças principais:
//   - Dados agrupados por corrida em vez de por cavalo
//   - Tensor 3D: [num_races, max_horses, n_features] com padding
//   - Rede compartilhada gera "score" por cavalo
//   - Softmax aplicado dentro da corrida (com masking de padded positions)
//   - Loss: categorical cross-entropy contra o vencedor real
//   - P(não vence) = 1 - P(vence) — agora coerente dentro da corrida

import * as tf from "@tensorflow/tfjs-node";
import { supabase } from "../..";
import type { ModelConfig } from "../../shared/types/ml.types";

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

const BUCKET_NAME = "modelos-tfjs-publicos";
const MAX_HORSES = 30; // Cobre até o Grand National (40 horses são exceção rara)

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
  batchSize: 16, // Batches menores: cada amostra é uma corrida (~10-30 cavalos)
};

// ============================================================================
// EXPORTS
// ============================================================================

export async function trainAllModels(): Promise<void> {
  console.log(
    "🚀 Iniciando treinamento RACE-LEVEL de modelos Flat + Jump...\n",
  );
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
  console.log(`🏇 Treinando modelo RACE-LEVEL: ${typeConfig.label}`);
  console.log(`📁 Path: ${modelPath}`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    console.log("🔍 [STEP 1/7] Verificando modelo existente...");
    const existingConfig = await checkExistingModel(modelType);
    if (existingConfig) {
      console.log(`✅ Modelo existente — versão ${existingConfig.version}`);
    } else {
      console.log("i  Primeira versão do modelo race-level");
    }

    console.log("\n📊 [STEP 2/7] Carregando e agrupando por corrida...");
    const trainingData = await loadAndPrepareDataRaceLevel(modelType);
    console.log("✅ Dados preparados");

    console.log("\n🏗  [STEP 3/7] Criando arquitetura race-level...");
    const model = createRaceLevelModel(trainingData.featureCount);
    console.log("✅ Modelo criado");

    console.log("\n🏋  [STEP 4/7] Treinando com loop customizado...");
    const history = await trainRaceLevelModel(model, trainingData);
    console.log("✅ Treinamento concluído");

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
        classWeights: { 0: 1, 1: 1 }, // N/A para race-level
      },
      // PLACEHOLDER: threshold precisa de recalibração com nova escala de probs
      // Com softmax, P(não vence) é relativa ao field size, não absoluta
      optimalThreshold: 0.85,
    };

    console.log("\n💾 [STEP 6/7] Salvando modelo...");
    await saveModelToSupabase(model, config, modelType);
    console.log("✅ Modelo salvo");

    console.log("\n📊 [STEP 7/7] Salvando métricas...");
    await saveMetricsHistory(config, modelType);

    console.log("\n🧹 Limpando recursos...");
    trainingData.trainX.dispose();
    trainingData.trainY.dispose();
    trainingData.valX.dispose();
    trainingData.valY.dispose();
    model.dispose();

    console.log(`\n✅ Treinamento ${typeConfig.label} completo!`);
    console.log(`📊 Versão: ${config.version}`);
    console.log(
      `📊 Top-1 acc treino: ${(config.metrics.trainAccuracy * 100).toFixed(2)}%`,
    );
    console.log(
      `📊 Top-1 acc validação: ${(config.metrics.valAccuracy * 100).toFixed(2)}%`,
    );
    console.log(`📊 (random baseline ~10% para field de 10 cavalos)`);
  } catch (error) {
    console.error(`\n❌ Erro no treinamento ${typeConfig.label}:`);
    console.error(error);
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
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(`${modelPath}/config.json`);
    if (error || !data) return null;
    const text = await data.text();
    return JSON.parse(text);
  } catch {
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
// LOAD AND PREPARE DATA — RACE-LEVEL
// ============================================================================

interface RaceGroup {
  raceId: number;
  raceDate: number;
  horses: Array<{
    features: Float32Array;
    target: number; // 0 = vencedor, 1 = não-vencedor (formato original do banco)
  }>;
}

async function loadAndPrepareDataRaceLevel(modelType: ModelType) {
  const featureCount = selectedFeatures.length;
  const typeConfig = MODEL_TYPE_CONFIG[modelType];
  logMemory("INÍCIO");

  console.log(`📊 Carregando dados (${typeConfig.label})...`);

  const { count: totalCount, error: countError } = await supabase
    .schema("hml")
    .from("training_enriched_horse_features")
    .select("*", { count: "exact", head: true })
    .gte("quality_score", 0.7)
    .in("race_type", typeConfig.raceTypes);

  if (countError) throw new Error(`Count falhou: ${countError.message}`);
  if (!totalCount || totalCount === 0)
    throw new Error(`Sem dados para ${typeConfig.label}`);

  console.log(`📊 Total registros ${typeConfig.label}: ${totalCount}`);

  // Streaming + agrupamento por race_id
  const racesMap = new Map<number, RaceGroup>();

  const pageSize = 1000;
  const maxAttempts = 3;
  let currentPage = 0;
  let processedHorses = 0;

  console.log("📥 Streaming + agrupamento por corrida...");
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
        .select("features, target, race_id, race_date")
        .gte("quality_score", 0.7)
        .in("race_type", typeConfig.raceTypes)
        .order("race_date", { ascending: true })
        .range(from, to);

      if (error) {
        if (error.code === "57014") {
          attempts++;
          await new Promise((r) => setTimeout(r, 3000 * attempts));
          continue;
        }
        throw error;
      }
      pageData = data;
      break;
    }

    if (!pageData) {
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

      // Extrair vetor de features
      const vector = new Float32Array(featureCount);
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
        vector[i] = Number(value);
      }

      if (!isValid) continue;

      const raceId = record.race_id;
      const raceDate = new Date(record.race_date).getTime();

      if (!racesMap.has(raceId)) {
        racesMap.set(raceId, { raceId, raceDate, horses: [] });
      }

      racesMap.get(raceId)!.horses.push({
        features: vector,
        target: record.target ?? 1,
      });

      processedHorses++;
    }

    pageData = null;
    currentPage++;

    if (currentPage % 10 === 0 || currentPage * pageSize >= totalCount) {
      console.log(
        `📥 ${Math.min(currentPage * pageSize, totalCount)}/${totalCount}, ${processedHorses} cavalos, ${racesMap.size} corridas...`,
      );
    }
  }

  console.log(
    `✅ ${processedHorses} cavalos agrupados em ${racesMap.size} corridas`,
  );
  logMemory("APÓS_STREAMING");
  tryGC();

  // Filtrar corridas válidas: precisa ter pelo menos 1 vencedor (target=0) e <= MAX_HORSES
  const validRaces: RaceGroup[] = [];
  let droppedNoWinner = 0;
  let droppedTooManyHorses = 0;
  let droppedTooFewHorses = 0;

  for (const race of racesMap.values()) {
    if (race.horses.length < 3) {
      droppedTooFewHorses++;
      continue;
    }
    if (race.horses.length > MAX_HORSES) {
      droppedTooManyHorses++;
      continue;
    }
    const hasWinner = race.horses.some((h) => h.target === 0);
    if (!hasWinner) {
      droppedNoWinner++;
      continue;
    }
    validRaces.push(race);
  }

  console.log(`✅ ${validRaces.length} corridas válidas`);
  if (droppedNoWinner > 0)
    console.log(`  ! ${droppedNoWinner} sem vencedor (descartadas)`);
  if (droppedTooManyHorses > 0)
    console.log(`  ! ${droppedTooManyHorses} com >${MAX_HORSES} cavalos`);
  if (droppedTooFewHorses > 0)
    console.log(`  ! ${droppedTooFewHorses} com <3 cavalos`);

  if (validRaces.length === 0) throw new Error("Nenhuma corrida válida");

  // Ordenar cronologicamente
  validRaces.sort((a, b) => a.raceDate - b.raceDate);
  racesMap.clear();
  tryGC();

  // Split temporal 80/20
  const splitIdx = Math.floor(validRaces.length * 0.8);
  const trainRaces = validRaces.slice(0, splitIdx);
  const valRaces = validRaces.slice(splitIdx);

  const splitDate = new Date(validRaces[splitIdx].raceDate)
    .toISOString()
    .split("T")[0];
  console.log(`📅 Split temporal: treino até ${splitDate}`);
  console.log(
    `📊 Treino: ${trainRaces.length} corridas | Val: ${valRaces.length} corridas`,
  );

  // Calcular normalização robusta no TREINO (todos os cavalos do treino)
  console.log("📏 Calculando normalização...");
  const median = new Array(featureCount);
  const iqr = new Array(featureCount);
  const mean = new Array(featureCount);
  const std = new Array(featureCount);

  const totalTrainHorses = trainRaces.reduce(
    (sum, r) => sum + r.horses.length,
    0,
  );
  const columnBuffer = new Float32Array(totalTrainHorses);

  for (let col = 0; col < featureCount; col++) {
    let idx = 0;
    for (const race of trainRaces) {
      for (const horse of race.horses) {
        columnBuffer[idx++] = horse.features[col];
      }
    }

    const sorted = columnBuffer.slice(0, totalTrainHorses).sort();
    median[col] = sorted[Math.floor(totalTrainHorses * 0.5)];
    const rawIqr =
      sorted[Math.floor(totalTrainHorses * 0.75)] -
      sorted[Math.floor(totalTrainHorses * 0.25)];
    iqr[col] = rawIqr > 0 ? rawIqr : 1;

    let sum = 0;
    for (let i = 0; i < totalTrainHorses; i++) sum += columnBuffer[i];
    mean[col] = sum / totalTrainHorses;

    let sumSq = 0;
    for (let i = 0; i < totalTrainHorses; i++) {
      const d = columnBuffer[i] - mean[col];
      sumSq += d * d;
    }
    std[col] = Math.sqrt(sumSq / totalTrainHorses) + 1e-7;
  }

  // Construir tensores 3D: [num_races, MAX_HORSES, featureCount]
  console.log("🔢 Construindo tensores 3D...");

  const buildTensors = (races: RaceGroup[]) => {
    const numRaces = races.length;
    const xBuffer = new Float32Array(numRaces * MAX_HORSES * featureCount);
    // y: 1 para vencedor, 0 para perdedor, -1 para padding (será mascarado no loss)
    const yBuffer = new Float32Array(numRaces * MAX_HORSES);

    for (let r = 0; r < numRaces; r++) {
      const race = races[r];
      for (let h = 0; h < MAX_HORSES; h++) {
        const yIdx = r * MAX_HORSES + h;
        if (h < race.horses.length) {
          const horse = race.horses[h];
          // Normalizar in-place ao copiar para o buffer
          const xOffset = (r * MAX_HORSES + h) * featureCount;
          for (let f = 0; f < featureCount; f++) {
            const normalized = (horse.features[f] - median[f]) / iqr[f];
            xBuffer[xOffset + f] = Math.max(-3, Math.min(3, normalized));
          }
          // Inverter target: original 0=vence → novo 1=vence
          yBuffer[yIdx] = horse.target === 0 ? 1 : 0;
        } else {
          // Padding: features = 0, y = -1 (mask)
          yBuffer[yIdx] = -1;
        }
      }
    }

    const x = tf.tensor3d(xBuffer, [numRaces, MAX_HORSES, featureCount]);
    const y = tf.tensor2d(yBuffer, [numRaces, MAX_HORSES]);
    return { x, y };
  };

  const train = buildTensors(trainRaces);
  const val = buildTensors(valRaces);

  logMemory("APÓS_TENSORES");

  return {
    trainX: train.x,
    trainY: train.y,
    valX: val.x,
    valY: val.y,
    features: selectedFeatures,
    featureCount,
    sampleCount: trainRaces.length,
    classWeights: { 0: 1, 1: 1 },
    normalization: { mean, std, median, iqr },
  };
}

// ============================================================================
// FEATURES (mesma lista de antes)
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
// CREATE MODEL — RACE-LEVEL (3D input, shared weights)
// ============================================================================

function createRaceLevelModel(inputDim: number): tf.LayersModel {
  console.log(
    `  🏗  Modelo race-level: input [batch, ${MAX_HORSES}, ${inputDim}]`,
  );

  // Input shape: [MAX_HORSES, inputDim] — Dense layers aplicam shared weights na última dim
  const model = tf.sequential({
    layers: [
      tf.layers.dense({
        inputShape: [MAX_HORSES, inputDim],
        units: 128,
        activation: "relu",
        kernelInitializer: "heNormal",
        kernelRegularizer: tf.regularizers.l2({ l2: 0.001 }),
      }),
      tf.layers.dropout({ rate: 0.3 }),
      tf.layers.dense({
        units: 64,
        activation: "relu",
        kernelInitializer: "heNormal",
        kernelRegularizer: tf.regularizers.l2({ l2: 0.001 }),
      }),
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
      // Score linear (sem ativação) — softmax aplicado depois com masking
      tf.layers.dense({ units: 1 }),
    ],
  });

  console.log("  ✅ Modelo criado (output: score raw por cavalo)");
  model.summary();
  return model;
}

// ============================================================================
// TRAIN MODEL — Custom loop com masked softmax + categorical cross-entropy
// ============================================================================

/**
 * Loss customizado: masked softmax cross-entropy
 * - scores: [batch, MAX_HORSES] — output do modelo (raw scores)
 * - targets: [batch, MAX_HORSES] — 1 para vencedor, 0 para perdedor, -1 para padding
 *
 * 1. Cria mask: 1 onde target >= 0 (real), 0 onde target = -1 (padding)
 * 2. Aplica softmax dentro de cada corrida, com padding mascarado (score → -inf)
 * 3. Cross-entropy contra target one-hot
 */
function maskedSoftmaxCrossEntropy(
  scores: tf.Tensor2D,
  targets: tf.Tensor2D,
): { loss: tf.Scalar; probs: tf.Tensor2D } {
  return tf.tidy(() => {
    // Mask: 1 onde target >= 0, 0 onde target = -1
    const mask = targets.greaterEqual(0).toFloat() as tf.Tensor2D;

    // Targets limpos: -1 → 0 (padding não é vencedor)
    const targetsClean = targets.maximum(0) as tf.Tensor2D;

    // Mascarar scores antes do softmax: padded recebe -1e9 (vira ~0 no softmax)
    const maskAdjustment = mask.sub(1).mul(1e9) as tf.Tensor2D;
    const maskedScores = scores.add(maskAdjustment) as tf.Tensor2D;

    // Softmax dentro da corrida (dim=1)
    const probs = tf.softmax(maskedScores, -1) as tf.Tensor2D;

    // Cross-entropy: -sum(target * log(prob))
    const logProbs = tf.log(probs.add(1e-9));
    const losses = targetsClean.mul(logProbs).neg().sum(-1);
    const loss = losses.mean() as tf.Scalar;

    // Retornar probs também para calcular accuracy fora
    return { loss, probs: tf.keep(probs) };
  });
}

/**
 * Top-1 accuracy: quantas vezes o modelo colocou o vencedor real
 * com a maior probabilidade dentro da corrida
 */
function calculateTop1Accuracy(
  probs: tf.Tensor2D,
  targets: tf.Tensor2D,
): number {
  return tf.tidy(() => {
    // Argmax das probs: índice do cavalo com maior P(vence) por corrida
    const predictedWinner = probs.argMax(-1); // [batch]
    // Argmax dos targets: índice do vencedor real (target = 1)
    const actualWinner = targets.argMax(-1); // [batch]

    const correct = predictedWinner.equal(actualWinner).toFloat();
    const acc = correct.mean().dataSync()[0];
    return acc;
  });
}

async function trainRaceLevelModel(model: tf.LayersModel, data: any) {
  const optimizer = tf.train.adam(configGlobal.learningRate);
  const trainCount = data.trainX.shape[0];
  const valCount = data.valX.shape[0];

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

  console.log(`  📋 ${trainCount} corridas treino, ${valCount} validação`);
  console.log(
    `  📋 Batch size: ${configGlobal.batchSize}, Max epochs: ${configGlobal.maxEpochs}`,
  );
  console.log("  🚀 Iniciando epochs...\n");

  for (let epoch = 0; epoch < configGlobal.maxEpochs; epoch++) {
    // Shuffle índices para esta época
    const indices = tf.util.createShuffledIndices(trainCount);
    const numBatches = Math.ceil(trainCount / configGlobal.batchSize);

    let epochLoss = 0;
    let epochAccSum = 0;
    let epochAccCount = 0;

    for (let b = 0; b < numBatches; b++) {
      const start = b * configGlobal.batchSize;
      const end = Math.min(start + configGlobal.batchSize, trainCount);
      const batchIndices = Array.from(indices.slice(start, end));

      // Extrair batch
      const batchX = tf.tidy(
        () => tf.gather(data.trainX, batchIndices) as tf.Tensor3D,
      );
      const batchY = tf.tidy(
        () => tf.gather(data.trainY, batchIndices) as tf.Tensor2D,
      );

      let batchProbs: tf.Tensor2D | null = null;

      const lossValue = optimizer.minimize(() => {
        const scoresRaw = model.apply(batchX) as tf.Tensor3D; // [batch, MAX_HORSES, 1]
        const scores = scoresRaw.squeeze([2]) as tf.Tensor2D; // [batch, MAX_HORSES]
        const { loss, probs } = maskedSoftmaxCrossEntropy(scores, batchY);
        batchProbs = probs;
        return loss;
      }, true) as tf.Scalar;

      epochLoss += lossValue.dataSync()[0];
      lossValue.dispose();

      if (batchProbs) {
        epochAccSum += calculateTop1Accuracy(batchProbs, batchY);
        epochAccCount++;
        (batchProbs as tf.Tensor2D).dispose();
      }

      batchX.dispose();
      batchY.dispose();
    }

    const trainLoss = epochLoss / numBatches;
    const trainAcc = epochAccCount > 0 ? epochAccSum / epochAccCount : 0;

    // Validação
    const { valLoss, valAcc } = await evaluateModel(
      model,
      data.valX,
      data.valY,
    );

    finalMetrics = { trainLoss, trainAcc, valLoss, valAcc, epochs: epoch + 1 };

    if (epoch % 5 === 0) {
      console.log(
        `  Epoch ${epoch}: loss=${trainLoss.toFixed(4)}, top1=${(trainAcc * 100).toFixed(1)}%, ` +
          `val_loss=${valLoss.toFixed(4)}, val_top1=${(valAcc * 100).toFixed(1)}%`,
      );
      logMemory(`Epoch ${epoch}`);
    }

    // Early stopping
    if (valLoss < bestValLoss) {
      bestValLoss = valLoss;
      if (bestWeights) bestWeights.forEach((w) => w.dispose());
      bestWeights = model.getWeights().map((w) => w.clone());
      patienceCounter = 0;
      console.log(
        `  📈 Melhor val_loss - Epoch ${epoch}: ${valLoss.toFixed(4)}`,
      );
    } else {
      patienceCounter++;
      if (patienceCounter >= configGlobal.patience) {
        console.log(`  ⏹  Early stopping na época ${epoch}`);
        actualEpochs = epoch + 1;
        break;
      }
    }
    actualEpochs = epoch + 1;
  }

  if (bestWeights) {
    console.log("  ♻  Restaurando melhores pesos...");
    model.setWeights(bestWeights);
    const finalEval = await evaluateModel(model, data.valX, data.valY);
    finalMetrics.valLoss = finalEval.valLoss;
    finalMetrics.valAcc = finalEval.valAcc;
    finalMetrics.epochs = actualEpochs;
    bestWeights.forEach((w) => w.dispose());
  }

  console.log(
    `\n  ✅ Finalizado em ${actualEpochs} épocas, melhor val_loss: ${bestValLoss.toFixed(4)}`,
  );
  return finalMetrics;
}

async function evaluateModel(
  model: tf.LayersModel,
  valX: tf.Tensor,
  valY: tf.Tensor,
): Promise<{ valLoss: number; valAcc: number }> {
  return tf.tidy(() => {
    const scoresRaw = model.apply(valX) as tf.Tensor3D;
    const scores = scoresRaw.squeeze([2]) as tf.Tensor2D;
    const { loss, probs } = maskedSoftmaxCrossEntropy(
      scores,
      valY as tf.Tensor2D,
    );
    const valLoss = loss.dataSync()[0];
    const valAcc = calculateTop1Accuracy(probs, valY as tf.Tensor2D);
    (probs as tf.Tensor2D).dispose();
    return { valLoss, valAcc };
  });
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
      if (e1) throw new Error(`Upload model.json: ${e1.message}`);

      const { error: e2 } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(`${modelPath}/weights.bin`, modelWeights, {
          contentType: "application/octet-stream",
          upsert: true,
        });
      if (e2) throw new Error(`Upload weights.bin: ${e2.message}`);

      const { error: e3 } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(`${modelPath}/config.json`, JSON.stringify(config, null, 2), {
          contentType: "application/json",
          upsert: true,
        });
      if (e3) throw new Error(`Upload config.json: ${e3.message}`);

      fs.unlinkSync(`${tempPath}/model.json`);
      fs.unlinkSync(`${tempPath}/weights.bin`);
      console.log(`  ✅ Modelo ${modelType} salvo`);
      return;
    } catch (error) {
      attempts++;
      console.warn(`! Tentativa ${attempts}/${maxRetries}:`, error);
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
    const { error } = await supabase
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
      });
    if (error) throw new Error(`Salvar métricas: ${error.message}`);
    console.log("  ✅ Métricas salvas");
  } catch (error) {
    console.error("  ❌ Erro ao salvar métricas:", error);
  }
}
