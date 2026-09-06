// Dump do rpscrape_results (só colunas PRÉ-corrida + desfecho) pra JSONL local.
// Uso: NO_CRON=1 npx ts-node src/oneTimeScript/dump_rpscrape.ts  → /tmp/rpscrape.jsonl
import dotenv from "dotenv"; dotenv.config();
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string, { db: { schema: "hml" } });
const COLS = "id,race_date,course,off_time,horse_name,region,race_type,race_class,dist_f,going,ran,pos,age,sex,lbs,hg,draw,dec_odds,jockey,trainer,or_rating,pattern";
(async () => {
  const out = fs.createWriteStream("/tmp/rpscrape.jsonl");
  let last = 0, n = 0;
  for (;;) {
    const { data, error } = await db.from("rpscrape_results").select(COLS).gt("id", last).order("id").limit(1000);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data as any[]) { out.write(JSON.stringify(r) + "\n"); last = r.id; }
    n += data.length;
    if (n % 50000 === 0) console.log(`  ${n} linhas...`);
    if (data.length < 1000) break;
  }
  out.end(); console.log(`FIM: ${n} linhas → /tmp/rpscrape.jsonl`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
