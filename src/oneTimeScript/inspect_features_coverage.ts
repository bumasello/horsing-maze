// Verifica se as pace features estão presentes no JSON de features dos horses v5.0.

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

async function main() {
  const { data, error } = await supabase
    .schema("hml")
    .from("training_enriched_horse_features")
    .select("features")
    .eq("race_type", "Flat")
    .eq("model_version", "v5.0")
    .gte("quality_score", 0.7)
    .limit(500);

  if (error) throw error;
  if (!data || data.length === 0) {
    console.log("Sem dados");
    return;
  }

  console.log(`Amostra: ${data.length} horses\n`);

  for (const feat of PACE_FEATURES) {
    let present = 0;
    let nonZero = 0;
    let nonDefault = 0;
    for (const row of data) {
      const f = row.features?.[feat];
      if (f !== null && f !== undefined) {
        present++;
        if (f !== 0) nonZero++;
        // valor default do DEFAULT_PACE — vale conferir manualmente
        if (typeof f === "number" && f !== 0 && f !== 0.5) nonDefault++;
      }
    }
    const pctPresent = ((present / data.length) * 100).toFixed(1);
    const pctNonZero = ((nonZero / data.length) * 100).toFixed(1);
    const pctNonDefault = ((nonDefault / data.length) * 100).toFixed(1);
    console.log(
      `  ${feat.padEnd(35)} present=${pctPresent}%  non-zero=${pctNonZero}%  non-default=${pctNonDefault}%`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
