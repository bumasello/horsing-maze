// features_v4/ml/predictions.ts

import * as tf from "@tensorflow/tfjs-node";
import dotenv from "dotenv";
import { supabase } from "../..";

import type { ModelConfig } from "../../shared/types/ml.types";

dotenv.config();

// ============================================================================
// CONFIGURAÇÃO — MESMA DO TRAINING
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
    label: "Jump",
  },
};

function getModelPath(modelType: ModelType): string {
  return `horse_probability_model/${MODEL_TYPE_CONFIG[modelType].name}`;
}

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";

// ============================================================================
// TYPES
// ============================================================================

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
  race_type: string | null;
}

interface HorseForPrediction {
  id: number;
  race_horse_id: number;
  race_id: number;
  horse_id: number;
  horse: string;
  features: any;
}

interface LoadedModel {
  model: tf.LayersModel;
  config: ModelConfig;
  modelType: ModelType;
}

// ============================================================================
// PIPELINE PRINCIPAL
// ============================================================================

/**
 * Pipeline principal de predições — carrega ambos os modelos e aplica o correto por corrida
 */
export async function generatePredictions_v4(): Promise<void> {
  console.log("🔮 Iniciando geração de predições...\n");

  try {
    // 1. Carregar ambos os modelos
    console.log("📥 Carregando modelos Flat e Jump...");
    const models = await loadAllModels();

    if (!models.flat && !models.jump) {
      console.error("❌ Nenhum modelo disponível. Abortando predições.");
      return;
    }

    if (models.flat) {
      console.log(
        `  ✅ Modelo Flat carregado — versão ${models.flat.config.version}, ${models.flat.config.features.length} features`,
      );
    } else {
      console.warn(
        "  ! Modelo Flat não encontrado — corridas Flat serão ignoradas",
      );
    }

    if (models.jump) {
      console.log(
        `  ✅ Modelo Jump carregado — versão ${models.jump.config.version}, ${models.jump.config.features.length} features`,
      );
    } else {
      console.warn(
        "  ! Modelo Jump não encontrado — corridas Jump serão ignoradas",
      );
    }

    // 2. Buscar corridas futuras (agora inclui race_type)
    const upcomingRaces = await getUpcomingRaces();
    console.log(`\n🏇 ${upcomingRaces.length} corridas futuras encontradas`);

    if (upcomingRaces.length === 0) {
      console.log("i Nenhuma corrida futura para processar");
      disposeModels(models);
      return;
    }

    // Separar por tipo
    const flatRaces = upcomingRaces.filter((r) => r.race_type === "Flat");
    const jumpRaces = upcomingRaces.filter((r) =>
      ["Hurdle", "Chase", "NHF"].includes(r.race_type || ""),
    );
    const unknownRaces = upcomingRaces.filter(
      (r) =>
        !r.race_type ||
        !["Flat", "Hurdle", "Chase", "NHF"].includes(r.race_type),
    );

    console.log(
      `  🏇 Flat: ${flatRaces.length} | Jump: ${jumpRaces.length} | Sem tipo: ${unknownRaces.length}`,
    );

    if (unknownRaces.length > 0) {
      console.warn(
        `  ! ${unknownRaces.length} corridas sem race_type — serão processadas com modelo Flat (fallback)`,
      );
    }

    // 3. Processar corridas
    let totalPredictions = 0;
    let racesProcessed = 0;

    // Processar Flat
    if (models.flat && (flatRaces.length > 0 || unknownRaces.length > 0)) {
      const racesToProcess = [...flatRaces, ...unknownRaces];
      console.log(
        `\n🏇 Processando ${racesToProcess.length} corridas com modelo Flat...`,
      );

      for (const race of racesToProcess) {
        try {
          const count = await processRaceAfterTraining(
            race,
            models.flat.model,
            models.flat.config,
            "flat",
          );
          totalPredictions += count;
          racesProcessed++;
        } catch (error) {
          console.error(`❌ Erro corrida ${race.id_race}:`, error);
        }
      }
    }

    // Processar Jump
    if (models.jump && jumpRaces.length > 0) {
      console.log(
        `\n🏇 Processando ${jumpRaces.length} corridas com modelo Jump...`,
      );

      for (const race of jumpRaces) {
        try {
          const count = await processRaceAfterTraining(
            race,
            models.jump.model,
            models.jump.config,
            "jump",
          );
          totalPredictions += count;
          racesProcessed++;
        } catch (error) {
          console.error(`❌ Erro corrida ${race.id_race}:`, error);
        }
      }
    }

    // 4. Cleanup
    disposeModels(models);

    // 5. Resumo
    console.log("\n" + "=".repeat(50));
    console.log("🎯 RESUMO DAS PREDIÇÕES");
    console.log("=".repeat(50));
    console.log(
      `📊 Corridas processadas: ${racesProcessed}/${upcomingRaces.length}`,
    );
    console.log(`💾 Total de predições: ${totalPredictions}`);
    if (models.flat)
      console.log(`🏇 Modelo Flat v${models.flat.config.version}`);
    if (models.jump)
      console.log(`🏇 Modelo Jump v${models.jump.config.version}`);
    console.log("=".repeat(50));
  } catch (error) {
    console.error("❌ Erro no pipeline de predições:", error);
    throw error;
  }
}

