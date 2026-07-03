// Avaliação histórica do impacto da calibração isotonic no v53.
//
// Carrega o modelo v53 + config (com config.calibration.knots) do Supabase,
// roda inference em ~1000 corridas mais recentes do val window (que o modelo
// nunca viu durante treino), gera P(win) raw vs P(win) calibrada,
// e compara métricas operacionais:
//
//   1. Pick stability: % de corridas onde os 3 picks lay (menores P(win))
//      são IDÊNTICOS entre raw e calibrado.
//   2. RED rate (winner-in-lay-picks): em raw vs calibrado.
//      Operacionalmente, queremos minimizar essa taxa.
//   3. ROI hipotético: assumindo lay às SP odds (sem comissão), comparar
//      cumulative P&L com e sem calibração.
//
// Roda: nvm use 20 && npx ts-node src/oneTimeScript/eval_calibration_impact.ts

import dotenv from "dotenv";
dotenv.config();

import * as tf from "@tensorflow/tfjs-node";
import { createClient } from "@supabase/supabase-js";
import { applyIsotonicToRace } from "../services/ml/calibration";
import "../services/ml/layers/attention";
import type { ModelConfig } from "../shared/types/ml.types";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
);

const BUCKET_NAME = "modelos-tfjs-publicos";
const MAX_HORSES = 30;
const MODEL_PATH = "horse_probability_model/claude-ml-model-flat";
const NUM_RACES_TO_EVAL = 1000;
const DEFAULT_TEMPERATURE = 1.5;

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";

interface HorseInRace {
  features: Record<string, number>;
  finishPosition: number;
  spDecimal: number;
}

interface RaceData {
  raceId: number;
  horses: HorseInRace[];
}

async function loadModel() {
  console.log("📥 Baixando config.json + model.json do v53...");
  const { data: configData, error } = await supabase.storage
    .from(BUCKET_NAME)
    .download(`${MODEL_PATH}/config.json`);
  if (error || !configData) throw new Error(`Config: ${error?.message}`);
  const config = JSON.parse(await configData.text()) as ModelConfig;
  const modelUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${MODEL_PATH}/model.json`;
  const model = await tf.loadLayersModel(modelUrl);
  console.log(`  ✅ Modelo v${config.version} carregado`);
  if (config.calibration) {
    console.log(
      `  ✅ Calibração: ${config.calibration.method}, ${config.calibration.knots.x.length} knots`,
    );
  } else {
    throw new Error("config.calibration ausente — abortando");
  }
  return { model, config };
}

async function loadRecentRaces(): Promise<RaceData[]> {
  console.log(`\n📊 Carregando corridas Flat mais recentes (paginado)...`);
  const pageSize = 1000;
  const targetRows = NUM_RACES_TO_EVAL * 15; // ~15 horses por corrida média
  const racesMap = new Map<number, RaceData>();
  let from = 0;
  let totalLoaded = 0;
  while (totalLoaded < targetRows) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .schema("hml")
      .from("training_enriched_horse_features")
      .select("race_id, race_date, features, finish_position")
      .gte("quality_score", 0.7)
      .eq("race_type", "Flat")
      .order("race_date", { ascending: false })
      .range(from, to);

    if (error) throw new Error(`Query: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const features = row.features;
      if (!features || features.sp_decimal == null) continue;
      if (!racesMap.has(row.race_id)) {
        racesMap.set(row.race_id, { raceId: row.race_id, horses: [] });
      }
      racesMap.get(row.race_id)!.horses.push({
        features,
        finishPosition: row.finish_position ?? 99,
        spDecimal: Number(features.sp_decimal),
      });
    }

    totalLoaded += data.length;
    from += pageSize;
    if (data.length < pageSize) break;
    if (totalLoaded % 5000 === 0)
      console.log(`  📥 ${totalLoaded} rows, ${racesMap.size} corridas...`);
  }
  console.log(`  📥 Total: ${totalLoaded} rows, ${racesMap.size} corridas únicas`);

  // Filtra corridas válidas (≥3 cavalos, ≤MAX_HORSES, com vencedor real)
  const races = Array.from(racesMap.values()).filter((r) => {
    if (r.horses.length < 3 || r.horses.length > MAX_HORSES) return false;
    return r.horses.some((h) => h.finishPosition === 1);
  });

  // Pega só as N mais recentes (já está ordenado por desc)
  const trimmed = races.slice(0, NUM_RACES_TO_EVAL);
  console.log(
    `  ✅ ${trimmed.length} corridas válidas (de ${races.length} candidatas)`,
  );
  return trimmed;
}

