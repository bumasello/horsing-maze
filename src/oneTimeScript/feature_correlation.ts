// Fase 0.2 — correlação Pearson entre pace features e base features.
// Objetivo: detectar redundância (hipótese 3 do plano de melhoria).

import dotenv from "dotenv";
dotenv.config();
import { supabase } from "..";

const PACE_FEATURES = [
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

const BASE_FEATURES = [
  "career_win_rate",
  "career_place_rate",
  "career_avg_position",
  "career_runs",
  "career_wins",
  "form_last3_avg",
  "form_last5_avg",
  "form_consistency",
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
  "or_rating_imputed",
  "or_rank_in_race",
  "or_percentile_in_race",
  "or_diff_to_top",
  "field_avg_or",
  "field_std_or",
  "field_avg_career_wins",
  "race_field_size",
  "stronger_opponents_count",
  "jockey_win_rate",
  "jockey_recent_form",
  "trainer_win_rate",
  "trainer_recent_form",
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
];

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const cov = sumXY / n - meanX * meanY;
  const varX = sumX2 / n - meanX * meanX;
  const varY = sumY2 / n - meanY * meanY;
  if (varX <= 0 || varY <= 0) return 0;
  return cov / Math.sqrt(varX * varY);
}

async function main() {
  console.log("📥 Buscando amostra de features Flat v5.0...");
  const { data, error } = await supabase
    .schema("hml")
    .from("training_enriched_horse_features")
    .select("features")
    .eq("race_type", "Flat")
    .eq("model_version", "v5.0")
    .gte("quality_score", 0.7)
    .limit(5000);

  if (error) throw error;
  if (!data || data.length === 0) throw new Error("sem dados");
  console.log(`  ${data.length} horse-records\n`);

  // Extrai vetores por feature
  const vec = (name: string) =>
    data
      .map((row) => {
        const v = (row.features as Record<string, unknown>)?.[name];
        return v === null || v === undefined ? NaN : Number(v);
      })
      .filter((v) => !Number.isNaN(v));

  // Correlação máxima de cada pace feature contra qualquer base feature
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("Pace features → correlação máxima com features base (Pearson):");
  console.log("═══════════════════════════════════════════════════════════════");
  const summaries: Array<{
    pace: string;
    maxAbs: number;
    maxPartner: string;
    top3: Array<{ base: string; r: number }>;
  }> = [];

  for (const pace of PACE_FEATURES) {
    const pv = vec(pace);
    if (pv.length < 100) {
      console.log(`  ${pace.padEnd(35)} SEM DADOS (${pv.length} obs)`);
      continue;
    }
    // Reconstruir com mesmos índices — usar todos os data records, tratar NaN
    const pvRaw = data.map((row) => {
      const v = (row.features as Record<string, unknown>)?.[pace];
      return v === null || v === undefined ? NaN : Number(v);
    });

    const corrs: Array<{ base: string; r: number }> = [];
    for (const base of BASE_FEATURES) {
      const bvRaw = data.map((row) => {
        const v = (row.features as Record<string, unknown>)?.[base];
        return v === null || v === undefined ? NaN : Number(v);
      });

      const pairsA: number[] = [];
      const pairsB: number[] = [];
      for (let i = 0; i < pvRaw.length; i++) {
        if (!Number.isNaN(pvRaw[i]) && !Number.isNaN(bvRaw[i])) {
          pairsA.push(pvRaw[i]);
          pairsB.push(bvRaw[i]);
        }
      }
      const r = pearson(pairsA, pairsB);
      corrs.push({ base, r });
    }
    corrs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    const top3 = corrs.slice(0, 3);
    const maxAbs = Math.abs(top3[0]?.r || 0);
    const maxPartner = top3[0]?.base || "";
    summaries.push({ pace, maxAbs, maxPartner, top3 });
  }

  // Print
  for (const s of summaries) {
    const flag = s.maxAbs >= 0.7 ? "⚠️  REDUND" : s.maxAbs >= 0.5 ? "⚠️  MODER" : "✓ ok";
    console.log(
      `  ${flag}  ${s.pace.padEnd(35)} max|r|=${s.maxAbs.toFixed(3)} vs ${s.maxPartner}`,
    );
    for (const t of s.top3) {
      console.log(
        `      ${t.base.padEnd(35)} r=${t.r >= 0 ? "+" : ""}${t.r.toFixed(3)}`,
      );
    }
  }

  const avg =
    summaries.reduce((s, x) => s + x.maxAbs, 0) / (summaries.length || 1);
  console.log(
    `\n📊 Média das correlações máximas: |r|=${avg.toFixed(3)} (< 0.5 é bom sinal — features carregam info nova)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
