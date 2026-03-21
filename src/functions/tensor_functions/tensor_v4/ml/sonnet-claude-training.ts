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
  const maxAttempts = 3;

  while (currentPage * pageSize < (totalCount || 0)) {
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
        .order("race_date", { ascending: true })
        .range(from, to);

      if (error) {
        if (error.code === "57014") {
          attempts++;
          console.warn(
            `! Timeout na página ${currentPage + 1}, tentativa ${attempts}/${maxAttempts}...`,
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
      console.error(
        `❌ Falha ao carregar página ${currentPage + 1} após ${maxAttempts} tentativas`,
      );
      break;
    }

    allData.push(...pageData);
    currentPage++;
    console.log(`📥 Carregadas ${allData.length}/${totalCount} amostras...`);
  }

  if (allData.length === 0) throw new Error("Sem dados de treinamento");
  console.log(
    `✅ ${allData.length} amostras carregadas (quality_score >= 0.7)`,
  );

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

  const trainX = tf.tensor2d(trainFeatures);
  const trainY = tf.tensor2d(trainTargets, [trainTargets.length, 1]);
  const valX = tf.tensor2d(valFeatures);
  const valY = tf.tensor2d(valTargets, [valTargets.length, 1]);

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
 * Normalização robusta com quantiles implementados manualmente
 */
function robustNormalize(trainX: tf.Tensor2D, valX: tf.Tensor2D) {
  console.log("    🔄 Convertendo tensors para arrays...");
  // Converter para array para calcular quantiles
  const trainData = trainX.arraySync() as number[][];
  const valData = valX.arraySync() as number[][];

  console.log("    📊 Calculando quantiles...");
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

  console.log("    📏 Calculando IQR...");
  // Calcular IQR (Interquartile Range)
  const iqr = q75.map((v, i) => {
    const range = v - q25[i];
    return range > 0 ? range : 1; // Evitar divisão por zero
  });

  console.log("    🔄 Normalizando dados...");
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

  console.log("    🔢 Convertendo de volta para tensors...");
  // Converter de volta para tensors
  const normalizedTrainX = tf.tensor2d(normalizedTrain);
  const normalizedValX = tf.tensor2d(normalizedVal);

  console.log("    📊 Calculando mean e std...");
  // Calcular mean e std também (para compatibilidade)
  const { mean, variance } = tf.moments(trainX, 0);
  const std = variance.sqrt().add(1e-7);

  // Cleanup tensors temporários
  variance.dispose();

  console.log("    ✅ Normalização concluída");

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

      // Log a cada 10 épocas
      if (epoch % 10 === 0) {
        console.log(
          `  Epoch ${epoch}: loss=${trainLoss.toFixed(4)}, ` +
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
  } catch (error) {
    console.error("\n  ❌ ERRO ao salvar modelo:");
    console.error("  Erro:", error);
    throw error;
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
