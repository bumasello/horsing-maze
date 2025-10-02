// features_v4/ml/predictions.ts

import * as tf from "@tensorflow/tfjs-node";
import dotenv from "dotenv";
import { supabase } from "../../../..";

dotenv.config();

// Configuração
const MODEL_NAME = "claude-ml-model";
const BUCKET_NAME = "modelos-tfjs-publicos";
const MODEL_PATH = `horse_probability_model/${MODEL_NAME}`;

// URL do Supabase - compatível com Next.js
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";

interface ModelConfig {
  version: number;
  features: string[];
  normalization: {
    mean: number[];
    std: number[];
    median: number[];
    iqr: number[];
  };
}

interface RaceForPrediction {
  id: number;
  id_race: string;
  course: string;
  date: Date;
  off_time_br: string;
  title: string;
  class: number;
  distance: string;
  going: string;
}

interface HorseForPrediction {
  id: number;
  race_horse_id: number;
  race_id: number;
  horse_id: number;
  horse: string;
  features: any;
}

/**
 * Pipeline principal de predições
 */
export async function generatePredictions_v4(): Promise<void> {
  console.log("🔮 Iniciando geração de predições...\n");

  try {
    // 1. Carregar modelo do Supabase
    const { model, config } = await loadModelFromSupabase();
    console.log(`✅ Modelo carregado - Versão: ${config.version}`);
    console.log(`📊 Features: ${config.features.length}`);

    // 2. Buscar corridas futuras
    const upcomingRaces = await getUpcomingRaces();
    console.log(`\n🏇 ${upcomingRaces.length} corridas futuras encontradas`);

    if (upcomingRaces.length === 0) {
      console.log("i Nenhuma corrida futura para processar");
      return;
    }

    // 3. Processar cada corrida
    let totalPredictions = 0;
    let racesProcessed = 0;

    for (const race of upcomingRaces) {
      console.log(
        `\n📍 Processando corrida ${race.id_race} - ${race.course} (${race.date})`,
      );

      try {
        const predictionsCount = await processRace(race, model, config);
        totalPredictions += predictionsCount;
        racesProcessed++;

        console.log(
          `✅ ${predictionsCount} predições geradas para esta corrida`,
        );
      } catch (error) {
        console.error(`❌ Erro ao processar corrida ${race.id}:`, error);
        continue;
      }
    }

    // 4. Cleanup
    model.dispose();

    // 5. Resumo final
    console.log("\n" + "=".repeat(50));
    console.log("🎯 RESUMO DAS PREDIÇÕES");
    console.log("=".repeat(50));
    console.log(
      `📊 Corridas processadas: ${racesProcessed}/${upcomingRaces.length}`,
    );
    console.log(`💾 Total de predições inseridas: ${totalPredictions}`);
    console.log(`📅 Versão do modelo: ${config.version}`);
    console.log("=".repeat(50));
  } catch (error) {
    console.error("❌ Erro no pipeline de predições:", error);
    throw error;
  }
}

/**
 * Carregar modelo do Supabase Storage
 */
