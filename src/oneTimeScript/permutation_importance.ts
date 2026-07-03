// Fase 0.3 — permutation importance no ROI simulado.
// Ideia: embaralhar uma feature no val set, medir mudança em ROI.
// Features com queda grande de ROI = importantes. Sem queda = ruído.
// Usa modelo with_pace (74 features).

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

const BUCKET = "modelos-tfjs-publicos";
const MAX_HORSES = 30;
const BANKROLL_INITIAL = 200;
const PERIOD_DAYS = 90;
const MIN_ELIGIBLE_ODD = Number(process.env.MIN_ELIGIBLE_ODD || 13);
const MAX_ELIGIBLE_ODD = 20;
const MODEL_PATH = "horse_probability_model/baselines/with_pace_flat";
const DEFAULT_TEMP = 1.5;

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";

const MIN_ODD_THRESHOLD = 4.0;
const MAX_ODD_THRESHOLD = 34.0;

function ivl(p: number, o: number): number {
  if (o <= 1) return 0;
  return p - (1 - 1 / o);
}
function combined(p: number, ivlv: number, o: number): number {
  const probScore = p;
  const ivlScore = Math.min(ivlv / 2, 1);
  let oddScore = 0;
  if (o >= MIN_ODD_THRESHOLD && o <= MAX_ODD_THRESHOLD) {
    if (o >= 6 && o <= 15) oddScore = 1;
    else if (o < 6) oddScore = (o - MIN_ODD_THRESHOLD) / (6 - MIN_ODD_THRESHOLD);
    else oddScore = 1 - (o - 15) / (MAX_ODD_THRESHOLD - 15);
  }
  return probScore * 0.4 + ivlScore * 0.4 + oddScore * 0.2;
}

interface HorseRecord {
  race_id: number;
  race_date: string;
  race_horse_id: number;
  horse_id: number;
  features: Record<string, number | null>;
  finish_position: number;
  non_runner: boolean;
  market_odd: number;
}

async function loadPeriod(): Promise<Map<number, HorseRecord[]>> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PERIOD_DAYS);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  const pageSize = 1000;
  let page = 0;
  const raw: Array<{
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
    raw.push(...(data as (typeof raw)[number][]));
    if (data.length < pageSize) break;
    page++;
  }
  const ids = Array.from(new Set(raw.map((r) => r.race_horse_id)));
  const rhMap = new Map<
    number,
    { non_runner: number; sp_decimal: number | null }
  >();
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .schema("hml")
      .from("race_horses_hr_enriched")
      .select("id, non_runner, sp_decimal")
      .in("id", chunk);
    if (error) throw error;
    for (const row of data || []) {
      rhMap.set(row.id, {
        non_runner: row.non_runner,
        sp_decimal:
          row.sp_decimal !== null && row.sp_decimal !== undefined
            ? Number(row.sp_decimal)
            : null,
      });
    }
  }
  const raceMap = new Map<number, HorseRecord[]>();
  for (const r of raw) {
    const rh = rhMap.get(r.race_horse_id);
    raceMap.set(r.race_id, raceMap.get(r.race_id) || []);
    raceMap.get(r.race_id)!.push({
      race_id: r.race_id,
      race_date: r.race_date,
      race_horse_id: r.race_horse_id,
      horse_id: r.horse_id,
      features: r.features,
      finish_position: r.finish_position,
      non_runner: rh?.non_runner === 1,
      market_odd: rh?.sp_decimal || 0,
    });
  }
  return raceMap;
}

