import dotenv from "dotenv";
dotenv.config();
import { supabase } from "..";

async function main() {
  console.log("=== v68-flat: main picks (últimas 24h) — odds usadas ===");
  const { data: picks, error } = await supabase
    .schema("hml")
    .from("lay_betting_picks")
    .select(
      "race_horse_id, race_date, horse_name, market_odd, predicted_probability, ivl_score, generated_at",
    )
    .eq("model_version", "v68-flat")
    .order("generated_at", { ascending: false })
    .limit(50);
  if (error) console.error(error.message);
  console.log(`  ${picks?.length || 0} picks`);
  for (const p of picks || []) {
    console.log(
      `  ${p.race_date} ${p.horse_name?.padEnd(25)} odd=${p.market_odd} P(lose)=${Number(p.predicted_probability).toFixed(3)} IVL=${Number(p.ivl_score).toFixed(3)}`,
    );
  }

  console.log("\n=== v68-flat: top-3 picks (últimas 24h) — ver spread de odds e P(lose) ===");
  const { data: top3, error: e2 } = await supabase
    .schema("hml")
    .from("lay_betting_top_picks")
    .select("racecard_id, pick_rank, market_odd, predicted_probability, horse_name")
    .eq("model_version", "v68-flat")
    .order("racecard_id", { ascending: false })
    .order("pick_rank", { ascending: true })
    .limit(50);
  if (e2) console.error(e2.message);
  console.log(`  ${top3?.length || 0} registros top-3`);
  let lastRacecard = -1;
  for (const r of top3 || []) {
    if (r.racecard_id !== lastRacecard) {
      console.log(`  racecard ${r.racecard_id}:`);
      lastRacecard = r.racecard_id;
    }
    console.log(
      `    rank=${r.pick_rank} odd=${r.market_odd} P(lose)=${Number(r.predicted_probability).toFixed(3)} ${r.horse_name}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
