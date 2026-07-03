import dotenv from "dotenv";
dotenv.config();
import { supabase } from "..";

async function main() {
  console.log("=== lay_betting_picks das últimas 24h — separado por model ===");
  const { data, error } = await supabase
    .schema("hml")
    .from("lay_betting_picks")
    .select("model_version, race_date, generated_at")
    .gte("generated_at", new Date(Date.now() - 86400_000).toISOString())
    .order("generated_at", { ascending: false })
    .limit(200);
  if (error) console.error(error.message);
  const byVer = new Map<string, number>();
  for (const p of data || []) {
    byVer.set(p.model_version, (byVer.get(p.model_version) || 0) + 1);
  }
  for (const [v, c] of byVer) console.log(`  ${v}: ${c}`);

  console.log("\n=== Predições v68-flat últimas 30min — verificar odd distribution ===");
  // pegar as race_horse_ids das predições recentes de v68-flat + odd real
  const { data: preds, error: e2 } = await supabase
    .schema("hml")
    .from("prediction_enriched_horse_features")
    .select("race_horse_id, predicted_probability")
    .eq("model_version", "v68-flat")
    .gte("generated_at", new Date(Date.now() - 1800_000).toISOString())
    .order("predicted_probability", { ascending: false })
    .limit(500);
  if (e2) console.error(e2.message);
  const rhIds = (preds || []).map((p: any) => p.race_horse_id);
  console.log(`  predições v68-flat: ${rhIds.length}`);

  // buscar sp_decimal pra esses
  const { data: horses } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select("id, sp_decimal, non_runner")
    .in("id", rhIds);

  const spMap = new Map<number, number | null>();
  const nrCount = new Map<number, number>();
  let hasSp = 0;
  let nonRunner = 0;
  const buckets = { "<4": 0, "4-13": 0, "13-20": 0, ">20": 0, "sem odd": 0 };
  for (const h of horses || []) {
    if (h.non_runner === 1) nonRunner++;
    if (h.sp_decimal !== null && h.sp_decimal !== undefined) {
      hasSp++;
      const sp = Number(h.sp_decimal);
      if (sp < 4) buckets["<4"]++;
      else if (sp <= 13) buckets["4-13"]++;
      else if (sp <= 20) buckets["13-20"]++;
      else buckets[">20"]++;
    } else {
      buckets["sem odd"]++;
    }
    spMap.set(h.id, h.sp_decimal !== null ? Number(h.sp_decimal) : null);
  }
  console.log(`  horses c/ sp_decimal: ${hasSp} / ${horses?.length}`);
  console.log(`  horses non_runner: ${nonRunner}`);
  console.log(`  buckets de odd:`);
  for (const [k, v] of Object.entries(buckets)) console.log(`    ${k}: ${v}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
