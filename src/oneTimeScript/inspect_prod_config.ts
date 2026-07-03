import dotenv from "dotenv";
dotenv.config();
import { supabase } from "..";
import type { ModelConfig } from "../shared/types/ml.types";

async function main() {
  const { data, error } = await supabase.storage
    .from("modelos-tfjs-publicos")
    .download("horse_probability_model/claude-ml-model-flat/config.json");
  if (error || !data) throw new Error(error?.message);
  const config = JSON.parse(await data.text()) as ModelConfig;
  console.log(`Version: v${config.version}`);
  console.log(`Features (${config.features.length}):`);
  for (const f of config.features) console.log(`  - ${f}`);
  const paceFeats = config.features.filter(
    (f) =>
      f.includes("pace") ||
      f.includes("run_style") ||
      f.includes("ovr_btn") ||
      f.includes("rpr_max") ||
      f.includes("ts_avg") ||
      f.includes("secs_per_furlong") ||
      f.includes("rpscrape_coverage") ||
      f.includes("lone_speed") ||
      f.includes("field_count_"),
  );
  console.log(`\nPace-related features: ${paceFeats.length}`);
  paceFeats.forEach((f) => console.log(`  ★ ${f}`));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
