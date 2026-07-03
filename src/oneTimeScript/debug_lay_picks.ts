import dotenv from "dotenv";
dotenv.config();
import { supabase } from "..";

async function main() {
  console.log("=== 1. Racecards upcoming ===");
  const { count: upcoming, error: e1 } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .select("*", { count: "exact", head: true })
    .eq("finished", 0)
    .eq("canceled", 0);
  if (e1) console.error("  err:", e1.message);
  console.log(`  upcoming: ${upcoming}`);

  console.log("\n=== 2. Predições na última hora ===");
  const { data: preds, error: e2 } = await supabase
    .schema("hml")
    .from("prediction_enriched_horse_features")
    .select("model_version, generated_at")
    .gte("generated_at", new Date(Date.now() - 3600_000).toISOString())
    .order("generated_at", { ascending: false })
    .limit(500);
  if (e2) console.error("  err:", e2.message);
  const byVersion = new Map<string, { count: number; last: string }>();
  for (const p of preds || []) {
    const cur = byVersion.get(p.model_version) || { count: 0, last: "" };
    cur.count++;
    if (!cur.last || p.generated_at > cur.last) cur.last = p.generated_at;
    byVersion.set(p.model_version, cur);
  }
  if (byVersion.size === 0) console.log("  Nenhuma predição na última hora.");
  else {
    for (const [v, info] of byVersion) {
      console.log(`  ${v}: ${info.count} predições, última=${info.last}`);
    }
  }

  console.log("\n=== 3. lay_betting_all_eligible últimas 24h ===");
  const { data: elig, error: e3 } = await supabase
    .schema("hml")
    .from("lay_betting_all_eligible")
    .select("model_version, generated_at, pick_rank_in_race")
    .gte("generated_at", new Date(Date.now() - 86400_000).toISOString())
    .order("generated_at", { ascending: false })
    .limit(500);
  if (e3) console.error("  err:", e3.message);
  console.log(`  registros=${elig?.length || 0}`);
  if (elig && elig.length > 0) {
    const models = new Set(elig.map((e: any) => e.model_version));
    const maxRank = Math.max(...elig.map((e: any) => e.pick_rank_in_race));
    console.log(`  models: [${Array.from(models).join(", ")}]`);
    console.log(`  max_rank: ${maxRank}`);
    console.log(`  última: ${elig[0].generated_at}`);
  }

  console.log("\n=== 4. lay_betting_picks (main pick) últimas 24h ===");
  const { data: main, error: e4 } = await supabase
    .schema("hml")
    .from("lay_betting_picks")
    .select("model_version, generated_at, race_date")
    .gte("generated_at", new Date(Date.now() - 86400_000).toISOString())
    .order("generated_at", { ascending: false })
    .limit(50);
  if (e4) console.error("  err:", e4.message);
  console.log(`  registros=${main?.length || 0}`);
  if (main && main.length > 0) {
    console.log(`  última: ${main[0].generated_at} (race_date=${main[0].race_date})`);
    console.log(`  model: ${main[0].model_version}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