async function loadModelFromSupabase(): Promise<{
  model: tf.LayersModel;
  config: ModelConfig;
}> {
  console.log("📥 Baixando modelo do Supabase Storage...");

  // Baixar configuração
  const { data: configData, error: configError } = await supabase.storage
    .from(BUCKET_NAME)
    .download(`${MODEL_PATH}/config.json`);

  if (configError || !configData) {
    throw new Error(
      `Erro ao baixar configuração do modelo: ${configError?.message}`,
    );
  }

  const configText = await configData.text();
  const config = JSON.parse(configText) as ModelConfig;

  // Baixar modelo - usar URL do Supabase já definida no topo
  const modelUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${MODEL_PATH}/model.json`;
  const model = await tf.loadLayersModel(modelUrl);

  return { model, config };
}

/**
 * Buscar corridas futuras
 */
async function getUpcomingRaces(): Promise<RaceForPrediction[]> {
  const { data, error } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .select(
      "id, id_race, course, date, off_time_br, title, class, distance, going",
    )
    .eq("finished", 0)
    .eq("canceled", 0)
    // .gte("date", new Date().toISOString().split("T")[0]) // Apenas corridas de hoje em diante
    .order("date", { ascending: true })
    .order("off_time_br", { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Processar uma corrida individual
 */
async function processRace(
  race: RaceForPrediction,
  model: tf.LayersModel,
  config: ModelConfig,
): Promise<number> {
  // 1. Buscar cavalos e features da corrida
  const horses = await getHorsesWithFeatures(race.id);

  if (horses.length === 0) {
    console.log(`! Nenhum cavalo com features para corrida ${race.id}`);
    return 0;
  }

  console.log(`🐴 ${horses.length} cavalos encontrados com features`);

  // 2. Preparar dados para predição
  const { inputTensor, validHorses } = prepareInputData(horses, config);

  if (validHorses.length === 0) {
    console.log("! Nenhum cavalo válido após preparação");
    inputTensor.dispose();
    return 0;
  }

  // 3. Fazer predições
  const predictions = model.predict(inputTensor) as tf.Tensor;
  const probabilities = await predictions.data();

  // 4. Preparar registros para inserção
  const predictionRecords = [];

  for (let i = 0; i < validHorses.length; i++) {
    const horse = validHorses[i];
    const probability = probabilities[i];

    // Determinar recomendação de lay
    let layRecommendation: string;
    if (probability >= 0.85) {
      layRecommendation = "STRONG_LAY";
    } else if (probability >= 0.75) {
      layRecommendation = "LAY";
    } else if (probability >= 0.65) {
      layRecommendation = "NEUTRAL";
    } else {
      layRecommendation = "AVOID";
    }

    // Calcular score de qualidade baseado na completude das features
    const qualityScore = calculateQualityScore(horse.features);

    predictionRecords.push({
      race_horse_id: horse.race_horse_id,
      race_id: horse.race_id,
      horse_id: horse.horse_id,
      features: horse.features,
      predicted_probability: probability,
      lay_recommendation: layRecommendation,
      race_date: race.date,
      model_version: `v${config.version}`,
      quality_score: qualityScore,
      prediction_status: "PENDING",
      generated_at: new Date().toISOString(),
    });
  }

  // 5. Inserir no banco (com upsert para evitar duplicatas)
  if (predictionRecords.length > 0) {
    const { error } = await supabase
      .schema("hml")
      .from("prediction_enriched_horse_features")
      .upsert(predictionRecords, {
        onConflict: "race_horse_id,model_version",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error("Erro ao inserir predições:", error);
      throw error;
    }

    // Log das predições mais interessantes
    const strongLays = predictionRecords.filter(
      (p) => p.lay_recommendation === "STRONG_LAY",
    );
    const regularLays = predictionRecords.filter(
      (p) => p.lay_recommendation === "LAY",
    );

    if (strongLays.length > 0) {
      console.log(
        `  🔥 ${strongLays.length} STRONG LAY (>85% chance de não ganhar)`,
      );
    }
    if (regularLays.length > 0) {
      console.log(
        `  ✅ ${regularLays.length} LAY (75-85% chance de não ganhar)`,
      );
    }
  }

  // Cleanup
  inputTensor.dispose();
  predictions.dispose();

  return predictionRecords.length;
}

/**
 * Buscar cavalos com features para uma corrida
 */
async function getHorsesWithFeatures(
  raceId: number,
): Promise<HorseForPrediction[]> {
  // Primeiro buscar na tabela de predições existentes (caso já existam features geradas)
  const { data: existingPredictions, error: predError } = await supabase
    .schema("hml")
    .from("prediction_enriched_horse_features")
    .select("race_horse_id, race_id, horse_id, features")
    .eq("race_id", raceId);

  if (!predError && existingPredictions && existingPredictions.length > 0) {
    return existingPredictions.map((p) => ({
      id: p.race_horse_id,
      race_horse_id: p.race_horse_id,
      race_id: p.race_id,
      horse_id: p.horse_id,
      horse: "N/A", // Nome não é crítico para predição
      features: p.features,
    }));
  }

  // Se não existirem, buscar da tabela de training (caso sejam corridas passadas sendo reprocessadas)
  const { data: trainingData, error: trainError } = await supabase
    .schema("hml")
    .from("training_enriched_horse_features")
    .select("race_horse_id, race_id, horse_id, features")
    .eq("race_id", raceId);

  if (!trainError && trainingData && trainingData.length > 0) {
    return trainingData.map((t) => ({
      id: t.race_horse_id,
      race_horse_id: t.race_horse_id,
      race_id: t.race_id,
      horse_id: t.horse_id,
      horse: "N/A",
      features: t.features,
    }));
  }

  // Se não houver features em nenhuma tabela, retornar vazio
  // (Você pode adicionar aqui uma chamada para gerar features on-demand se necessário)
  return [];
}

/**
 * Preparar dados de entrada para o modelo
 */
function prepareInputData(
  horses: HorseForPrediction[],
  config: ModelConfig,
): { inputTensor: tf.Tensor2D; validHorses: HorseForPrediction[] } {
  const validHorses: HorseForPrediction[] = [];
  const inputData: number[][] = [];

  for (const horse of horses) {
    const featureVector: number[] = [];
    let isValid = true;

    // Extrair features na ordem correta
    for (const featureName of config.features) {
      const value = horse.features[featureName];

      // Pular se feature crítica estiver faltando
      if (value === null || value === undefined) {
        if (featureName.includes("sp_") || featureName.includes("or_rating")) {
          // Para predição, podemos imputar SP e OR
          featureVector.push(featureName.includes("rate") ? 0.5 : 0);
        } else {
          isValid = false;
          break;
        }
      } else {
        featureVector.push(Number(value));
      }
    }

    if (isValid && featureVector.length === config.features.length) {
      validHorses.push(horse);
      inputData.push(featureVector);
    }
  }

  if (inputData.length === 0) {
    return {
      inputTensor: tf.zeros([0, config.features.length]),
      validHorses: [],
    };
  }

  // Criar tensor e normalizar usando os parâmetros salvos
  const rawTensor = tf.tensor2d(inputData);
  const normalizedTensor = normalizeFeatures(rawTensor, config.normalization);
  rawTensor.dispose();

  return {
    inputTensor: normalizedTensor,
    validHorses,
  };
}

/**
 * Normalizar features usando parâmetros do treinamento
 */
function normalizeFeatures(
  tensor: tf.Tensor2D,
  normParams: ModelConfig["normalization"],
): tf.Tensor2D {
  // Usar normalização robusta com mediana e IQR (como no treinamento)
  const median = tf.tensor1d(normParams.median);
  const iqr = tf.tensor1d(normParams.iqr.map((v) => (v > 0 ? v : 1)));

  // (X - median) / IQR
  const normalized = tensor.sub(median).div(iqr) as tf.Tensor2D;

  // Clipping entre -3 e 3
  const clipped = normalized.clipByValue(-3, 3) as tf.Tensor2D;

  // Cleanup
  median.dispose();
  iqr.dispose();
  normalized.dispose();

  return clipped;
}

/**
 * Calcular score de qualidade das features
 */
function calculateQualityScore(features: any): number {
  const importantFeatures = [
    "career_win_rate",
    "form_last3_avg",
    "or_rating",
    "jockey_win_rate",
    "trainer_win_rate",
    "sp_decimal",
    "race_field_size",
    "course_win_rate",
  ];

  let presentCount = 0;
  let totalWeight = 0;

  for (const feature of importantFeatures) {
    const weight =
      feature.includes("career") || feature.includes("form") ? 2 : 1;
    totalWeight += weight;

    if (features[feature] !== null && features[feature] !== undefined) {
      presentCount += weight;
    }
  }

  return Math.min(1, presentCount / totalWeight);
}

/**
 * Função para executar predições e análise
 */
export async function runPredictionPipeline(): Promise<void> {
  console.log("\n" + "=".repeat(50));
  console.log("🎯 LAY BETTING ML - PIPELINE DE PREDIÇÕES");
  console.log("=".repeat(50));

  await generatePredictions_v4();

  // Opcional: Mostrar estatísticas das predições geradas
  await showPredictionStats();
}

/**
 * Mostrar estatísticas das predições
 */
async function showPredictionStats(): Promise<void> {
  console.log("\n📊 ESTATÍSTICAS DAS PREDIÇÕES RECENTES");
  console.log("-".repeat(40));

  const { data, error } = await supabase
    .schema("hml")
    .from("prediction_enriched_horse_features")
    .select("lay_recommendation, predicted_probability, race_date")
    .gte(
      "generated_at",
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    ) // Últimas 24h
    .order("predicted_probability", { ascending: false });

  if (error || !data) {
    console.log("Erro ao buscar estatísticas");
    return;
  }

  const stats = {
    STRONG_LAY: data.filter((d) => d.lay_recommendation === "STRONG_LAY")
      .length,
    LAY: data.filter((d) => d.lay_recommendation === "LAY").length,
    NEUTRAL: data.filter((d) => d.lay_recommendation === "NEUTRAL").length,
    AVOID: data.filter((d) => d.lay_recommendation === "AVOID").length,
  };

  console.log(`🔥 STRONG LAY (>85%): ${stats.STRONG_LAY} cavalos`);
  console.log(`✅ LAY (75-85%): ${stats.LAY} cavalos`);
  console.log(`📊 NEUTRAL (65-75%): ${stats.NEUTRAL} cavalos`);
  console.log(`! AVOID (<65%): ${stats.AVOID} cavalos`);

  if (data.length > 0) {
    const avgProb =
      data.reduce((sum, d) => sum + d.predicted_probability, 0) / data.length;
    console.log(`\n📈 Probabilidade média: ${(avgProb * 100).toFixed(2)}%`);

    // Top 5 maiores probabilidades
    const top5 = data.slice(0, 5);
    if (top5.length > 0) {
      console.log("\n🎯 TOP 5 CANDIDATOS PARA LAY:");
      top5.forEach((horse, idx) => {
        console.log(
          `  ${idx + 1}. ${(horse.predicted_probability * 100).toFixed(2)}% - ` +
            `${horse.lay_recommendation} (${horse.race_date})`,
        );
      });
    }
  }

  console.log("-".repeat(40));
}