function inferRaceProbs(
  model: tf.LayersModel,
  config: ModelConfig,
  race: RaceData,
  applyCalib: boolean,
): { probs: number[]; isWinner: boolean[]; spOdds: number[] } {
  const featureNames = config.features;
  const median = config.normalization.median;
  const iqr = config.normalization.iqr;
  const featureCount = featureNames.length;
  const validHorses = race.horses;

  const xBuffer = new Float32Array(MAX_HORSES * featureCount);
  const maskArr = new Float32Array(MAX_HORSES);
  for (let h = 0; h < validHorses.length; h++) {
    const horse = validHorses[h];
    for (let f = 0; f < featureCount; f++) {
      const raw = Number(horse.features[featureNames[f]] ?? 0);
      const normalized = (raw - median[f]) / (iqr[f] > 0 ? iqr[f] : 1);
      xBuffer[h * featureCount + f] = Math.max(-3, Math.min(3, normalized));
    }
    maskArr[h] = 1;
  }

  const temperature: number =
    (config as any).softmaxTemperature ?? DEFAULT_TEMPERATURE;

  const rawProbs = tf.tidy(() => {
    const inputTensor = tf.tensor3d(xBuffer, [1, MAX_HORSES, featureCount]);
    const maskTensor = tf.tensor2d(maskArr, [1, MAX_HORSES]);
    const scoresRaw = model.predict([inputTensor, maskTensor]) as tf.Tensor3D;
    const scores = scoresRaw.squeeze([0, 2]) as tf.Tensor1D;
    const mask = tf.tensor1d(maskArr);
    const maskAdjustment = mask.sub(1).mul(1e9);
    const maskedScores = scores.add(maskAdjustment);
    const scaledScores = maskedScores.div(temperature);
    const probs = tf.softmax(scaledScores);
    return Array.from(probs.dataSync()).slice(0, validHorses.length);
  });

  let probs: number[];
  if (applyCalib && config.calibration) {
    probs = applyIsotonicToRace(
      { x: config.calibration.knots.x, y: config.calibration.knots.y },
      rawProbs,
    );
  } else {
    probs = rawProbs;
  }

  return {
    probs,
    isWinner: validHorses.map((h) => h.finishPosition === 1),
    spOdds: validHorses.map((h) => h.spDecimal),
  };
}

// Picks lay = 3 cavalos com MENOR P(win), filtros: SP odds entre 4 e 34
function selectLayPicks(
  probs: number[],
  spOdds: number[],
): number[] {
  const indexed = probs
    .map((p, i) => ({ p, i, sp: spOdds[i] }))
    .filter((x) => x.sp >= 4 && x.sp <= 34) // mesmas regras do claude-generate-picks
    .sort((a, b) => a.p - b.p);
  return indexed.slice(0, 3).map((x) => x.i);
}

