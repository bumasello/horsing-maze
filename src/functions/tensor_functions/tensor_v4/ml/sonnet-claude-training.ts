// features_v4/ml/training_final.ts

import * as tf from "@tensorflow/tfjs-node";
import { supabase } from "../../../..";

// Configuração do modelo
const MODEL_NAME = "claude-ml-model";
const BUCKET_NAME = "modelos-tfjs-publicos";
const MODEL_PATH = `horse_probability_model/${MODEL_NAME}`;

const configGlobal = {
  patience: 25,
  maxEpochs: 150,
  learningRate: 0.0005,
  batchSize: 32,
};

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
    console.log("🔍 [STEP 1/7] Verificando modelo existente...");
    const existingConfig = await checkExistingModel();
    if (existingConfig) {
      console.log(
        `✅ Modelo existente encontrado (versão ${existingConfig.version})`,
      );
    } else {
      console.log("i  Nenhum modelo existente encontrado. Criando versão 1.");
    }

    // 2. Carregar e preparar dados
    console.log("\n📊 [STEP 2/7] Carregando e preparando dados...");
    const trainingData = await loadAndPrepareData();
    console.log("✅ Dados carregados e preparados com sucesso");

    // 3. Criar ou atualizar modelo
    console.log("\n🏗  [STEP 3/7] Criando arquitetura do modelo...");
    const model = createModel(trainingData.featureCount);
    console.log("✅ Modelo criado com sucesso");

    // 4. Treinar
    console.log("\n🏋  [STEP 4/7] Iniciando treinamento...");
    const history = await trainModel(model, trainingData);
    console.log("✅ Treinamento concluído");

    // 4.5 Cabilbrar threshold
    console.log("\n🎯 [STEP 4.5/7] Calibrando threshold...");
    const optimalThreshold = await calibrateThreshold(
      model,
      trainingData.valX,
      trainingData.valY,
    );
    console.log(`✅ Threshold calibrado: ${optimalThreshold.toFixed(2)}`);

    // 5. Preparar configuração
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
      optimalThreshold: optimalThreshold,
    };
    console.log("✅ Configuração preparada");

    // 6. Salvar no Supabase (substituindo anterior)
    console.log("\n💾 [STEP 6/7] Salvando modelo no Supabase...");
    await saveModelToSupabase(model, config);
    console.log("✅ Modelo salvo");

    // 7. Salvar histórico de métricas
    console.log("\n📊 [STEP 7/7] Salvando histórico de métricas...");
    await saveMetricsHistory(config);
    console.log("✅ Histórico salvo");

    // 8. Cleanup
    console.log("\n🧹 Limpando recursos...");
    trainingData.trainX.dispose();
    trainingData.trainY.dispose();
    trainingData.valX.dispose();
    trainingData.valY.dispose();
    model.dispose();
    console.log("✅ Recursos liberados");

    console.log("\n✅ Treinamento completo!");
    console.log(`📊 Versão: ${config.version}`);
    console.log(
      `📊 Acurácia Treino: ${(config.metrics.trainAccuracy * 100).toFixed(2)}%`,
    );
    console.log(
      `📊 Acurácia Validação: ${(config.metrics.valAccuracy * 100).toFixed(2)}%`,
    );
  } catch (error) {
    console.error("\n❌ Erro no treinamento:");
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

/**
 * Verificar modelo existente
 */
async function checkExistingModel(): Promise<ModelConfig | null> {
  try {
    console.log(
      `  🔍 Buscando config em: ${BUCKET_NAME}/${MODEL_PATH}/config.json`,
    );

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(`${MODEL_PATH}/config.json`);

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
// UTILITÁRIOS DE MEMÓRIA (NOVO)
// ============================================================================

/**
 * Tenta forçar GC quando disponível (Node com --expose-gc)
 */
function tryGC(): void {
  if (global.gc) {
    global.gc();
  }
}

/**
 * Log de memória para diagnóstico
 */
function logMemory(label: string): void {
  const mem = process.memoryUsage();
  console.log(
    `  📊 [MEM ${label}] RSS: ${(mem.rss / 1024 / 1024).toFixed(0)}MB | ` +
      `Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(0)}/${(mem.heapTotal / 1024 / 1024).toFixed(0)}MB`,
  );
}

// ============================================================================
// loadAndPrepareData — REESCRITO PARA ELIMINAR OOM
// ============================================================================
//
// PROBLEMA ORIGINAL (6 cópias dos dados em memória):
//   1. JSON bruto do Supabase (pageData)
//   2. allVectors[] — array de objetos { date, vector, target }
//   3. trainFeatures/valFeatures — .map(r => r.vector)
//   4. tf.tensor2d(trainFeatures) — tensor bruto
//   5. robustNormalize: trainX.arraySync() — tensor → JS array de volta
//   6. normalizedTrain[] + tf.tensor2d(normalizedTrain) — array + tensor final
//   Pico: ~1.1GB para 95k registros × 59 features → OOM
//
// SOLUÇÃO (máximo 2 cópias):
//   1. Float32Array pré-alocado (buffer compacto, ~22MB para 95k × 59)
//   2. Normalização in-place nos buffers (sem criar arrays intermediários)
//   3. tf.tensor2d(Float32Array) — tensor final (aceita typed array direto)
//   Pico estimado: ~200-300MB
//
// INTERFACE DE RETORNO: idêntica à versão anterior — nada mais muda no código.
// ============================================================================

async function loadAndPrepareData() {
  const featureCount = selectedFeatures.length;
  logMemory("INÍCIO");

  // ─── FASE 1: Contar registros ───
  console.log("📊 Carregando dados de treinamento...");

  const { count: totalCount, error: countError } = await supabase
    .schema("hml")
    .from("training_enriched_horse_features")
    .select("*", { count: "exact", head: true })
    .gte("quality_score", 0.7);

  if (countError) throw countError;
  if (!totalCount || totalCount === 0)
    throw new Error("Sem dados de treinamento");
  console.log(`📊 Total de registros disponíveis: ${totalCount}`);

  // ─── FASE 2: Streaming → Float32Array ───
  // Em vez de acumular objetos JS { date, vector, target },
  // usamos arrays tipados paralelos: compactos e sem overhead de objetos.
  //   - vectors:    Float32Array plano (N × featureCount) — ~22MB para 95k × 59
  //   - targets:    Uint8Array (N) — target é 0 ou 1, 1 byte cada
  //   - dateEpochs: Float64Array (N) — epoch em ms para split temporal

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

    // Retry com backoff para timeout 57014
    while (attempts < maxAttempts) {
      const { data, error } = await supabase
        .schema("hml")
        .from("training_enriched_horse_features")
        .select("features, target, quality_score, race_date")
        .gte("quality_score", 0.7)
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

    // Extrair vetores DIRETO para os buffers tipados
    for (const record of pageData) {
      const features = record.features;
      if (!features) continue;

      // SP null = registro inválido (regra do projeto)
      if (
        features["sp_decimal"] === null ||
        features["sp_decimal"] === undefined
      ) {
        continue;
      }

      // Expandir buffers se necessário
      if (validCount >= capacity) {
        capacity = Math.floor(capacity * 1.5);
        console.log(`  📦 Expandindo buffers para ${capacity}...`);

        const newVectors = new Float32Array(capacity * featureCount);
        newVectors.set(vectors);
        vectors = newVectors;

        const newTargets = new Uint8Array(capacity);
        newTargets.set(targets);
        targets = newTargets;

        const newDateEpochs = new Float64Array(capacity);
        newDateEpochs.set(dateEpochs);
        dateEpochs = newDateEpochs;
      }

      // Extrair vetor de features direto no buffer
      const offset = validCount * featureCount;
      let isValid = true;

      for (let i = 0; i < featureCount; i++) {
        const featName = selectedFeatures[i];
        let value = features[featName];

        // SP null = inválido
        if (
          (featName === "sp_decimal" || featName === "sp_implied_prob") &&
          (value === null || value === undefined)
        ) {
          isValid = false;
          break;
        }

        // Imputação: null → 0 (regra do projeto)
        if (value === null || value === undefined) value = 0;

        vectors[offset + i] = Number(value);
      }

      if (!isValid) continue;

      targets[validCount] = record.target ?? 0;
      dateEpochs[validCount] = new Date(record.race_date).getTime();
      validCount++;
    }

    // CRÍTICO: permitir GC coletar o JSON bruto desta página
    pageData = null;

    currentPage++;
    if (currentPage % 10 === 0 || currentPage * pageSize >= totalCount) {
      console.log(
        `📥 Processadas ${Math.min(currentPage * pageSize, totalCount)}/${totalCount}, ${validCount} válidas...`,
      );
    }
  }

  if (validCount === 0) throw new Error("Sem dados de treinamento válidos");
  console.log(`✅ ${validCount} amostras válidas extraídas`);
  logMemory("APÓS_STREAMING");
  tryGC();

  // Trim para tamanho exato (libera memória não usada)
  vectors = vectors.slice(0, validCount * featureCount);
  targets = targets.slice(0, validCount);
  dateEpochs = dateEpochs.slice(0, validCount);

  // ─── FASE 3: Split temporal direto nos buffers ───

  console.log("📅 Calculando split temporal...");

  // Encontrar datas únicas e split point (80/20)
  const uniqueEpochs = [...new Set(dateEpochs)].sort((a, b) => a - b);
  const splitIdx = Math.floor(uniqueEpochs.length * 0.8);
  const splitEpoch = uniqueEpochs[splitIdx];
  const splitDate = new Date(splitEpoch).toISOString().split("T")[0];

  // Contar treino vs validação
  let trainCount = 0;
  for (let i = 0; i < validCount; i++) {
    if (dateEpochs[i] < splitEpoch) trainCount++;
  }
  const valCount = validCount - trainCount;

  console.log(`📅 Split temporal: treino até ${splitDate}`);
  console.log(`📊 Treino: ${trainCount} | Validação: ${valCount}`);

  // Preencher buffers separados train/val
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

  // Liberar buffers originais — não precisamos mais
  // @ts-ignore — atribuir null para permitir GC
  vectors = null as any;
  // @ts-ignore
  targets = null as any;
  // @ts-ignore
  dateEpochs = null as any;
  tryGC();
  logMemory("APÓS_SPLIT");

  // ─── FASE 4: Normalização robusta IN-PLACE nos buffers ───
  // (substitui a função robustNormalize que foi removida)
  //
  // Antes: criava 4 cópias extras (arraySync → arrays JS → arrays normalizados → tensores)
  // Agora: computa quantiles direto nos Float32Array e normaliza in-place

  console.log("📏 Calculando normalização robusta...");

  const median: number[] = new Array(featureCount);
  const iqr: number[] = new Array(featureCount);
  const mean: number[] = new Array(featureCount);
  const std: number[] = new Array(featureCount);

  // Buffer reutilizável para extrair/ordenar cada coluna
  const columnBuffer = new Float32Array(trainCount);

  for (let col = 0; col < featureCount; col++) {
    // Extrair coluna do buffer plano
    for (let row = 0; row < trainCount; row++) {
      columnBuffer[row] = trainVectors[row * featureCount + col];
    }

    // Ordenar para calcular quantiles
    const sorted = columnBuffer.slice().sort();

    const idx25 = Math.floor(trainCount * 0.25);
    const idx50 = Math.floor(trainCount * 0.5);
    const idx75 = Math.floor(trainCount * 0.75);

    median[col] = sorted[idx50];
    const rawIqr = sorted[idx75] - sorted[idx25];
    iqr[col] = rawIqr > 0 ? rawIqr : 1; // Evitar divisão por zero

    // Calcular mean e std para compatibilidade com config
    let sum = 0;
    for (let row = 0; row < trainCount; row++) {
      sum += columnBuffer[row];
    }
    mean[col] = sum / trainCount;

    let sumSqDiff = 0;
    for (let row = 0; row < trainCount; row++) {
      const diff = columnBuffer[row] - mean[col];
      sumSqDiff += diff * diff;
    }
    std[col] = Math.sqrt(sumSqDiff / trainCount) + 1e-7;
  }

  console.log("📏 Aplicando normalização in-place...");

  // Normalizar treino in-place (zero alocação extra)
  for (let row = 0; row < trainCount; row++) {
    for (let col = 0; col < featureCount; col++) {
      const idx = row * featureCount + col;
      const normalized = (trainVectors[idx] - median[col]) / iqr[col];
      trainVectors[idx] = Math.max(-3, Math.min(3, normalized)); // Clipping ±3
    }
  }

  // Normalizar validação in-place (usando parâmetros do TREINO — regra do projeto)
  for (let row = 0; row < valCount; row++) {
    for (let col = 0; col < featureCount; col++) {
      const idx = row * featureCount + col;
      const normalized = (valVectors[idx] - median[col]) / iqr[col];
      valVectors[idx] = Math.max(-3, Math.min(3, normalized)); // Clipping ±3
    }
  }

  logMemory("APÓS_NORMALIZAÇÃO");

  // ─── FASE 5: Criar tensores UMA vez (já normalizados) ───

  console.log("🔢 Criando tensores finais...");

  const trainX = tf.tensor2d(trainVectors, [trainCount, featureCount]);
  const trainY = tf.tensor2d(trainTargets, [trainCount, 1]);
  const valX = tf.tensor2d(valVectors, [valCount, featureCount]);
  const valY = tf.tensor2d(valTargets, [valCount, 1]);

  // Class weights (calculado nos buffers, sem criar arrays extras)
  let class0 = 0;
  let class1 = 0;
  for (let i = 0; i < trainCount; i++) {
    if (trainTargets[i] === 0) class0++;
    else class1++;
  }
  for (let i = 0; i < valCount; i++) {
    if (valTargets[i] === 0) class0++;
    else class1++;
  }
  const total = class0 + class1;
  const classWeights: { [key: number]: number } = {
    0: total / (2 * class0),
    1: total / (2 * class1),
  };

  console.log(
    `⚖ Pesos de classe: 0=${classWeights[0]?.toFixed(2)}, 1=${classWeights[1]?.toFixed(2)}`,
  );
  logMemory("FINAL");

  // Retorno com MESMA interface da versão anterior
  return {
    trainX,
    trainY,
    valX,
    valY,
    features: selectedFeatures,
    featureCount: selectedFeatures.length,
    sampleCount: trainCount,
    classWeights,
    normalization: {
      mean,
      std,
      median,
      iqr,
    },
  };
}

// ============================================================================
// TUDO ABAIXO É IDÊNTICO AO ORIGINAL
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
];

// NOTA: robustNormalize foi REMOVIDA — a lógica está incorporada
// na Fase 4 de loadAndPrepareData acima.

/**
 * Criar modelo
 */
function createModel(inputDim: number): tf.LayersModel {
  console.log(`  🏗  Criando modelo com ${inputDim} features de entrada...`);

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

  console.log("  ⚙  Compilando modelo...");
  model.compile({
    optimizer: tf.train.adam(0.0005),
    loss: "binaryCrossentropy",
    metrics: ["accuracy"],
  });

  console.log("  ✅ Modelo criado e compilado");
  model.summary();

  return model;
}

/**
 * Treinar modelo com Early Stopping manual
 */
async function trainModel(model: tf.LayersModel, data: any) {
  console.log("  🏋  Configurando treinamento...");

  let finalMetrics = {
    trainLoss: 0,
    trainAcc: 0,
    valLoss: 0,
    valAcc: 0,
    epochs: 0,
  };

  // Variáveis para Early Stopping manual
  let bestValLoss = Number.POSITIVE_INFINITY;
  let bestWeights: tf.Tensor[] | null = null;
  let patienceCounter = 0;
  let actualEpochs = 0;

  console.log("  📋 Configuração:");
  console.log(`   - Max épocas: ${configGlobal.maxEpochs}`);
  console.log(`   - Patience: ${configGlobal.patience}`);
  console.log("    - Batch size: 32");
  console.log(`    - Learning rate: ${configGlobal.learningRate}`);
  console.log("  🚀 Iniciando epochs...\n");

  try {
    // Treinar época por época para implementar Early Stopping manual
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

      // Atualizar métricas finais
      finalMetrics = {
        trainLoss,
        trainAcc,
        valLoss,
        valAcc,
        epochs: epoch + 1,
      };

      // Log a cada 10 épocas (com memória para monitorar)
      if (epoch % 10 === 0) {
        console.log(
          `  Epoch ${epoch}: loss=${trainLoss.toFixed(4)}, ` +
            `acc=${trainAcc.toFixed(4)}, ` +
            `val_loss=${valLoss.toFixed(4)}, ` +
            `val_acc=${valAcc.toFixed(4)}`,
        );
        logMemory(`Epoch ${epoch}`);
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
          `  📈 Melhor modelo encontrado - Epoch ${epoch}: val_loss=${valLoss.toFixed(4)}`,
        );
      } else {
        patienceCounter++;

        // Parar se patience excedido
        if (patienceCounter >= configGlobal.patience) {
          console.log(
            `  ⏹  Early stopping ativado na época ${epoch} (patience=${configGlobal.patience})`,
          );
          actualEpochs = epoch + 1;
          break;
        }
      }

      actualEpochs = epoch + 1;
    }

    // Restaurar melhores pesos
    if (bestWeights !== null) {
      console.log("  ♻  Restaurando melhores pesos do modelo...");
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

    console.log(`\n  ✅ Treinamento finalizado em ${actualEpochs} épocas`);
    console.log(`  📊 Melhor val_loss: ${bestValLoss.toFixed(4)}`);

    return finalMetrics;
  } catch (error) {
    console.error("\n  ❌ ERRO durante treinamento:");
    console.error("  Erro:", error);
    throw error;
  }
}

/**
 * Salvar modelo no Supabase (substitui anterior)
 */
async function saveModelToSupabase(model: tf.LayersModel, config: ModelConfig) {
  const maxRetries = 3;
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      console.log("  💾 Preparando para salvar modelo...");

      // Salvar temporariamente
      const tempPath = `/tmp/model_${Date.now()}`;
      console.log(`  📁 Salvando temporariamente em: ${tempPath}`);

      await model.save(`file://${tempPath}`);
      console.log("  ✅ Modelo salvo localmente");

      const fs = require("fs");
      console.log("  📖 Lendo arquivos...");
      const modelJson = fs.readFileSync(`${tempPath}/model.json`);
      const modelWeights = fs.readFileSync(`${tempPath}/weights.bin`);
      console.log(
        `  ✅ Arquivos lidos (JSON: ${modelJson.length} bytes, Weights: ${modelWeights.length} bytes)`,
      );

      // Upload (upsert substitui arquivo existente)
      console.log("  ☁  Fazendo upload para Supabase...");

      console.log("    📤 Uploading model.json...");
      const { error: jsonError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(`${MODEL_PATH}/model.json`, modelJson, {
          contentType: "application/json",
          upsert: true,
        });

      if (jsonError) {
        throw new Error(
          `Erro ao fazer upload de model.json: ${jsonError.message}`,
        );
      }
      console.log("    ✅ model.json enviado");

      console.log("    📤 Uploading weights.bin...");
      const { error: weightsError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(`${MODEL_PATH}/weights.bin`, modelWeights, {
          contentType: "application/octet-stream",
          upsert: true,
        });

      if (weightsError) {
        throw new Error(
          `Erro ao fazer upload de weights.bin: ${weightsError.message}`,
        );
      }
      console.log("    ✅ weights.bin enviado");

      console.log("    📤 Uploading config.json...");
      const { error: configError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(`${MODEL_PATH}/config.json`, JSON.stringify(config, null, 2), {
          contentType: "application/json",
          upsert: true,
        });

      if (configError) {
        throw new Error(
          `Erro ao fazer upload de config.json: ${configError.message}`,
        );
      }
      console.log("    ✅ config.json enviado");

      // Limpar temporários
      console.log("  🧹 Limpando arquivos temporários...");
      fs.unlinkSync(`${tempPath}/model.json`);
      fs.unlinkSync(`${tempPath}/weights.bin`);
      console.log("  ✅ Arquivos temporários removidos");

      console.log("  ✅ Modelo salvo com sucesso no Supabase!");
      return;
    } catch (error) {
      attempts++;
      console.warn(
        `! Erro ao salvar modelo, tentativa ${attempts}/${maxRetries}:`,
        error,
      );
      if (attempts < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 5000 * attempts));
      } else {
        throw error;
      }
    }
  }
}

