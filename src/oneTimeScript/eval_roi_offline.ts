// Fase 6 debug — mede ROI hipotético da estratégia LAY em v prod + baselines.
// Setup validado com usuário 2026-06-27:
//   - Banca inicial 200, stake 10, odd assumida 20 (P/L +10/-200)
//   - Cascata pick #1→#2→#3, elegível se non_runner=false e 4 ≤ odd_média ≤ 20
//   - Banca continua em negativo (não interrompe)
//   - Últimos 90 dias Flat, model_version=v5.0
//   - Modelos: Prod atual + SP-only + No-market (baselines de Fase 1)
//
// Uso: nvm use 20 && PORT=3999 npx ts-node src/oneTimeScript/eval_roi_offline.ts

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import * as tf from "@tensorflow/tfjs-node";
import { supabase } from "..";
import "../services/ml/layers/attention";
import type { ModelConfig } from "../shared/types/ml.types";
import {
  simulateRace,
  type PickCandidate,
} from "../services/ml/eval/simulator";
import {
  summarize,
  printConsoleTable,
  writeCsv,
  writeJsonSummary,
} from "../services/ml/eval/report";

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

const BUCKET = "modelos-tfjs-publicos";
const MAX_HORSES = 30;
const BANKROLL_INITIAL = 200;
const PERIOD_DAYS = Number(process.env.PERIOD_DAYS || 90);
const MIN_ELIGIBLE_ODD = Number(process.env.MIN_ELIGIBLE_ODD || 4);
const MAX_ELIGIBLE_ODD = Number(process.env.MAX_ELIGIBLE_ODD || 20);

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";

interface ModelSpec {
  label: string;
  path: string;
  defaultTemp: number;
}

const MODELS: ModelSpec[] = [
  {
    label: "mt_b05",
    path: "horse_probability_model/baselines/multitask_flat",
    defaultTemp: 1.5,
  },
];

// Constantes copiadas 1:1 de claude-generate-picks.ts pra garantir simetria
const MIN_ODD_THRESHOLD = 4.0;
const MAX_ODD_THRESHOLD = 34.0;

function calculateLayValueIndex(
  probability: number,
  marketOdd: number,
): number {
  if (marketOdd <= 1) return 0;
  const impliedProbWin = 1 / marketOdd;
  const impliedProbLose = 1 - impliedProbWin;
  return probability - impliedProbLose;
}

function calculateCombinedScore(
  probability: number,
  ivl: number,
  marketOdd: number,
): number {
  const W_PROB = 0.4;
  const W_IVL = 0.4;
  const W_ODD = 0.2;
  const probScore = probability;
  const ivlScore = Math.min(ivl / 2, 1);
  let oddScore = 0;
  if (marketOdd >= MIN_ODD_THRESHOLD && marketOdd <= MAX_ODD_THRESHOLD) {
    if (marketOdd >= 6 && marketOdd <= 15) oddScore = 1;
    else if (marketOdd < 6)
      oddScore = (marketOdd - MIN_ODD_THRESHOLD) / (6 - MIN_ODD_THRESHOLD);
    else oddScore = 1 - (marketOdd - 15) / (MAX_ODD_THRESHOLD - 15);
  }
  return probScore * W_PROB + ivlScore * W_IVL + oddScore * W_ODD;
}

// ============================================================================
// LOAD MODELS
// ============================================================================

interface LoadedModel {
  label: string;
  config: ModelConfig;
  model: tf.LayersModel;
  temperature: number;
}

