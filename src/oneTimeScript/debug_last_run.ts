import dotenv from "dotenv";
dotenv.config();
import { supabase } from "..";

async function main() {
  console.log("=== Última predição por model_version ===");
  const models = ["v68-flat", "v67-flat", "v66-flat", "v65-flat", "v65-jump"];
  for (const m of models) {
    const { data } = await supabase
      .schema("hml")
      .from("prediction_enriched_horse_features")
      .select("generated_at")
      .eq("model_version", m)
      .order("generated_at", { ascending: false })
      .limit(1);
    console.log(`  ${m}: ${data?.[0]?.generated_at || "nunca"}`);
  }

  console.log("\n=== Última entrada em lay_betting_picks ===");
  const { data: last } = await supabase
    .schema("hml")
    .from("lay_betting_picks")
    .select("generated_at, model_version, race_date")
    .order("generated_at", { ascending: false })
    .limit(5);
  for (const p of last || []) {
    console.log(`  ${p.generated_at} (${p.model_version}, race_date=${p.race_date})`);
  }

  console.log("\n=== Última entrada em lay_betting_all_eligible ===");
  const { data: lastE } = await supabase
    .schema("hml")
    .from("lay_betting_all_eligible")
    .select("generated_at, model_version, race_date")
    .order("generated_at", { ascending: false })
    .limit(5);
  for (const p of lastE || []) {
    console.log(`  ${p.generated_at} (${p.model_version}, race_date=${p.race_date})`);
  }

  console.log("\n=== Corridas HOJE já finalizadas (checar resultados) ===");
  const { data: finished, count } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .select("id, course, off_time_br, finished", { count: "exact" })
    .eq("date", new Date().toISOString().slice(0, 10))
    .eq("finished", 1)
    .order("off_time_br");
  console.log(`  ${count} corridas finalizadas hoje`);
  for (const r of (finished || []).slice(0, 10)) {
    console.log(`    ${r.off_time_br} ${r.course} (id=${r.id})`);
  }

  console.log("\n=== Corridas de HOJE upcoming ===");
  const { data: upcoming, count: cU } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .select("id, course, off_time_br, finished, canceled, date", { count: "exact" })
    .eq("finished", 0)
    .eq("canceled", 0)
    .order("off_time_br");
  console.log(`  ${cU} upcoming`);
  for (const r of (upcoming || []).slice(0, 5)) {
    console.log(`    ${r.date} ${r.off_time_br} ${r.course} (id=${r.id})`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
