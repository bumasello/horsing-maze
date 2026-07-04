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
//   - LR Scheduling: ReduceLROnPlateau manual no custom loop
//   - Custom LAY Loss: penaliza quando vencedor está entre picks LAY
//   - [v28] LAY Loss ATIVADO no training loop com warmup
//   - [v29] Loss principal de treino agora é Top-K ListMLE (Plackett-Luce),
//          que usa a ordem completa de chegada (top-K=5) em vez de só o vencedor.
//          Validação ainda usa CE-só-do-vencedor pra val_loss permanecer
//          comparável com versões anteriores do modelo.
//   - [v30] Calibração:
//          * Brier score e ECE calculados a cada época (val set).
//          * Best model selection agora é por val_brier (Walsh & Joshi 2024).
//          * Early stopping e LR scheduler continuam em val_loss (mais estável).
//          * Isotonic regression (PAV) ajustado no val no fim do treino,
//            knots salvos em config.calibration.knots; predição aplica curva
//            + renormaliza dentro da corrida.

import * as tf from "@tensorflow/tfjs-node";
import { supabase } from "../..";
import { createAttentionModel } from "./layers/attention";
import type { ModelConfig } from "../../shared/types/ml.types";
import { fitIsotonic } from "./calibration";

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

function getExperimentLabel(): string {
  return (process.env.EXPERIMENT_LABEL || "").trim();
}

function isMultiTask(): boolean {
  // Multi-task é o DEFAULT de prod desde 2026-07-04 (mt_b05 = v68-flat promovido).
  // MULTITASK_MODE=0 desativa (volta ao single-head legado).
  return (process.env.MULTITASK_MODE || "1").trim() !== "0";
}

function getModelPath(modelType: ModelType): string {
  const base = `horse_probability_model/${MODEL_TYPE_CONFIG[modelType].name}`;
  // EXPERIMENT_LABEL tem prioridade sobre BASELINE_MODE — permite combinações
  // como BASELINE_MODE=lean + EXPERIMENT_LABEL=multitask_lean.
  // ATENÇÃO: multi-task NÃO desvia mais o path — é a arquitetura de prod.
  // Runs isolados exigem EXPERIMENT_LABEL ou BASELINE_MODE explícitos.
  const experiment = getExperimentLabel();
  if (experiment) {
    return `horse_probability_model/baselines/${experiment}_${modelType}`;
  }
  const baseline = getBaselineMode();
  if (baseline) {
    return `horse_probability_model/baselines/${baseline}_${modelType}`;
  }
  return base;
}

// ============================================================================
// BASELINE MODE (Fase 1 debug — Phase 1 of project_debug_plan_val_top1)
// ============================================================================
// BASELINE_MODE env var:
//   ""          → comportamento normal (prod)
//   "sp_only"   → treina só com sp_implied_prob (1 feature) — mede ceiling do mercado
//   "no_market" → drop todas features de mercado — mede contribuição das demais
// Em qualquer baseline: save em path isolado (baselines/), pula saveMetricsHistory.

const NO_MARKET_FEATURES = new Set([
  "sp_decimal",
  "sp_implied_prob",
  "sp_rank",
  "sp_vs_field_avg",
  "market_confidence",
  "is_favorite",
  "is_outsider",
]);

function getBaselineMode(): "" | "sp_only" | "no_market" | "lean" {
  const v = (process.env.BASELINE_MODE || "").trim();
  if (v === "sp_only" || v === "no_market" || v === "lean") return v;
  return "";
}

// Fase 0.5 (2026-07-01): features com Δpnl < -30 no permutation importance ROI.
// Corta 40 features das 74 originais (22 neutras + 9 prejudiciais + 9 marginalíssimas).
const LEAN_FEATURES = new Set([
  "sp_rank",
  "sp_decimal",
  "is_outsider",
  "form_weighted_avg",
  "or_percentile_in_race",
  "trainer_recent_form",
  "recent_runs_90d",
  "or_diff_to_top",
  "is_favorite",
  "horse_weight_kg",
  "stronger_opponents_count",
  "run_style_mode_recent_5",
  "career_place_rate",
  "form_trend_score",
  "or_rank_in_race",
  "jockey_recent_form",
  "horse_age",
  "days_since_last_run",
  "distance_band_win_rate",
  "sp_implied_prob",
  "jockey_total_runs",
  "form_last_position",
  "or_advantage_score",
  "form_exponential_avg",
  "position_volatility",
  "worst_recent_position",
  "form_last5_avg",
  "career_wins",
  "form_consistency",
  "run_style_pct_early_recent_5",
  "class_win_rate",
  "career_win_rate",
  "jockey_trainer_combo_win_rate",
  "ts_avg_recent_5",
]);

function applyBaselineFilter(feats: string[]): string[] {
  const mode = getBaselineMode();
  if (mode === "sp_only") return ["sp_implied_prob"];
  if (mode === "no_market") return feats.filter((f) => !NO_MARKET_FEATURES.has(f));
  if (mode === "lean") return feats.filter((f) => LEAN_FEATURES.has(f));
  return feats;
}