// ============================================================================
// CARREGAR MODELOS
// ============================================================================

async function loadAllModels(): Promise<{
  flat: LoadedModel | null;
  jump: LoadedModel | null;
}> {
  const [flat, jump] = await Promise.all([
    loadModelFromSupabase("flat").catch((err) => {
      console.warn(`! Falha ao carregar modelo Flat: ${err.message}`);
      return null;
    }),
    loadModelFromSupabase("jump").catch((err) => {
      console.warn(`! Falha ao carregar modelo Jump: ${err.message}`);
      return null;
    }),
  ]);

  return { flat, jump };
}

async function loadModelFromSupabase(
  modelType: ModelType,
): Promise<LoadedModel> {
  const modelPath = getModelPath(modelType);
  console.log(`  📥 Baixando modelo ${modelType} de ${modelPath}...`);

  const { data: configData, error: configError } = await supabase.storage
    .from(BUCKET_NAME)
    .download(`${modelPath}/config.json`);

  if (configError || !configData) {
    throw new Error(`Config ${modelType}: ${configError?.message}`);
  }

  const configText = await configData.text();
  const config = JSON.parse(configText) as ModelConfig;

  const modelUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${modelPath}/model.json`;
  const model = await tf.loadLayersModel(modelUrl);

  return { model, config, modelType };
}

function disposeModels(models: {
  flat: LoadedModel | null;
  jump: LoadedModel | null;
}): void {
  if (models.flat) models.flat.model.dispose();
  if (models.jump) models.jump.model.dispose();
}

// ============================================================================
// BUSCAR CORRIDAS
// ============================================================================

async function getUpcomingRaces(): Promise<RaceForPrediction[]> {
  const { data, error } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .select(
      "id, id_race, course, date, off_time_br, title, class, distance, going, race_type",
    )
    .eq("finished", 0)
    .eq("canceled", 0)
    .order("date", { ascending: true })
    .order("off_time_br", { ascending: true });

  if (error) throw error;
  return data || [];
}

// ============================================================================
// PROCESSAR CORRIDA
// ============================================================================

async function processRaceAfterTraining(
  race: RaceForPrediction,
  model: tf.LayersModel,
  config: ModelConfig,
  modelType: ModelType,
): Promise<number> {
  console.log(
    `  📍 ${race.id_race} - ${race.course} (${race.race_type || "unknown"}) [${modelType}]`,
  );

  const horses = await getHorsesWithFeatures(race.id);
  if (horses.length === 0) {
    console.log(`  ! Nenhum cavalo com features`);
    return 0;
  }

  const { inputTensor, validHorses } = prepareInputData(horses, config);
  if (validHorses.length === 0) {
    console.log("  ! Nenhum cavalo válido após preparação");
    inputTensor.dispose();
    return 0;
  }

  const predictions = model.predict(inputTensor) as tf.Tensor;
  const probabilities = await predictions.data();

  const strongLayThreshold = config.optimalThreshold;
  const layThreshold = config.optimalThreshold - 0.1;
  const neutralThreshold = config.optimalThreshold - 0.2;

  const predictionRecords = [];

  for (let i = 0; i < validHorses.length; i++) {
    const horse = validHorses[i];
    const probability = probabilities[i];

    let layRecommendation: string;
    if (probability >= strongLayThreshold) layRecommendation = "STRONG_LAY";
    else if (probability >= layThreshold) layRecommendation = "LAY";
    else if (probability >= neutralThreshold) layRecommendation = "NEUTRAL";
    else layRecommendation = "AVOID";

    const qualityScore = calculateQualityScore(horse.features);

    predictionRecords.push({
      race_horse_id: horse.race_horse_id,
      race_id: horse.race_id,
      horse_id: horse.horse_id,
      features: horse.features,
      predicted_probability: probability,
      lay_recommendation: layRecommendation,
      race_date: race.date,
      model_version: `v${config.version}-${modelType}`,
      quality_score: qualityScore,
      prediction_status: "PENDING",
      generated_at: new Date().toISOString(),
    });
  }

  if (predictionRecords.length > 0) {
    const uniqueRecords = predictionRecords.reduce(
      (acc, record) => {
        const exists = acc.find(
          (r) => r.race_horse_id === record.race_horse_id,
        );
        if (!exists) acc.push(record);
        return acc;
      },
      [] as typeof predictionRecords,
    );

    const { error } = await supabase
      .schema("hml")
      .from("prediction_enriched_horse_features")
      .upsert(uniqueRecords, {
        onConflict: "race_horse_id,model_version",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error("  Erro ao inserir predições:", error);
      throw error;
    }

    const strongLays = uniqueRecords.filter(
      (p) => p.lay_recommendation === "STRONG_LAY",
    );
    const regularLays = uniqueRecords.filter(
      (p) => p.lay_recommendation === "LAY",
    );

    if (strongLays.length > 0) {
      console.log(`  🔥 ${strongLays.length} STRONG LAY`);
    }
    if (regularLays.length > 0) {
      console.log(`  ✅ ${regularLays.length} LAY`);
    }
  }

  inputTensor.dispose();
  predictions.dispose();

  return predictionRecords.length;
}

// ============================================================================
// PREPARAR DADOS
// ============================================================================

async function getHorsesWithFeatures(
  raceId: number,
): Promise<HorseForPrediction[]> {
  const { data, error } = await supabase
    .schema("hml")
    .from("prediction_enriched_horse_features")
    .select("race_horse_id, race_id, horse_id, features")
    .eq("race_id", raceId);

  if (error) {
    console.error(`  Erro ao buscar features para corrida ${raceId}:`, error);
    return [];
  }

  if (!data || data.length === 0) {
    return [];
  }

  return data.map((p) => ({
    id: p.race_horse_id,
    race_horse_id: p.race_horse_id,
    race_id: p.race_id,
    horse_id: p.horse_id,
    horse: "N/A",
    features: p.features,
  }));
}

function prepareInputData(
  horses: HorseForPrediction[],
  config: ModelConfig,
): { inputTensor: tf.Tensor2D; validHorses: HorseForPrediction[] } {
  const validHorses: HorseForPrediction[] = [];
  const inputData: number[][] = [];

  for (const horse of horses) {
    const featureVector: number[] = [];
    let isValid = true;

    for (const featureName of config.features) {
      let value = horse.features[featureName];

      if (
        (featureName === "sp_decimal" || featureName === "sp_implied_prob") &&
        (value === null || value === undefined)
      ) {
        isValid = false;
        break;
      }

      if (value === null || value === undefined) {
        value = 0;
      }

      featureVector.push(Number(value));
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

  const rawTensor = tf.tensor2d(inputData);
  const normalizedTensor = normalizeFeatures(rawTensor, config.normalization);
  rawTensor.dispose();

  return { inputTensor: normalizedTensor, validHorses };
}

function normalizeFeatures(
  tensor: tf.Tensor2D,
  normParams: ModelConfig["normalization"],
): tf.Tensor2D {
  const median = tf.tensor1d(normParams.median);
  const iqr = tf.tensor1d(normParams.iqr.map((v) => (v > 0 ? v : 1)));

  const normalized = tensor.sub(median).div(iqr) as tf.Tensor2D;
  const clipped = normalized.clipByValue(-3, 3) as tf.Tensor2D;

  median.dispose();
  iqr.dispose();
  normalized.dispose();

  return clipped;
}

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

// ============================================================================
// STATS (mantido para compatibilidade)
// ============================================================================

export async function runPredictionPipeline(): Promise<void> {
  console.log("\n" + "=".repeat(50));
  console.log("🎯 LAY BETTING ML - PIPELINE DE PREDIÇÕES");
  console.log("=".repeat(50));

  await generatePredictions_v4();
  await showPredictionStats();
}

async function showPredictionStats(): Promise<void> {
  console.log("\n📊 ESTATÍSTICAS DAS PREDIÇÕES RECENTES");
  console.log("-".repeat(40));

  const { data, error } = await supabase
    .schema("hml")
    .from("prediction_enriched_horse_features")
    .select(
      "lay_recommendation, predicted_probability, race_date, model_version",
    )
    .gte(
      "generated_at",
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    )
    .order("predicted_probability", { ascending: false });

  if (error || !data) {
    console.log("Erro ao buscar estatísticas");
    return;
  }

  const flatPreds = data.filter((d) => d.model_version?.includes("flat"));
  const jumpPreds = data.filter((d) => d.model_version?.includes("jump"));

  console.log(
    `\n🏇 Flat: ${flatPreds.length} predições | Jump: ${jumpPreds.length} predições`,
  );

  const stats = {
    STRONG_LAY: data.filter((d) => d.lay_recommendation === "STRONG_LAY")
      .length,
    LAY: data.filter((d) => d.lay_recommendation === "LAY").length,
    NEUTRAL: data.filter((d) => d.lay_recommendation === "NEUTRAL").length,
    AVOID: data.filter((d) => d.lay_recommendation === "AVOID").length,
  };

  console.log(`🔥 STRONG LAY: ${stats.STRONG_LAY}`);
  console.log(`✅ LAY: ${stats.LAY}`);
  console.log(`📊 NEUTRAL: ${stats.NEUTRAL}`);
  console.log(`! AVOID: ${stats.AVOID}`);

  if (data.length > 0) {
    const avgProb =
      data.reduce((sum, d) => sum + d.predicted_probability, 0) / data.length;
    console.log(`\n📈 Probabilidade média: ${(avgProb * 100).toFixed(2)}%`);
  }

  console.log("-".repeat(40));
}