async function loadModel() {
  const { data: cfgData, error: cfgErr } = await supabase.storage
    .from(BUCKET)
    .download(`${MODEL_PATH}/config.json`);
  if (cfgErr || !cfgData) throw new Error(cfgErr?.message);
  const config = JSON.parse(await cfgData.text()) as ModelConfig;
  const modelUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${MODEL_PATH}/model.json`;
  const model = await tf.loadLayersModel(modelUrl);
  const temperature =
    (config as unknown as { softmaxTemperature?: number }).softmaxTemperature ??
    DEFAULT_TEMP;
  return { model, config, temperature };
}

function predictRace(
  horses: HorseRecord[],
  config: ModelConfig,
  temperature: number,
  model: tf.LayersModel,
  featureOverride?: Map<string, number[]>,
): number[] {
  const featureNames = config.features;
  const median = config.normalization.median;
  const iqr = config.normalization.iqr;
  const validVecs: number[][] = [];
  const origIdx: number[] = [];
  for (let i = 0; i < horses.length; i++) {
    const vec: number[] = [];
    let ok = true;
    for (const fn of featureNames) {
      let v: number | null | undefined;
      if (featureOverride?.has(fn)) v = featureOverride.get(fn)![i];
      else v = horses[i].features?.[fn];
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
      origIdx.push(i);
    }
  }
  const result = new Array(horses.length).fill(-1);
  if (validVecs.length === 0) return result;
  const nValid = Math.min(validVecs.length, MAX_HORSES);
  const fc = featureNames.length;
  const xBuf = new Float32Array(MAX_HORSES * fc);
  for (let h = 0; h < nValid; h++) {
    for (let f = 0; f < fc; f++) {
      const n = (validVecs[h][f] - median[f]) / (iqr[f] > 0 ? iqr[f] : 1);
      xBuf[h * fc + f] = Math.max(-3, Math.min(3, n));
    }
  }
  const wp = tf.tidy(() => {
    const x = tf.tensor3d(xBuf, [1, MAX_HORSES, fc]);
    const m = new Float32Array(MAX_HORSES);
    for (let i = 0; i < nValid; i++) m[i] = 1;
    const mt = tf.tensor2d(m, [1, MAX_HORSES]);
    const scores = (model.predict([x, mt]) as tf.Tensor3D)
      .squeeze([0, 2]) as tf.Tensor1D;
    const m1 = tf.tensor1d(m);
    const adj = m1.sub(1).mul(1e9);
    const sc = scores.add(adj).div(temperature);
    return Array.from(tf.softmax(sc).dataSync());
  });
  for (let i = 0; i < nValid; i++) result[origIdx[i]] = 1 - wp[i];
  return result;
}

function shuffle<T>(a: T[]): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function computeRoi(
  raceMap: Map<number, HorseRecord[]>,
  model: tf.LayersModel,
  config: ModelConfig,
  temperature: number,
  overrideFeature?: string,
): { totalPnl: number; wins: number; losses: number; bets: number } {
  let bankroll = BANKROLL_INITIAL;
  const results = [];

  // Se overrideFeature: gerar valores embaralhados globalmente uma vez
  let override: Map<string, number[]> | undefined;
  if (overrideFeature) {
    const allVals: number[] = [];
    const raceHorsePos: Array<{ race: number; pos: number }> = [];
    for (const [rid, horses] of raceMap) {
      for (let i = 0; i < horses.length; i++) {
        const v = horses[i].features?.[overrideFeature];
        allVals.push(v === null || v === undefined ? 0 : Number(v));
        raceHorsePos.push({ race: rid, pos: i });
      }
    }
    const shuffled = shuffle(allVals);
    override = new Map();
  }

  for (const [raceId, horses] of raceMap) {
    if (horses.length < 3) continue;
    const raceDate = horses[0].race_date;

    // Se overrideFeature, gera shuffled desta corrida sozinha (mais barato)
    let fOverride: Map<string, number[]> | undefined;
    if (overrideFeature) {
      const orig = horses.map((h) => {
        const v = h.features?.[overrideFeature];
        return v === null || v === undefined ? 0 : Number(v);
      });
      fOverride = new Map([[overrideFeature, shuffle(orig)]]);
    }

    const pLose = predictRace(horses, config, temperature, model, fOverride);
    const cand: PickCandidate[] = [];
    for (let i = 0; i < horses.length; i++) {
      if (pLose[i] < 0) continue;
      const iv = ivl(pLose[i], horses[i].market_odd);
      const cs = combined(pLose[i], iv, horses[i].market_odd);
      cand.push({
        race_horse_id: horses[i].race_horse_id,
        horse_id: horses[i].horse_id,
        predicted_probability: pLose[i],
        combined_score: cs,
        ivl_score: iv,
        market_odd: horses[i].market_odd,
        non_runner: horses[i].non_runner,
        won_race: horses[i].finish_position === 1,
        finish_position: horses[i].finish_position,
      });
    }
    cand.sort((a, b) => b.combined_score - a.combined_score);
    const top3 = cand.slice(0, 3);
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
  }

  const bets = results.filter((r) => r.pickIndexUsed !== null);
  const wins = bets.filter((r) => r.chosenWonRace === false).length;
  const losses = bets.filter((r) => r.chosenWonRace === true).length;
  const totalPnl = results.reduce((s, r) => s + r.pnl, 0);
  return { totalPnl, wins, losses, bets: bets.length };
}

async function main() {
  console.log("🎯 Permutation importance no ROI simulado\n");
  await mongoose.connect(process.env.MONGOOSE as string);
  console.log("✅ MongoDB conectado\n");

  console.log("📥 Carregando modelo with_pace...");
  const { model, config, temperature } = await loadModel();
  console.log(`  ${config.features.length} features, T=${temperature}\n`);

  console.log("📥 Carregando período...");
  const raceMap = await loadPeriod();
  console.log(`  ${raceMap.size} corridas\n`);

  // Baseline
  console.log("📊 Baseline (sem embaralhar)...");
  const base = computeRoi(raceMap, model, config, temperature);
  console.log(
    `  bets=${base.bets} wins=${base.wins} losses=${base.losses} pnl=${base.totalPnl} wr=${((base.wins / base.bets) * 100).toFixed(2)}%\n`,
  );

  // Permutation por feature
  console.log(
    "📊 Permutando cada feature (queda de pnl = importância):\n",
  );
  const importances: Array<{
    feat: string;
    baselinePnl: number;
    permutedPnl: number;
    delta: number;
    wrDelta: number;
  }> = [];

  for (const feat of config.features) {
    const perm = computeRoi(raceMap, model, config, temperature, feat);
    const delta = perm.totalPnl - base.totalPnl;
    const wrDelta =
      perm.bets > 0
        ? (perm.wins / perm.bets) * 100 - (base.wins / base.bets) * 100
        : 0;
    importances.push({
      feat,
      baselinePnl: base.totalPnl,
      permutedPnl: perm.totalPnl,
      delta,
      wrDelta,
    });
  }

  // Sort by delta (mais negativo = feature mais importante — sua perda derruba mais)
  importances.sort((a, b) => a.delta - b.delta);

  console.log(
    "  Feature                              Δpnl (embaralhado - base)  Δwr%",
  );
  console.log("  " + "─".repeat(80));
  for (const imp of importances) {
    const sign = imp.delta < 0 ? "🔥" : imp.delta > 100 ? "🌫" : "  ";
    console.log(
      `  ${sign} ${imp.feat.padEnd(35)} ${imp.delta.toFixed(0).padStart(8)}      ${imp.wrDelta.toFixed(2)}pp`,
    );
  }

  console.log("\n🔥 = feature IMPORTANTE (embaralhar derruba pnl)");
  console.log(
    "🌫 = feature RUÍDO (embaralhar melhora pnl — deveria dropar)\n",
  );

  model.dispose();
  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