const configGlobal = {
  patience: 20,
  maxEpochs: Number(process.env.MAX_EPOCHS || "150"),
  learningRate: 0.00005,
  batchSize: 32,

  // ── LR Scheduling (ReduceLROnPlateau) ──
  lrReduceAfter: 10,
  lrReduceFactor: 0.5,
  minLearningRate: 1e-6,
  maxLrReductions: 4,

  // ── Custom LAY Loss ──
  layLossAlpha: 0.3, // peso do LAY loss no total: L = ListMLE + α * L_lay
  layLossWarmup: 5, // épocas de warmup (só ListMLE) antes de ativar LAY loss

  // ── Multi-task Loss (Fase 1 do model improvement plan) ──
  // Se MULTITASK_MODE=1, modelo tem cabeça extra `lose_output` (sigmoid).
  // Loss total = ListMLE + α*L_lay + β*BCE_lose.
  // BCE calcula perdas por cavalo VS target invertido (1=perdeu, 0=venceu).
  multiTaskBeta: Number(process.env.MULTITASK_BETA || "0.5"),

  // ── Top-K ListMLE Loss ──
  // K=5 é o sweet spot empírico (Lan et al., Position-Aware ListMLE):
  // suficiente pra capturar informação dos top finishers sem gradient-vanishing
  // em fields de 20-30 corredores.
  listMLETopK: 5,
  // Sentinel usado nos dados pra DNF/PU/F (cavalos sem posição válida).
  // DNFs ficam no DENOMINADOR da loss (massa de probabilidade) mas não no
  // numerador (não tentamos prever sua ordem).
  dnfPositionSentinel: 99,
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

  const baselineMode = getBaselineMode();
  const experimentLabel = getExperimentLabel();
  const multiTaskEnabled = isMultiTask();
  const isolatedRun = Boolean(baselineMode || experimentLabel);
  if (baselineMode) {
    console.log(`🧪 BASELINE_MODE=${baselineMode} — save isolado, sem bump de versão prod\n`);
  }
  if (experimentLabel) {
    console.log(`🧪 EXPERIMENT_LABEL=${experimentLabel} — save isolado em baselines/${experimentLabel}_${modelType}\n`);
  }
  if (multiTaskEnabled) {
    console.log(
      `🎯 Multi-task ATIVO (default) — cabeça extra P(perder), β=${configGlobal.multiTaskBeta}\n`,
    );
  } else {
    console.log("⚠️  MULTITASK_MODE=0 — treino single-head LEGADO\n");
  }
  if (!isolatedRun) {
    console.log(
      `⚠️  SAVE EM PATH DE PROD (${modelPath}) — pra run isolado use EXPERIMENT_LABEL\n`,
    );
  }

  try {
    console.log("🔍 [STEP 1/7] Verificando modelo existente...");
    const existingConfig = isolatedRun
      ? null
      : await checkExistingModel(modelType);
    if (existingConfig) {
      console.log(`✅ Modelo existente — versão ${existingConfig.version}`);
    } else {
      console.log(
        isolatedRun
          ? "i  Run isolado (versão sempre 1)"
          : "i  Primeira versão do modelo race-level",
      );
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

    console.log("\n📐 Ajustando curva isotonic no val set...");
    const calibPairs = collectCalibrationPairs(
      model,
      trainingData.valX,
      trainingData.valY,
    );
    const isotonicCurve = fitIsotonic(calibPairs);
    console.log(
      `  ✅ Isotonic: ${calibPairs.length} pares → ${isotonicCurve.x.length} knots (range x=[${isotonicCurve.x[0]?.toFixed(4)}, ${isotonicCurve.x[isotonicCurve.x.length - 1]?.toFixed(4)}])`,
    );

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
        valBrier: history.valBrier,
        valEce: history.valEce,
        timestamp: new Date().toISOString(),
      },
      training: {
        epochs: history.epochs,
        batchSize: configGlobal.batchSize,
        learningRate: configGlobal.learningRate,
        samplesUsed: trainingData.sampleCount,
        classWeights: { 0: 1, 1: 1 },
      },
      optimalThreshold: 0.85,
      calibration: {
        method: "isotonic",
        knots: { x: isotonicCurve.x, y: isotonicCurve.y },
        fittedOn: calibPairs.length,
      },
    };

    console.log("\n💾 [STEP 6/7] Salvando modelo...");
    await saveModelToSupabase(model, config, modelType);
    console.log("✅ Modelo salvo");

    if (isolatedRun) {
      console.log(`\n📊 [STEP 7/7] Run isolado — pulando saveMetricsHistory`);
    } else {
      console.log("\n📊 [STEP 7/7] Salvando métricas...");
      await saveMetricsHistory(config, modelType);
    }

    console.log("\n🧹 Limpando recursos...");
    trainingData.trainX.dispose();
    trainingData.trainY.dispose();
    trainingData.trainFinishOrder.dispose();
    trainingData.trainValidRanks.dispose();
    trainingData.valX.dispose();
    trainingData.valY.dispose();
    trainingData.valFinishOrder.dispose();
    trainingData.valValidRanks.dispose();
    model.dispose();

    console.log(`\n✅ Treinamento ${typeConfig.label} completo!`);
    console.log(`📊 Versão: ${config.version}`);
    console.log(
      `📊 Top-1 acc treino: ${(config.metrics.trainAccuracy * 100).toFixed(2)}%`,
    );
    console.log(
      `📊 Top-1 acc validação: ${(config.metrics.valAccuracy * 100).toFixed(2)}%`,
    );
    if (config.metrics.valBrier !== undefined) {
      console.log(
        `📊 Brier validação: ${config.metrics.valBrier.toFixed(4)} (menor = melhor)`,
      );
    }
    if (config.metrics.valEce !== undefined) {
      console.log(
        `📊 ECE validação: ${(config.metrics.valEce * 100).toFixed(2)}% (menor = melhor)`,
      );
    }
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
    target: number;
    finishPosition: number; // 1=vencedor, 2,3,...=posição real, 99=DNF
  }>;
}