/**
 * Salvar histórico de métricas (para acompanhar evolução)
 */
async function saveMetricsHistory(config: ModelConfig) {
  try {
    console.log("  📊 Preparando dados de métricas...");

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

    console.log("  💾 Salvando no banco de dados...");
    console.log("  📋 Dados a serem salvos:", JSON.stringify(history, null, 2));

    const { data, error } = await supabase
      .schema("hml")
      .from("model_metrics_history")
      .insert(history)
      .select();

    if (error) {
      console.error(
        "  ❌ Erro retornado pelo Supabase:",
        JSON.stringify(error, null, 2),
      );
      throw new Error(
        `Erro ao salvar métricas: ${error.message || error.code || JSON.stringify(error)}`,
      );
    }

    console.log("  ✅ Métricas salvas com sucesso");
    console.log("  📊 Registro inserido:", data);
  } catch (error) {
    console.error("\n  ❌ ERRO ao salvar métricas:");
    console.error("  Tipo:", typeof error);
    console.error("  Erro completo:", error);

    if (error instanceof Error) {
      console.error("  Mensagem:", error.message);
      console.error("  Stack:", error.stack);
    }

    // Não falhar o processo inteiro se apenas salvar métricas falhou
    console.log("  !  Continuando apesar do erro ao salvar métricas...");
  }
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

  // Testar thresholds de 0.50 a 0.99 em steps de 0.01
  const thresholds = Array.from({ length: 50 }, (_, i) => 0.5 + i * 0.01);

  let bestThreshold = 0.85;
  let bestF1 = 0;

  console.log("\n  Threshold | Precision | Recall | F1     | LAY%");
  console.log("  " + "-".repeat(52));

  for (const threshold of thresholds) {
    let tp = 0; // predito LAY (1), real LAY (1)
    let fp = 0; // predito LAY (1), real vencedor (0)
    let fn = 0; // predito não-LAY (0), real LAY (1)

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
        ? (2 * (precision * recall)) / (precision + recall)
        : 0;
    const layPct = (((tp + fp) / probs.length) * 100).toFixed(1);

    // Log a cada 0.05 para não poluir o console
    if (Math.round(threshold * 100) % 5 === 0) {
      console.log(
        `  ${threshold.toFixed(2)}      | ${(precision * 100).toFixed(1)}%     | ${(recall * 100).toFixed(1)}%  | ${f1.toFixed(4)} | ${layPct}%`,
      );
    }

    // Critério: maximizar F1 com Precision >= 0.92
    // Para LAY betting, falsos positivos (apostar contra vencedor) são caros
    const layPctValue = ((tp + fp) / probs.length) * 100;
    if (
      precision >= 0.95 &&
      layPctValue >= 15 &&
      layPctValue <= 30 &&
      f1 > bestF1
    ) {
      bestF1 = f1;
      bestThreshold = threshold;
    }
  }

  console.log(`\n  ✅ Threshold ótimo: ${bestThreshold.toFixed(2)}`);
  console.log(`  📊 F1 no threshold ótimo: ${bestF1.toFixed(4)}`);

  return bestThreshold;
}