async function main() {
  const { model, config } = await loadModel();
  const races = await loadRecentRaces();

  console.log(`\n🧮 Rodando inference em ${races.length} corridas...`);

  let identicalPickRaces = 0;
  let partiallyIdentical = 0; // ≥2 picks em comum
  let totallyDifferent = 0;
  let racesWithBothHavingPicks = 0;
  let racesWithoutPicksRaw = 0;
  let racesWithoutPicksCal = 0;

  // RED rate: % de corridas onde vencedor está nos picks lay
  let redRaw = 0;
  let redCal = 0;
  let racesEvaluatedForRed = 0;

  // Hypothetical ROI: lay às SP odds (stake = 1 unit por pick, sem comissão)
  // GREEN: +1 unidade. RED: -(sp - 1) unidades.
  let pnlRaw = 0;
  let pnlCal = 0;
  let pickedRaw = 0;
  let pickedCal = 0;

  let processed = 0;
  for (const race of races) {
    const rawRes = inferRaceProbs(model, config, race, false);
    const calRes = inferRaceProbs(model, config, race, true);

    const picksRaw = selectLayPicks(rawRes.probs, rawRes.spOdds);
    const picksCal = selectLayPicks(calRes.probs, calRes.spOdds);

    if (picksRaw.length === 0) racesWithoutPicksRaw++;
    if (picksCal.length === 0) racesWithoutPicksCal++;

    if (picksRaw.length === 3 && picksCal.length === 3) {
      racesWithBothHavingPicks++;
      const setRaw = new Set(picksRaw);
      const overlap = picksCal.filter((p) => setRaw.has(p)).length;
      if (overlap === 3) identicalPickRaces++;
      else if (overlap >= 2) partiallyIdentical++;
      else totallyDifferent++;
    }

    // RED rate (em corridas onde ambos têm 3 picks)
    if (picksRaw.length === 3 && picksCal.length === 3) {
      racesEvaluatedForRed++;
      const winnerIdx = rawRes.isWinner.findIndex((w) => w);
      if (picksRaw.includes(winnerIdx)) redRaw++;
      if (picksCal.includes(winnerIdx)) redCal++;
    }

    // ROI: stake 1 unidade por pick
    for (const idx of picksRaw) {
      pickedRaw++;
      if (rawRes.isWinner[idx]) {
        pnlRaw -= rawRes.spOdds[idx] - 1; // RED: perde (sp - 1)
      } else {
        pnlRaw += 1; // GREEN: ganha stake
      }
    }
    for (const idx of picksCal) {
      pickedCal++;
      if (calRes.isWinner[idx]) {
        pnlCal -= calRes.spOdds[idx] - 1;
      } else {
        pnlCal += 1;
      }
    }

    processed++;
    if (processed % 100 === 0) {
      console.log(`  📊 ${processed}/${races.length}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 RESULTADOS — Calibração Isotonic v53`);
  console.log(`${"=".repeat(60)}`);

  console.log(`\nCorridas avaliadas: ${processed}`);
  console.log(`Corridas sem picks (raw): ${racesWithoutPicksRaw}`);
  console.log(`Corridas sem picks (cal): ${racesWithoutPicksCal}`);

  console.log(`\n— Pick Stability (em ${racesWithBothHavingPicks} corridas com 3 picks em ambos) —`);
  const stab = (n: number) =>
    ((n / racesWithBothHavingPicks) * 100).toFixed(1);
  console.log(`  Picks IDÊNTICOS:           ${identicalPickRaces} (${stab(identicalPickRaces)}%)`);
  console.log(`  ≥2 picks em comum:         ${partiallyIdentical} (${stab(partiallyIdentical)}%)`);
  console.log(`  Quase totalmente diferentes: ${totallyDifferent} (${stab(totallyDifferent)}%)`);

  console.log(`\n— RED Rate (vencedor nos picks lay) — menor = melhor —`);
  if (racesEvaluatedForRed > 0) {
    const redRawPct = (redRaw / racesEvaluatedForRed) * 100;
    const redCalPct = (redCal / racesEvaluatedForRed) * 100;
    console.log(`  RAW:        ${redRaw}/${racesEvaluatedForRed} = ${redRawPct.toFixed(2)}%`);
    console.log(`  CALIBRADO:  ${redCal}/${racesEvaluatedForRed} = ${redCalPct.toFixed(2)}%`);
    console.log(`  Δ:          ${(redCalPct - redRawPct).toFixed(2)}pp`);
  }

  console.log(`\n— Hypothetical ROI (lay às SP, sem comissão) —`);
  console.log(`  RAW       : ${pickedRaw} picks, P&L = ${pnlRaw.toFixed(2)} u, ROI = ${((pnlRaw / pickedRaw) * 100).toFixed(2)}%`);
  console.log(`  CALIBRADO : ${pickedCal} picks, P&L = ${pnlCal.toFixed(2)} u, ROI = ${((pnlCal / pickedCal) * 100).toFixed(2)}%`);
  const deltaROI = (pnlCal / pickedCal) - (pnlRaw / pickedRaw);
  console.log(`  Δ ROI     : ${(deltaROI * 100).toFixed(2)}pp`);

  console.log(`\n${"=".repeat(60)}`);

  model.dispose();
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