async function loadAndPrepareDataRaceLevel(modelType: ModelType) {
  const activeFeatures = applyBaselineFilter(selectedFeatures);
  const featureCount = activeFeatures.length;
  const typeConfig = MODEL_TYPE_CONFIG[modelType];
  const baselineMode = getBaselineMode();
  logMemory("INÍCIO");

  if (baselineMode) {
    console.log(
      `🧪 BASELINE_MODE=${baselineMode} ativo — usando ${featureCount} features: [${activeFeatures.join(", ")}]`,
    );
  }
  console.log(`📊 Carregando dados (${typeConfig.label})...`);

  const { count: totalCount, error: countError } = await supabase
    .schema("hml")
    .from("training_enriched_horse_features")
    .select("*", { count: "exact", head: true })
    .gte("quality_score", 0.7)
    .eq("model_version", "v5.0")
    .in("race_type", typeConfig.raceTypes);

  if (countError) throw new Error(`Count falhou: ${countError.message}`);
  if (!totalCount || totalCount === 0)
    throw new Error(`Sem dados para ${typeConfig.label}`);

  console.log(`📊 Total registros ${typeConfig.label}: ${totalCount}`);

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
        .select("features, target, finish_position, race_id, race_date")
        .gte("quality_score", 0.7)
        .eq("model_version", "v5.0")
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

      const vector = new Float32Array(featureCount);
      let isValid = true;

      for (let i = 0; i < featureCount; i++) {
        const featName = activeFeatures[i];
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
        finishPosition:
          record.finish_position ?? configGlobal.dnfPositionSentinel,
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

  validRaces.sort((a, b) => a.raceDate - b.raceDate);
  racesMap.clear();
  tryGC();

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

  console.log("🔢 Construindo tensores 3D...");

  const buildTensors = (races: RaceGroup[]) => {
    const numRaces = races.length;
    const xBuffer = new Float32Array(numRaces * MAX_HORSES * featureCount);
    const yBuffer = new Float32Array(numRaces * MAX_HORSES);
    // finishOrder[r, k] = índice do cavalo (na ordem original) que terminou em k-ésimo.
    // Pra slots de padding, usa identity (k) pra evitar valores inválidos no gather.
    const finishOrderBuffer = new Int32Array(numRaces * MAX_HORSES);
    // validRanks[r, k] = 1 se o k-ésimo rank é um finisher real dentro do top-K
    const validRanksBuffer = new Float32Array(numRaces * MAX_HORSES);

    const K = configGlobal.listMLETopK;
    const DNF = configGlobal.dnfPositionSentinel;

    for (let r = 0; r < numRaces; r++) {
      const race = races[r];
      const N = race.horses.length;

      // Features + target one-hot do vencedor (mantido pra top1 acc + LAY loss)
      for (let h = 0; h < MAX_HORSES; h++) {
        const yIdx = r * MAX_HORSES + h;
        if (h < N) {
          const horse = race.horses[h];
          const xOffset = (r * MAX_HORSES + h) * featureCount;
          for (let f = 0; f < featureCount; f++) {
            const normalized = (horse.features[f] - median[f]) / iqr[f];
            xBuffer[xOffset + f] = Math.max(-3, Math.min(3, normalized));
          }
          yBuffer[yIdx] = horse.target === 0 ? 1 : 0;
        } else {
          yBuffer[yIdx] = -1;
        }
      }

      // Ordenação por finish position (DNFs vão pro fim, ties mantêm ordem original)
      const horseIndices = race.horses.map((_, i) => i);
      horseIndices.sort((a, b) => {
        const posA = race.horses[a].finishPosition;
        const posB = race.horses[b].finishPosition;
        return posA - posB; // 1 vem primeiro, 99 (DNF) vai por último
      });

      // Quantos finishers reais existem (cap em K)
      const realFinishers = race.horses.filter(
        (h) => h.finishPosition < DNF,
      ).length;
      const K_eff = Math.min(K, realFinishers);

      for (let k = 0; k < MAX_HORSES; k++) {
        const idx = r * MAX_HORSES + k;
        if (k < N) {
          finishOrderBuffer[idx] = horseIndices[k];
        } else {
          // Padding: identity index. Mask vai zerar contribuição.
          finishOrderBuffer[idx] = k;
        }
        validRanksBuffer[idx] = k < K_eff ? 1 : 0;
      }
    }

    const x = tf.tensor3d(xBuffer, [numRaces, MAX_HORSES, featureCount]);
    const y = tf.tensor2d(yBuffer, [numRaces, MAX_HORSES]);
    const finishOrder = tf.tensor2d(
      finishOrderBuffer,
      [numRaces, MAX_HORSES],
      "int32",
    );
    const validRanks = tf.tensor2d(validRanksBuffer, [numRaces, MAX_HORSES]);
    return { x, y, finishOrder, validRanks };
  };

  const train = buildTensors(trainRaces);
  const val = buildTensors(valRaces);

  logMemory("APÓS_TENSORES");

  return {
    trainX: train.x,
    trainY: train.y,
    trainFinishOrder: train.finishOrder,
    trainValidRanks: train.validRanks,
    valX: val.x,
    valY: val.y,
    valFinishOrder: val.finishOrder,
    valValidRanks: val.validRanks,
    features: activeFeatures,
    featureCount,
    sampleCount: trainRaces.length,
    classWeights: { 0: 1, 1: 1 },
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
  // [v54] Pace / Run-Style features (Tier 1 #3, via rpscrape)
  "run_style_mode_recent_5",
  "run_style_pct_early_recent_5",
  "avg_ovr_btn_recent_5",
  "rpr_max_recent_5",
  "ts_avg_recent_5",
  "secs_per_furlong_avg_recent_5",
  "rpscrape_coverage_recent_5",
  "field_pace_pressure",
  "is_lone_speed",
  "field_count_E",
  "field_count_EP",
  "field_count_P",
  "field_count_S",
  "pace_match_score",
];

// ============================================================================
// CREATE MODEL
// ============================================================================

function createRaceLevelModel(inputDim: number): tf.LayersModel {
  return createAttentionModel({
    inputDim,
    maxHorses: MAX_HORSES,
    numHeads: 4,
    keyDim: 16,
    encoderDim: 64,
    dropoutRate: 0.2,
    l2Reg: 0.003,
    multiTask: isMultiTask(),
  });
}

/**
 * Extrai o output principal (score) do modelo, lidando com single-head e multi-head.
 * Multi-task: model.apply retorna [scoreOut, loseOut].
 * Single-task: retorna só scoreOut.
 */
function applyModelHeads(
  model: tf.LayersModel,
  inputs: [tf.Tensor, tf.Tensor],
  training = false,
): { score: tf.Tensor3D; lose: tf.Tensor3D | null } {
  const out = model.apply(inputs, { training }) as
    | tf.Tensor3D
    | [tf.Tensor3D, tf.Tensor3D];
  if (Array.isArray(out)) {
    return { score: out[0], lose: out[1] };
  }
  return { score: out, lose: null };
}

/**
 * BCE per-horse contra target invertido (1 = perdedor, 0 = vencedor).
 * Aplica mask pra ignorar padded positions.
 * @param loseLogits [B, M, 1] sigmoid output (já em [0,1])
 * @param batchY     [B, M] one-hot do vencedor (1=winner, 0=loser, -1=padding)
 */
function bceLoseLoss(
  loseSigmoid: tf.Tensor3D,
  batchY: tf.Tensor2D,
): tf.Scalar {
  return tf.tidy(() => {
    const lose2d = loseSigmoid.squeeze([2]) as tf.Tensor2D;
    const eps = 1e-7;
    const loseClipped = lose2d.clipByValue(eps, 1 - eps);
    const mask = batchY.greaterEqual(0).toFloat() as tf.Tensor2D;
    // target invertido: winner=0, loser=1, padding=irrelevante
    const targetLose = tf.onesLike(batchY).sub(batchY).mul(mask) as tf.Tensor2D;
    const bce = targetLose.mul(loseClipped.log()).add(
      tf.onesLike(targetLose)
        .sub(targetLose)
        .mul(tf.onesLike(loseClipped).sub(loseClipped).log()),
    ) as tf.Tensor2D;
    const maskedBce = bce.mul(mask).neg() as tf.Tensor2D;
    const totalMask = mask.sum() as tf.Scalar;
    return maskedBce.sum().div(totalMask.add(eps)) as tf.Scalar;
  });
}

// ============================================================================
// LOSS FUNCTIONS
// ============================================================================

/**
 * Computa softmax mascarado (probabilidades por corrida).
 * Slots de padding recebem -inf efetivo antes do softmax.
 */
function computeMaskedSoftmax(
  scores: tf.Tensor2D,
  mask: tf.Tensor2D,
): tf.Tensor2D {
  return tf.tidy(() => {
    const maskAdjustment = mask.sub(1).mul(1e9) as tf.Tensor2D;
    const maskedScores = scores.add(maskAdjustment) as tf.Tensor2D;
    return tf.keep(tf.softmax(maskedScores, -1) as tf.Tensor2D);
  });
}

/**
 * Masked softmax cross-entropy (winner-only).
 * Mantida pra validação (val_loss comparável entre versões do modelo).
 */
function maskedSoftmaxCrossEntropy(
  scores: tf.Tensor2D,
  targets: tf.Tensor2D,
): { loss: tf.Scalar; probs: tf.Tensor2D } {
  return tf.tidy(() => {
    const mask = targets.greaterEqual(0).toFloat() as tf.Tensor2D;
    const targetsClean = targets.maximum(0) as tf.Tensor2D;
    const maskAdjustment = mask.sub(1).mul(1e9) as tf.Tensor2D;
    const maskedScores = scores.add(maskAdjustment) as tf.Tensor2D;
    const probs = tf.softmax(maskedScores, -1) as tf.Tensor2D;
    const logProbs = tf.log(probs.add(1e-9));
    const losses = targetsClean.mul(logProbs).neg().sum(-1);
    const loss = losses.mean() as tf.Scalar;
    return { loss, probs: tf.keep(probs) };
  });
}

/**
 * Top-K Plackett-Luce / ListMLE Loss
 *
 * Para cada corrida, decompõe a ordem real de chegada numa cadeia de softmaxes:
 *   P(rank 1) · P(rank 2 | restantes) · ... · P(rank K | restantes)
 *
 * Onde P(rank k | restantes) = softmax(scores[restantes])[posição k]
 *
 * Densidade de supervisão é ~K× maior que CE-só-do-vencedor (5–10×
 * mais sinal por corrida pra K=5). DNFs ficam no DENOMINADOR (massa de
 * probabilidade) mas não no numerador (validRanks=0 pra eles).
 *
 * Referência: Xia et al. 2008 (ListMLE), Lan et al. (Position-Aware ListMLE).
 *
 * @param scores       [B, M] scores brutos do modelo (pré-softmax)
 * @param finishOrder  [B, M] int32: permutação dos índices por ordem de chegada
 * @param validRanks   [B, M] float32: 1 pros K primeiros finishers reais, 0 caso contrário
 * @param mask         [B, M] float32: 1 pra cavalo real, 0 pra padding
 * @param K            quantos top ranks usar (típico 5)
 */
function topKListMLELoss(
  scores: tf.Tensor2D,
  finishOrder: tf.Tensor2D,
  validRanks: tf.Tensor2D,
  mask: tf.Tensor2D,
  K: number,
): tf.Scalar {
  return tf.tidy(() => {
    // Reordena scores e mask pela ordem de chegada (batch-wise gather)
    const sortedScores = tf.gather(scores, finishOrder, 1, 1) as tf.Tensor2D;
    const sortedMask = tf.gather(mask, finishOrder, 1, 1) as tf.Tensor2D;

    const M_dim = scores.shape[1];

    const stepLosses: tf.Tensor1D[] = [];
    const stepWeights: tf.Tensor1D[] = [];

    for (let k = 0; k < K; k++) {
      // Posições >= k contribuem pro denominador (cadeia de explosion)
      const posMaskArr = new Float32Array(M_dim);
      for (let i = k; i < M_dim; i++) posMaskArr[i] = 1;
      const posMask = tf.tensor1d(posMaskArr);

      const denomMask = sortedMask.mul(posMask) as tf.Tensor2D;
      const adjusted = sortedScores.add(
        denomMask.sub(1).mul(1e9),
      ) as tf.Tensor2D;
      const logSumExp_k = tf.logSumExp(adjusted, -1) as tf.Tensor1D;

      const score_k = sortedScores
        .slice([0, k], [-1, 1])
        .squeeze([1]) as tf.Tensor1D;
      const valid_k = validRanks
        .slice([0, k], [-1, 1])
        .squeeze([1]) as tf.Tensor1D;

      // -(score_k - logSumExp_k) ponderado por valid_k
      const stepLoss = score_k.sub(logSumExp_k).neg().mul(valid_k);
      stepLosses.push(stepLoss as tf.Tensor1D);
      stepWeights.push(valid_k);
    }

    const stacked = tf.stack(stepLosses) as tf.Tensor2D; // [K, B]
    const stackedW = tf.stack(stepWeights) as tf.Tensor2D; // [K, B]

    const totalLoss = stacked.sum();
    const totalWeight = stackedW.sum().add(1e-9);

    return totalLoss.div(totalWeight) as tf.Scalar;
  });
}

/**
 * Top-1 accuracy
 */
function calculateTop1Accuracy(
  probs: tf.Tensor2D,
  targets: tf.Tensor2D,
): number {
  return tf.tidy(() => {
    const predictedWinner = probs.argMax(-1);
    const actualWinner = targets.argMax(-1);
    const correct = predictedWinner.equal(actualWinner).toFloat();
    const acc = correct.mean().dataSync()[0];
    return acc;
  });
}

/**
 * Brier score multi-classe (race-level).
 * Pra cada corrida: sum_h (probs[h] - target[h])^2 * mask[h]
 * Mediado por corrida.
 *
 * Diferente do val_loss (CE-só-do-vencedor), o Brier penaliza ALL horses
 * — recompensa um modelo cuja distribuição inteira está bem calibrada,
 * não só o pick top-1. Walsh & Joshi 2024 mostraram que seleção de modelo
 * por Brier supera seleção por acurácia em apostas (+34.7% ROI vs -35.2%).
 */
function calculateBrierScore(
  probs: tf.Tensor2D,
  targets: tf.Tensor2D,
): number {
  return tf.tidy(() => {
    const mask = targets.greaterEqual(0).toFloat() as tf.Tensor2D;
    const targetsClean = targets.maximum(0) as tf.Tensor2D;
    const diff = probs.sub(targetsClean) as tf.Tensor2D;
    const sqDiff = diff.mul(diff).mul(mask) as tf.Tensor2D;
    const perRace = sqDiff.sum(-1) as tf.Tensor1D; // [B]
    return perRace.mean().dataSync()[0];
  });
}

/**
 * Expected Calibration Error (ECE) top-1.
 * Bin pelo P(predicted winner) — confiança do top pick.
 * Em cada bin: |avg(confidence) - acc| ponderado por (n_bin / total).
 *
 * ECE alto → modelo over/underconfident.
 * Quando bin K=10 e ECE ~5%, predição está ~5pp off na média.
 */
function calculateECE(
  probs: tf.Tensor2D,
  targets: tf.Tensor2D,
  numBins = 10,
): number {
  return tf.tidy(() => {
    const predictedWinner = probs.argMax(-1) as tf.Tensor1D;
    const actualWinner = targets.argMax(-1) as tf.Tensor1D;
    const correct = predictedWinner.equal(actualWinner).toFloat() as tf.Tensor1D;
    const confidence = probs.max(-1) as tf.Tensor1D;

    const confArr = confidence.dataSync();
    const correctArr = correct.dataSync();
    const N = confArr.length;

    let ece = 0;
    for (let b = 0; b < numBins; b++) {
      const lo = b / numBins;
      const hi = (b + 1) / numBins;
      let binCount = 0;
      let confSum = 0;
      let accSum = 0;
      for (let i = 0; i < N; i++) {
        const c = confArr[i];
        // Último bin inclui upper edge
        const inBin = b === numBins - 1 ? c >= lo && c <= hi : c >= lo && c < hi;
        if (inBin) {
          binCount++;
          confSum += c;
          accSum += correctArr[i];
        }
      }
      if (binCount > 0) {
        const binConf = confSum / binCount;
        const binAcc = accSum / binCount;
        ece += (binCount / N) * Math.abs(binConf - binAcc);
      }
    }
    return ece;
  });
}

/**
 * Custom LAY Loss: penaliza quando o vencedor real tem baixo P(win).
 *
 * Contexto operacional: o sistema seleciona os 3 cavalos com MENOR P(win)
 * como candidatos a LAY. Se o vencedor está entre eles → RED (prejuízo).
 *
 * Implementação diferenciável via softmin:
 *   1. Cavalos com menor P(win) recebem maior peso de seleção (tau=0.1)
 *   2. layRisk = peso de seleção do vencedor real
 *   3. L_lay = -log(1 - layRisk) → penaliza quando LAY picks incluem vencedor
 *
 * Gradientes fluem por dois caminhos:
 *   - Via probs: modelo aprende a aumentar P(win) do vencedor real
 *   - Via seleção: modelo aprende a não colocar vencedores no bottom do ranking
 */
function laySelectionLoss(probs: tf.Tensor2D, targets: tf.Tensor2D): tf.Scalar {
  return tf.tidy(() => {
    const mask = targets.greaterEqual(0).toFloat() as tf.Tensor2D;
    const targetsClean = targets.maximum(0) as tf.Tensor2D;

    // Softmin: cavalos com menor P(win) recebem maior peso de seleção
    const tau = 0.1;
    const negProbs = probs.neg().div(tau);
    const maskedNeg = negProbs.add(mask.sub(1).mul(1e9)) as tf.Tensor2D;
    const selectionWeights = tf.softmax(maskedNeg, -1) as tf.Tensor2D;

    // layRisk = peso de seleção do vencedor real
    const layRisk = selectionWeights.mul(targetsClean).sum(-1) as tf.Tensor1D;

    // Clamp para evitar log(0)
    const clampedRisk = layRisk.minimum(0.999);

    // L_lay = -log(1 - layRisk)
    const losses = tf
      .scalar(1)
      .sub(clampedRisk)
      .add(1e-9)
      .log()
      .neg() as tf.Tensor1D;

    return losses.mean() as tf.Scalar;
  });
}

// ============================================================================
// TRAIN LOOP — ListMLE + LAY Loss + LR Scheduling
// ============================================================================

async function trainRaceLevelModel(model: tf.LayersModel, data: any) {
  let currentLr = configGlobal.learningRate;
  let optimizer = tf.train.adam(currentLr);
  const trainCount = data.trainX.shape[0];
  const valCount = data.valX.shape[0];

  let finalMetrics = {
    trainLoss: 0,
    trainAcc: 0,
    valLoss: 0,
    valAcc: 0,
    valBrier: 0,
    valEce: 0,
    epochs: 0,
  };
  // [v30] Seleção do melhor modelo agora é por val_brier (não val_loss).
  // Walsh & Joshi 2024: seleção por Brier ganhou +34.7% ROI vs -35.2% por acurácia.
  // Early stopping e LR scheduler continuam olhando val_loss (mais suave, menos
  // ruidoso pra critérios de plateau).
  let bestValBrier = Number.POSITIVE_INFINITY;
  let bestValLossForBest = Number.POSITIVE_INFINITY;
  let bestValAccForBest = 0;
  let bestValEceForBest = 0;
  let bestWeights: tf.Tensor[] | null = null;
  let earlyStopBestValLoss = Number.POSITIVE_INFINITY;
  let patienceCounter = 0;
  let actualEpochs = 0;

  // ── LR Scheduler state ──
  let lrBestValLoss = Number.POSITIVE_INFINITY;
  let lrPatienceCounter = 0;
  let lrReductions = 0;

  console.log(`  📋 ${trainCount} corridas treino, ${valCount} validação`);
  console.log(
    `  📋 Batch size: ${configGlobal.batchSize}, Max epochs: ${configGlobal.maxEpochs}`,
  );
  console.log(`  📋 LR inicial: ${currentLr}`);
  console.log(
    `  📋 LR scheduler: factor=${configGlobal.lrReduceFactor}, patience=${configGlobal.lrReduceAfter}, min=${configGlobal.minLearningRate}`,
  );
  console.log(
    `  📋 Loss principal: Top-${configGlobal.listMLETopK} ListMLE (Plackett-Luce)`,
  );
  console.log(
    `  📋 LAY loss α=${configGlobal.layLossAlpha}, warmup=${configGlobal.layLossWarmup} epochs`,
  );
  console.log("  🚀 Iniciando epochs...\n");

  for (let epoch = 0; epoch < configGlobal.maxEpochs; epoch++) {
    const indices = tf.util.createShuffledIndices(trainCount);
    const numBatches = Math.ceil(trainCount / configGlobal.batchSize);

    // [v28] LAY loss ativo após warmup
    const useLayLoss = epoch >= configGlobal.layLossWarmup;

    let epochLoss = 0;
    let epochCeLoss = 0;
    let epochLayLoss = 0;
    let epochBceLoseLoss = 0;
    let epochAccSum = 0;
    let epochAccCount = 0;

    for (let b = 0; b < numBatches; b++) {
      const start = b * configGlobal.batchSize;
      const end = Math.min(start + configGlobal.batchSize, trainCount);
      const batchIndices = Array.from(indices.slice(start, end));

      const batchX = tf.tidy(
        () => tf.gather(data.trainX, batchIndices) as tf.Tensor3D,
      );
      const batchY = tf.tidy(
        () => tf.gather(data.trainY, batchIndices) as tf.Tensor2D,
      );
      const batchFinishOrder = tf.tidy(
        () => tf.gather(data.trainFinishOrder, batchIndices) as tf.Tensor2D,
      );
      const batchValidRanks = tf.tidy(
        () => tf.gather(data.trainValidRanks, batchIndices) as tf.Tensor2D,
      );
      const batchMask = batchY.greaterEqual(0).toFloat() as tf.Tensor2D;

      let batchProbs: tf.Tensor2D | null = null;
      let batchCeLoss = 0;
      let batchLayLossVal = 0;
      let batchBceLoseVal = 0;
      const multiTaskEnabled = isMultiTask();

      const lossValue = optimizer.minimize(() => {
        const { score: scoresRaw, lose: loseRaw } = applyModelHeads(
          model,
          [batchX, batchMask],
          true,
        );
        const scores = scoresRaw.squeeze([2]) as tf.Tensor2D;

        // [v29] Top-K ListMLE substitui winner-only CE no treino
        const mainLoss = topKListMLELoss(
          scores,
          batchFinishOrder,
          batchValidRanks,
          batchMask,
          configGlobal.listMLETopK,
        );

        // Probs ainda são necessários pra LAY loss + top1 accuracy
        const probs = computeMaskedSoftmax(scores, batchMask);
        batchProbs = probs;

        let totalLoss = mainLoss;
        batchCeLoss = mainLoss.dataSync()[0];

        if (useLayLoss && configGlobal.layLossAlpha > 0) {
          const layLoss = laySelectionLoss(probs, batchY);
          batchLayLossVal = layLoss.dataSync()[0];
          totalLoss = totalLoss.add(
            layLoss.mul(configGlobal.layLossAlpha),
          ) as tf.Scalar;
        }

        // Multi-task: adiciona BCE contra P(perder)
        if (multiTaskEnabled && loseRaw && configGlobal.multiTaskBeta > 0) {
          const bceLose = bceLoseLoss(loseRaw, batchY);
          batchBceLoseVal = bceLose.dataSync()[0];
          totalLoss = totalLoss.add(
            bceLose.mul(configGlobal.multiTaskBeta),
          ) as tf.Scalar;
        }

        return totalLoss;
      }, true) as tf.Scalar;

      const totalLossVal = lossValue.dataSync()[0];
      epochLoss += totalLossVal;
      epochCeLoss += batchCeLoss;
      epochLayLoss += batchLayLossVal;
      epochBceLoseLoss += batchBceLoseVal;
      lossValue.dispose();

      if (batchProbs) {
        epochAccSum += calculateTop1Accuracy(batchProbs, batchY);
        epochAccCount++;
        (batchProbs as tf.Tensor2D).dispose();
      }

      batchX.dispose();
      batchY.dispose();
      batchFinishOrder.dispose();
      batchValidRanks.dispose();
      batchMask.dispose();
    }

    const trainLoss = epochLoss / numBatches;
    const trainCeLoss = epochCeLoss / numBatches;
    const trainLayLoss = epochLayLoss / numBatches;
    const trainBceLose = epochBceLoseLoss / numBatches;
    const trainAcc = epochAccCount > 0 ? epochAccSum / epochAccCount : 0;

    // Validação (sempre só CE — LAY loss é só pra treino)
    const { valLoss, valAcc, valBrier, valEce } = await evaluateModel(
      model,
      data.valX,
      data.valY,
    );

    finalMetrics = {
      trainLoss,
      trainAcc,
      valLoss,
      valAcc,
      valBrier,
      valEce,
      epochs: epoch + 1,
    };

    if (epoch % 5 === 0) {
      const valBlock =
        `val_loss=${valLoss.toFixed(4)}, val_brier=${valBrier.toFixed(4)}, ` +
        `val_ece=${(valEce * 100).toFixed(2)}%, val_top1=${(valAcc * 100).toFixed(1)}%`;
      const mtBlock = isMultiTask()
        ? `, BCE_lose=${trainBceLose.toFixed(4)}`
        : "";
      if (useLayLoss) {
        console.log(
          `  Epoch ${epoch}: loss=${trainLoss.toFixed(4)} | ListMLE=${trainCeLoss.toFixed(4)}, LAY=${trainLayLoss.toFixed(4)}${mtBlock}, top1=${(trainAcc * 100).toFixed(1)}%, ` +
            `${valBlock} | LR=${currentLr}`,
        );
      } else {
        console.log(
          `  Epoch ${epoch}: loss=${trainLoss.toFixed(4)} (ListMLE${mtBlock}), top1=${(trainAcc * 100).toFixed(1)}%, ` +
            `${valBlock} | LR=${currentLr}`,
        );
      }
      logMemory(`Epoch ${epoch}`);
    }

    // ── LR SCHEDULING: ReduceLROnPlateau ──
    if (valLoss < lrBestValLoss) {
      lrBestValLoss = valLoss;
      lrPatienceCounter = 0;
    } else {
      lrPatienceCounter++;
      if (
        lrPatienceCounter >= configGlobal.lrReduceAfter &&
        lrReductions < configGlobal.maxLrReductions &&
        currentLr > configGlobal.minLearningRate
      ) {
        const oldLr = currentLr;
        currentLr = Math.max(
          currentLr * configGlobal.lrReduceFactor,
          configGlobal.minLearningRate,
        );
        lrReductions++;
        lrPatienceCounter = 0;

        optimizer.dispose();
        optimizer = tf.train.adam(currentLr);

        console.log(
          `  📉 LR reduzido: ${oldLr} → ${currentLr} (redução #${lrReductions})`,
        );
      }
    }

    // ── BEST MODEL (val_brier) — Walsh & Joshi 2024 ──
    if (valBrier < bestValBrier) {
      bestValBrier = valBrier;
      bestValLossForBest = valLoss;
      bestValAccForBest = valAcc;
      bestValEceForBest = valEce;
      if (bestWeights) bestWeights.forEach((w) => w.dispose());
      bestWeights = model.getWeights().map((w) => w.clone());
      console.log(
        `  📈 Melhor val_brier - Epoch ${epoch}: brier=${valBrier.toFixed(4)} (val_loss=${valLoss.toFixed(4)}, val_top1=${(valAcc * 100).toFixed(1)}%, val_ece=${(valEce * 100).toFixed(2)}%)`,
      );
    }

    // ── EARLY STOPPING (continua em val_loss; mais estável) ──
    if (valLoss < earlyStopBestValLoss) {
      earlyStopBestValLoss = valLoss;
      patienceCounter = 0;
    } else {
      patienceCounter++;
      if (patienceCounter >= configGlobal.patience) {
        console.log(
          `  ⏹  Early stopping na época ${epoch} (LR reduções: ${lrReductions})`,
        );
        actualEpochs = epoch + 1;
        break;
      }
    }
    actualEpochs = epoch + 1;
  }

  if (bestWeights) {
    console.log("  ♻  Restaurando melhores pesos (critério val_brier)...");
    model.setWeights(bestWeights);
    const finalEval = await evaluateModel(model, data.valX, data.valY);
    finalMetrics.valLoss = finalEval.valLoss;
    finalMetrics.valAcc = finalEval.valAcc;
    finalMetrics.valBrier = finalEval.valBrier;
    finalMetrics.valEce = finalEval.valEce;
    finalMetrics.epochs = actualEpochs;
    bestWeights.forEach((w) => w.dispose());
  }

  optimizer.dispose();

  console.log(
    `\n  ✅ Finalizado em ${actualEpochs} épocas`,
  );
  console.log(
    `  📊 Best (val_brier): brier=${bestValBrier.toFixed(4)} | val_loss=${bestValLossForBest.toFixed(4)} | val_top1=${(bestValAccForBest * 100).toFixed(1)}% | val_ece=${(bestValEceForBest * 100).toFixed(2)}%`,
  );
  console.log(
    `  📉 LR: ${configGlobal.learningRate} → ${currentLr} (${lrReductions} reduções)`,
  );
  console.log(
    `  🎯 LAY loss ativo a partir da época ${configGlobal.layLossWarmup} com α=${configGlobal.layLossAlpha}`,
  );
  return finalMetrics;
}

// ============================================================================
// EVALUATE MODEL (validação — só CE, sem LAY loss)
// ============================================================================

async function evaluateModel(
  model: tf.LayersModel,
  valX: tf.Tensor,
  valY: tf.Tensor,
): Promise<{
  valLoss: number;
  valAcc: number;
  valBrier: number;
  valEce: number;
}> {
  return tf.tidy(() => {
    const valMask = (valY as tf.Tensor2D).greaterEqual(0).toFloat();
    const { score: scoresRaw } = applyModelHeads(model, [valX, valMask], false);
    const scores = scoresRaw.squeeze([2]) as tf.Tensor2D;
    const { loss, probs } = maskedSoftmaxCrossEntropy(
      scores,
      valY as tf.Tensor2D,
    );
    const valLoss = loss.dataSync()[0];
    const valAcc = calculateTop1Accuracy(probs, valY as tf.Tensor2D);
    const valBrier = calculateBrierScore(probs, valY as tf.Tensor2D);
    const valEce = calculateECE(probs, valY as tf.Tensor2D);
    (probs as tf.Tensor2D).dispose();
    return { valLoss, valAcc, valBrier, valEce };
  });
}

/**
 * Roda o modelo no val set e retorna pares (P(win) bruto, label 0/1) por cavalo válido.
 * Usado pra fitar a curva isotonic post-hoc.
 *
 * Slots de padding (target=-1) são descartados.
 */
function collectCalibrationPairs(
  model: tf.LayersModel,
  valX: tf.Tensor,
  valY: tf.Tensor,
): Array<{ x: number; y: number }> {
  const { probsArr, targetsArr } = tf.tidy(() => {
    const valMask = (valY as tf.Tensor2D).greaterEqual(0).toFloat();
    const { score: scoresRaw } = applyModelHeads(model, [valX, valMask], false);
    const scores = scoresRaw.squeeze([2]) as tf.Tensor2D;
    const mask = (valY as tf.Tensor2D).greaterEqual(0).toFloat() as tf.Tensor2D;
    const maskAdjustment = mask.sub(1).mul(1e9) as tf.Tensor2D;
    const maskedScores = scores.add(maskAdjustment) as tf.Tensor2D;
    const probs = tf.softmax(maskedScores, -1) as tf.Tensor2D;
    return {
      probsArr: probs.dataSync(),
      targetsArr: (valY as tf.Tensor2D).dataSync(),
    };
  });

  const pairs: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < targetsArr.length; i++) {
    const t = targetsArr[i];
    if (t < 0) continue; // padding
    pairs.push({ x: probsArr[i], y: t });
  }
  return pairs;
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
