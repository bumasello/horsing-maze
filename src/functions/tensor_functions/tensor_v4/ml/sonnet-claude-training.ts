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
        batchSize: 32,
        learningRate: 0.001,
        samplesUsed: trainingData.sampleCount,
        classWeights: trainingData.classWeights,
      },
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
  console.log("  📊 Iniciando carregamento de dados...");

  try {
    // Primeiro, testar conexão básica com a tabela
    console.log("  🔌 Testando conexão com a tabela...");
    const { data: testData, error: testError } = await supabase
      .schema("hml")
      .from("training_enriched_horse_features")
      .select("*")
      .limit(1);

    if (testError) {
      console.error(
        "  ❌ Erro ao testar conexão:",
        JSON.stringify(testError, null, 2),
      );
      throw new Error(
        `Erro de conexão com tabela: ${testError.message || JSON.stringify(testError)}`,
      );
    }
    console.log("  ✅ Conexão com tabela OK");

    // Contar total de registros disponíveis
    console.log("  🔢 Contando registros disponíveis...");
    let totalCount: number | null = null;

    const { count, error: countError } = await supabase
      .schema("hml")
      .from("training_enriched_horse_features")
      .select("*", { count: "exact", head: true })
      .gte("quality_score", 0.7);

    if (countError) {
      console.log(
        "  !  Erro ao contar (será ignorado, continuando sem contagem):",
      );
      console.log("  ", JSON.stringify(countError, null, 2));
      totalCount = null;
    } else {
      totalCount = count;
      console.log(`  ✅ Total de registros disponíveis: ${totalCount}`);
    }

    // Se não conseguiu contar, carrega sem saber o total
    const useAlternativeLoading = !totalCount || totalCount === 0;

    if (useAlternativeLoading) {
      console.log(
        "  i  Prosseguindo sem contagem total (carregamento dinâmico)",
      );
    }

    // Carregar dados com paginação
    console.log("  📥 Carregando dados com paginação...");
    const allData: any[] = [];
    const pageSize = 1000;
    let currentPage = 0;
    let hasMoreData = true;

    if (useAlternativeLoading) {
      console.log("  !  Usando método alternativo (sem contagem total)");
    }

    while (hasMoreData) {
      const from = currentPage * pageSize;
      const to = from + pageSize - 1;

      console.log(
        `  📄 Carregando página ${currentPage + 1} (${from}-${to})...`,
      );

      const { data: pageData, error } = await supabase
        .schema("hml")
        .from("training_enriched_horse_features")
        .select("features, target, quality_score")
        .gte("quality_score", 0.7)
        .order("generated_at", { ascending: true })
        .range(from, to);

      if (error) {
        console.error(
          "  ❌ Erro ao carregar página:",
          JSON.stringify(error, null, 2),
        );
        throw new Error(
          `Erro ao carregar dados: ${error.message || JSON.stringify(error)}`,
        );
      }

      if (!pageData || pageData.length === 0) {
        console.log(`  ✅ Fim dos dados na página ${currentPage + 1}`);
        hasMoreData = false;
        break;
      }

      allData.push(...pageData);
      currentPage++;

      const progress = totalCount
        ? `${allData.length}/${totalCount}`
        : `${allData.length}`;
      console.log(`  📥 Progresso: ${progress} amostras carregadas`);

      // Parar se não houver contagem total e carregou menos que pageSize (última página)
      if (useAlternativeLoading && pageData.length < pageSize) {
        console.log(
          `  ✅ Última página detectada (${pageData.length} < ${pageSize})`,
        );
        hasMoreData = false;
      }

      // Segurança: parar após 1000 páginas (1 milhão de registros)
      if (currentPage >= 1000) {
        console.log(`  !  Limite de segurança atingido (1000 páginas)`);
        hasMoreData = false;
      }
    }

    if (allData.length === 0) {
      throw new Error("Nenhum dado de treinamento foi carregado");
    }

    console.log(
      `  ✅ ${allData.length} amostras carregadas (quality_score >= 0.7)`,
    );

    // Verificar estrutura dos dados
    console.log("  🔍 Verificando estrutura dos dados...");
    const firstRecord = allData[0];
    console.log("  📋 Estrutura do primeiro registro:");
    console.log("    - Tem 'features'?", "features" in firstRecord);
    console.log("    - Tem 'target'?", "target" in firstRecord);
    console.log("    - Tem 'quality_score'?", "quality_score" in firstRecord);

    if (!firstRecord.features) {
      throw new Error("Campo 'features' não encontrado nos dados");
    }
    if (firstRecord.target === undefined) {
      throw new Error("Campo 'target' não encontrado nos dados");
    }

    console.log("    - Tipo de 'features':", typeof firstRecord.features);
    console.log(
      "    - Keys em 'features':",
      Object.keys(firstRecord.features).slice(0, 5).join(", "),
      "...",
    );
    console.log("    - Target:", firstRecord.target);

    // Opção de limitar dados se forem muitos
    const maxSamples = 100000000;
    const data =
      allData.length > maxSamples
        ? shuffleArray(allData).slice(0, maxSamples)
        : allData;

    if (allData.length > maxSamples) {
      console.log(
        `  !  Limitando a ${maxSamples} amostras aleatórias para economizar memória`,
      );
    }

    // Features selecionadas (42 features importantes)
    console.log("  📊 Extraindo features...");
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

    console.log(
      `  📝 Total de features selecionadas: ${selectedFeatures.length}`,
    );

    // Extrair features e targets
    const features: number[][] = [];
    const targets: number[] = [];
    let skippedCount = 0;
    let nullReasons: Record<string, number> = {};

    console.log("  🔄 Processando registros...");
    for (let i = 0; i < data.length; i++) {
      const record = data[i];
      const featureVector: number[] = [];
      let hasNull = false;
      let nullReason = "";

      for (const featName of selectedFeatures) {
        let value = record.features[featName];

        // Para SP, pular se null (corridas futuras não teriam)
        if (
          (featName === "sp_decimal" || featName === "sp_implied_prob") &&
          (value === null || value === undefined)
        ) {
          hasNull = true;
          nullReason = `sp_null`;
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
      } else {
        skippedCount++;
        nullReasons[nullReason] = (nullReasons[nullReason] || 0) + 1;
      }

      // Log de progresso a cada 10%
      if (i > 0 && i % Math.floor(data.length / 10) === 0) {
        console.log(`  ⏳ Processados ${i}/${data.length} registros...`);
      }
    }

    console.log(`  ✅ ${features.length} amostras válidas após limpeza`);
    console.log(`  !  ${skippedCount} amostras ignoradas por dados faltantes`);
    if (skippedCount > 0) {
      console.log(`  📊 Razões para ignorar:`, nullReasons);
    }

    if (features.length === 0) {
      throw new Error("Nenhuma amostra válida após limpeza de dados");
    }

    // Calcular class weights
    console.log("  ⚖  Calculando pesos de classe...");
    const classCounts = targets.reduce(
      (acc, target) => {
        acc[target] = (acc[target] || 0) + 1;
        return acc;
      },
      {} as Record<number, number>,
    );

    console.log(`  📊 Distribuição de classes:`, classCounts);

    const totalSamples = targets.length;
    const numClasses = Object.keys(classCounts).length;
    const classWeights: { [key: number]: number } = {};

    for (const classId in classCounts) {
      classWeights[Number(classId)] =
        totalSamples / (numClasses * classCounts[classId]);
    }

    console.log(
      `  ⚖  Pesos de classe calculados: 0=${classWeights[0]?.toFixed(2)}, 1=${classWeights[1]?.toFixed(2)}`,
    );

    // Split 80/20
    console.log("  ✂  Dividindo dados em treino/validação (80/20)...");
    const splitIdx = Math.floor(features.length * 0.8);
    const trainFeatures = features.slice(0, splitIdx);
    const trainTargets = targets.slice(0, splitIdx);
    const valFeatures = features.slice(splitIdx);
    const valTargets = targets.slice(splitIdx);

    console.log(`  📊 Treino: ${trainFeatures.length} amostras`);
    console.log(`  📊 Validação: ${valFeatures.length} amostras`);

    // Converter para tensors
    console.log("  🔢 Convertendo para tensors...");
    const trainX = tf.tensor2d(trainFeatures);
    const trainY = tf.tensor2d(trainTargets, [trainTargets.length, 1]);
    const valX = tf.tensor2d(valFeatures);
    const valY = tf.tensor2d(valTargets, [valTargets.length, 1]);

    console.log("  ✅ Tensors criados com sucesso");
    console.log(`  📏 Shape trainX: [${trainX.shape}]`);
    console.log(`  📏 Shape trainY: [${trainY.shape}]`);

    // Normalização robusta
    console.log("  📐 Aplicando normalização robusta...");
    const normalization = robustNormalize(trainX, valX);
    console.log("  ✅ Normalização aplicada");

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
  } catch (error) {
    console.error("\n  ❌ ERRO em loadAndPrepareData:");
    console.error("  Tipo:", typeof error);
    console.error("  Erro:", error);

    if (error instanceof Error) {
      console.error("  Nome:", error.name);
      console.error("  Mensagem:", error.message);
      console.error("  Stack:", error.stack);
    }

    throw error;
  }
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
    optimizer: tf.train.adam(0.001),
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
  let bestValLoss = Infinity;
  let bestWeights: tf.Tensor[] | null = null;
  let patienceCounter = 0;
  const patience = 15;
  const maxEpochs = 100;
  let actualEpochs = 0;

  console.log(`  📋 Configuração:`);
  console.log(`    - Max épocas: ${maxEpochs}`);
  console.log(`    - Patience: ${patience}`);
  console.log(`    - Batch size: 32`);
  console.log(`    - Learning rate: 0.001`);
  console.log(`  🚀 Iniciando epochs...\n`);

  try {
    // Treinar época por época para implementar Early Stopping manual
    for (let epoch = 0; epoch < maxEpochs; epoch++) {
      const history = await model.fit(data.trainX, data.trainY, {
        epochs: 1,
        batchSize: 32,
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
        if (patienceCounter >= patience) {
          console.log(
            `  ⏹  Early stopping ativado na época ${epoch} (patience=${patience})`,
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
