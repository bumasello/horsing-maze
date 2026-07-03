// Avalia parser de run_style contra amostra real do DB.
// Mede % de comments classificados em E/EP/P/S vs unknown.
//
// Roda: nvm use 20 && npx ts-node src/oneTimeScript/eval_parser_coverage.ts

import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import { parseRunStyle } from "../services/features/converters/comment.converter";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
);

async function main() {
  console.log("📥 baixando amostra de 10k comments do rpscrape_results...");

  const pageSize = 1000;
  const sampleTarget = 10000;
  const samples: string[] = [];
  let page = 0;

  while (samples.length < sampleTarget) {
    const { data, error } = await supabase
      .schema("hml")
      .from("rpscrape_results")
      .select("comment")
      .not("comment", "is", null)
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (row.comment && row.comment.length > 5) samples.push(row.comment);
      if (samples.length >= sampleTarget) break;
    }
    page++;
    if (data.length < pageSize) break;
  }

  console.log(`✅ ${samples.length} comments coletados\n`);

  const counts: Record<string, number> = { E: 0, EP: 0, P: 0, S: 0, unknown: 0 };
  for (const c of samples) {
    counts[parseRunStyle(c)]++;
  }

  const total = samples.length;
  console.log("=== distribuição ===");
  for (const k of ["E", "EP", "P", "S", "unknown"] as const) {
    const pct = ((counts[k] / total) * 100).toFixed(1);
    console.log(`  ${k.padEnd(8)} → ${counts[k]} (${pct}%)`);
  }

  // Amostra de comments "unknown" pra debug
  console.log("\n=== amostra dos 'unknown' (10 primeiros) ===");
  const unknowns = samples.filter((c) => parseRunStyle(c) === "unknown");
  for (let i = 0; i < Math.min(10, unknowns.length); i++) {
    console.log(`  "${unknowns[i].substring(0, 90)}"`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