async function loadModel(spec: ModelSpec): Promise<LoadedModel> {
  const { data: cfgData, error: cfgErr } = await supabase.storage
    .from(BUCKET)
    .download(`${spec.path}/config.json`);
  if (cfgErr || !cfgData)
    throw new Error(`Config ${spec.label}: ${cfgErr?.message}`);
  const config = JSON.parse(await cfgData.text()) as ModelConfig;
  const modelUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${spec.path}/model.json`;
  const model = await tf.loadLayersModel(modelUrl);
  const temperature =
    (config as unknown as { softmaxTemperature?: number }).softmaxTemperature ??
    spec.defaultTemp;
  return { label: spec.label, config, model, temperature };
}

// ============================================================================
// DATA LOADING
// ============================================================================

interface HorseRecord {
  race_id: number;
  race_date: string;
  race_horse_id: number;
  horse_id: number;
  horse_name: string;
  features: Record<string, number | null>;
  finish_position: number;
  non_runner: boolean;
  market_odd: number;
}

async function loadPeriodData(): Promise<Map<number, HorseRecord[]>> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PERIOD_DAYS);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  console.log(`  📅 Data-corte: ${cutoffStr} (últimos ${PERIOD_DAYS} dias)`);

  // 1. Features + finish_position, paginado
  const pageSize = 1000;
  let page = 0;
  const rawFeatures: Array<{
    race_id: number;
    race_date: string;
    race_horse_id: number;
    horse_id: number;
    features: Record<string, number | null>;
    finish_position: number;
  }> = [];

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .schema("hml")
      .from("training_enriched_horse_features")
      .select(
        "race_id, race_date, race_horse_id, horse_id, features, finish_position",
      )
      .eq("race_type", "Flat")
      .eq("model_version", "v5.0")
      .gte("quality_score", 0.7)
      .gte("race_date", cutoffStr)
      .order("race_date", { ascending: true })
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;
    rawFeatures.push(
      ...(data as Array<{
        race_id: number;
        race_date: string;
        race_horse_id: number;
        horse_id: number;
        features: Record<string, number | null>;
        finish_position: number;
      }>),
    );
    if (data.length < pageSize) break;
    page++;
  }
  console.log(`  📊 ${rawFeatures.length} horse-records`);

  if (rawFeatures.length === 0) return new Map();

  // 2. race_horses_hr_enriched (batch por id) — pega sp_decimal como fonte primária de odd
  const raceHorseIds = Array.from(
    new Set(rawFeatures.map((r) => r.race_horse_id)),
  );
  const rhMap = new Map<
    number,
    {
      horse: string;
      non_runner: number;
      position: number;
      sp_decimal: number | null;
    }
  >();
  const CHUNK = 500;
  for (let i = 0; i < raceHorseIds.length; i += CHUNK) {
    const chunk = raceHorseIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .schema("hml")
      .from("race_horses_hr_enriched")
      .select("id, horse, non_runner, position, sp_decimal")
      .in("id", chunk);
    if (error) throw error;
    for (const row of data || []) {
      rhMap.set(row.id, {
        horse: row.horse,
        non_runner: row.non_runner,
        position: row.position,
        sp_decimal:
          row.sp_decimal !== null && row.sp_decimal !== undefined
            ? Number(row.sp_decimal)
            : null,
      });
    }
  }
  console.log(`  🐴 ${rhMap.size} race_horses`);

  // 3. odds_enriched (batch — média por race_horse_id) — FALLBACK
  const oddSums = new Map<number, { sum: number; count: number }>();
  for (let i = 0; i < raceHorseIds.length; i += CHUNK) {
    const chunk = raceHorseIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .schema("hml")
      .from("odds_enriched")
      .select("race_horse_id, odd")
      .in("race_horse_id", chunk);
    if (error) throw error;
    for (const row of data || []) {
      const cur = oddSums.get(row.race_horse_id) || { sum: 0, count: 0 };
      cur.sum += Number(row.odd);
      cur.count++;
      oddSums.set(row.race_horse_id, cur);
    }
  }
  console.log(`  💰 ${oddSums.size} horses com odds (fallback avg)`);

  // 4. Combinar tudo e agrupar por race_id
  const raceMap = new Map<number, HorseRecord[]>();
  const oddSource = { sp_decimal: 0, avg: 0, none: 0 };
  const useSp = (process.env.ODD_SOURCE || "sp_decimal").trim() !== "avg";

  for (const f of rawFeatures) {
    const rh = rhMap.get(f.race_horse_id);
    const oddInfo = oddSums.get(f.race_horse_id);
    const avgOdd = oddInfo ? oddInfo.sum / oddInfo.count : 0;
    const spOdd = rh?.sp_decimal ?? 0;

    // Prioridade: sp_decimal se ODD_SOURCE=sp_decimal (default); senão avg histórico
    let marketOdd: number;
    if (useSp && spOdd > 0) {
      marketOdd = spOdd;
      oddSource.sp_decimal++;
    } else if (avgOdd > 0) {
      marketOdd = avgOdd;
      oddSource.avg++;
    } else {
      marketOdd = 0;
      oddSource.none++;
    }

    const record: HorseRecord = {
      race_id: f.race_id,
      race_date: f.race_date,
      race_horse_id: f.race_horse_id,
      horse_id: f.horse_id,
      horse_name: rh?.horse || "",
      features: f.features,
      finish_position: f.finish_position,
      non_runner: rh?.non_runner === 1,
      market_odd: marketOdd,
    };
    if (!raceMap.has(f.race_id)) raceMap.set(f.race_id, []);
    raceMap.get(f.race_id)!.push(record);
  }
  console.log(
    `  📊 Odd source: sp_decimal=${oddSource.sp_decimal} avg_fallback=${oddSource.avg} none=${oddSource.none}`,
  );
  console.log(`  🏁 ${raceMap.size} corridas`);
  return raceMap;
}

// ============================================================================
// INFERENCE
// ============================================================================

// Retorna P(lose) por cavalo. Índices que falharam validação vêm com -1.
function predictRace(
  horses: HorseRecord[],
  config: ModelConfig,
  temperature: number,
  model: tf.LayersModel,
): number[] {
  const featureNames = config.features;
  const median = config.normalization.median;
  const iqr = config.normalization.iqr;

  const validVecs: number[][] = [];
  const validOrigIdx: number[] = [];
  for (let i = 0; i < horses.length; i++) {
    const vec: number[] = [];
    let ok = true;
    for (const fn of featureNames) {
      let v = horses[i].features?.[fn];
      if (
        (fn === "sp_decimal" || fn === "sp_implied_prob") &&
        (v === null || v === undefined)
      ) {
        ok = false;
        break;
      }
      if (v === null || v === undefined) v = 0;
      vec.push(Number(v));
    }
    if (ok && vec.length === featureNames.length) {
      validVecs.push(vec);
      validOrigIdx.push(i);
    }
  }

  const result = new Array(horses.length).fill(-1);
  if (validVecs.length === 0) return result;

  const nValid = Math.min(validVecs.length, MAX_HORSES);
  const featCount = featureNames.length;
  const xBuf = new Float32Array(MAX_HORSES * featCount);
  for (let h = 0; h < nValid; h++) {
    for (let f = 0; f < featCount; f++) {
      const normalized =
        (validVecs[h][f] - median[f]) / (iqr[f] > 0 ? iqr[f] : 1);
      xBuf[h * featCount + f] = Math.max(-3, Math.min(3, normalized));
    }
  }

  // Env var USE_LOSE_HEAD=1 → usar cabeça lose_output diretamente (multi-task)
  // Default: usa score+softmax (compat com modelos single-head)
  const useLoseHead = (process.env.USE_LOSE_HEAD || "").trim() === "1";

  const losePerHorse = tf.tidy(() => {
    const x = tf.tensor3d(xBuf, [1, MAX_HORSES, featCount]);
    const maskArr = new Float32Array(MAX_HORSES);
    for (let i = 0; i < nValid; i++) maskArr[i] = 1;
    const maskT = tf.tensor2d(maskArr, [1, MAX_HORSES]);
    const rawOut = model.predict([x, maskT]) as
      | tf.Tensor3D
      | tf.Tensor3D[];
    const [scoreOut, loseOut] = Array.isArray(rawOut)
      ? [rawOut[0], rawOut[1]]
      : [rawOut, null];

    if (useLoseHead && loseOut) {
      // Cabeça sigmoid direta: P(perder) por cavalo, sem softmax race-level.
      const loseArr = Array.from(
        loseOut.squeeze([0, 2]).dataSync(),
      );
      return loseArr; // já é P(lose)
    }

    const scores = scoreOut.squeeze([0, 2]) as tf.Tensor1D;
    const mask1d = tf.tensor1d(maskArr);
    const adj = mask1d.sub(1).mul(1e9);
    const scaled = scores.add(adj).div(temperature);
    const probs = tf.softmax(scaled);
    const winProbs = Array.from(probs.dataSync());
    return winProbs.map((p) => 1 - p);
  });

  for (let i = 0; i < nValid; i++) {
    result[validOrigIdx[i]] = losePerHorse[i];
  }
  return result;
}

// ============================================================================
// MAIN
// ============================================================================

function monthlyBreakdown(
  results: import("../services/ml/eval/simulator").SimResult[],
): void {
  const buckets = new Map<
    string,
    { bets: number; wins: number; pnl: number }
  >();
  for (const r of results) {
    if (r.pickIndexUsed === null) continue;
    const key = r.raceDate.slice(0, 7); // YYYY-MM
    const cur = buckets.get(key) || { bets: 0, wins: 0, pnl: 0 };
    cur.bets++;
    if (r.chosenWonRace === false) cur.wins++;
    cur.pnl += r.pnl;
    buckets.set(key, cur);
  }
  const keys = Array.from(buckets.keys()).sort();
  console.log("     mês        apostas  win%   pnl");
  for (const k of keys) {
    const b = buckets.get(k)!;
    const wr = b.bets > 0 ? ((b.wins / b.bets) * 100).toFixed(2) : "  ";
    console.log(
      `     ${k}     ${b.bets.toString().padStart(4)}   ${wr.padStart(5)}%  ${b.pnl.toString().padStart(6)}`,
    );
  }
}

async function main(): Promise<void> {
  console.log("🎯 eval_roi_offline — Fase 6\n");
  console.log(
    `📋 PERIOD_DAYS=${PERIOD_DAYS} | MIN_ELIGIBLE_ODD=${MIN_ELIGIBLE_ODD} | MAX_ELIGIBLE_ODD=${MAX_ELIGIBLE_ODD} | ODD_SOURCE=${process.env.ODD_SOURCE || "sp_decimal"}\n`,
  );
  console.log("🔌 Conectando MongoDB...");
  await mongoose.connect(process.env.MONGOOSE as string);
  console.log("✅ MongoDB conectado\n");

  console.log("📥 Carregando modelos...");
  const loadedModels: LoadedModel[] = [];
  for (const spec of MODELS) {
    try {
      const m = await loadModel(spec);
      console.log(
        `  ✅ ${m.label}: v${m.config.version}, ${m.config.features.length} feat, T=${m.temperature}`,
      );
      loadedModels.push(m);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  ⚠️  Falha em ${spec.label}: ${msg}`);
    }
  }
  if (loadedModels.length === 0) {
    console.error("❌ Nenhum modelo carregado. Abortando.");
    return;
  }

  console.log("\n📥 Carregando dados do período...");
  const raceMap = await loadPeriodData();
  const raceIds = Array.from(raceMap.keys());
  console.log(`\n🏁 Processando ${raceIds.length} corridas por modelo\n`);

  const outDir =
    "/tmp/claude-1000/-home-bumasello-Dev-Node-projects-HorsingMaze/e7ca242f-2ca5-4ab4-b491-37b9d9556c35/scratchpad";

  const allSummaries = [];
  for (const m of loadedModels) {
    console.log(`\n=== ${m.label} ===`);
    let bankroll = BANKROLL_INITIAL;
    const results = [];
    let processed = 0;

    for (const raceId of raceIds) {
      const horses = raceMap.get(raceId)!;
      if (horses.length < 3) continue;
      const raceDate = horses[0].race_date;

      const pLose = predictRace(horses, m.config, m.temperature, m.model);

      const candidates: PickCandidate[] = [];
      for (let i = 0; i < horses.length; i++) {
        if (pLose[i] < 0) continue;
        const ivl = calculateLayValueIndex(pLose[i], horses[i].market_odd);
        const combined = calculateCombinedScore(
          pLose[i],
          ivl,
          horses[i].market_odd,
        );
        candidates.push({
          race_horse_id: horses[i].race_horse_id,
          horse_id: horses[i].horse_id,
          horse_name: horses[i].horse_name,
          predicted_probability: pLose[i],
          combined_score: combined,
          ivl_score: ivl,
          market_odd: horses[i].market_odd,
          non_runner: horses[i].non_runner,
          won_race: horses[i].finish_position === 1,
          finish_position: horses[i].finish_position,
        });
      }

      candidates.sort((a, b) => b.combined_score - a.combined_score);
      const top3 = candidates.slice(0, 3);
      const sim = simulateRace(
        raceId,
        raceDate,
        top3,
        bankroll,
        MIN_ELIGIBLE_ODD,
        MAX_ELIGIBLE_ODD,
      );
      bankroll = sim.bankrollAfter;
      results.push(sim);
      processed++;

      if (processed % 100 === 0) {
        console.log(
          `  ${processed}/${raceIds.length} | banca=${bankroll.toFixed(2)}`,
        );
      }
    }

    const summary = summarize(m.label, results, BANKROLL_INITIAL);
    allSummaries.push(summary);

    console.log(`\n  Breakdown mensal (${m.label}):`);
    monthlyBreakdown(results);

    const csvPath = writeCsv(
      outDir,
      `eval_roi_${m.label.replace(/\W/g, "_")}_p${PERIOD_DAYS}_o${MIN_ELIGIBLE_ODD}.csv`,
      results,
    );
    console.log(`  📁 CSV: ${csvPath}`);
  }

  for (const m of loadedModels) m.model.dispose();

  printConsoleTable(allSummaries);
  const jsonPath = writeJsonSummary(
    outDir,
    "eval_roi_summary.json",
    allSummaries,
  );
  console.log(`\n📁 JSON: ${jsonPath}`);

  await mongoose.disconnect();
  console.log("\n✅ Concluído.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Falha:", e);
    process.exit(1);
  });
