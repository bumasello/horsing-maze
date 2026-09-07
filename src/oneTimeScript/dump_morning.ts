// Dump "estado das 04:00": going declarado no racecard + melhor preço de manhã por cavalo.
// Uso: NO_CRON=1 npx ts-node src/oneTimeScript/dump_morning.ts → /tmp/morning.jsonl
import dotenv from "dotenv"; dotenv.config();
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string, { db: { schema: "hml" } });
(async () => {
  const rc = new Map<number, any>();
  for (let p = 0; ; p++) {
    const { data, error } = await db.from("racecards_hr_enriched").select("id,date,course,off_time_uk,going,race_type,surface")
      .gte("date", "2024-01-01").order("id").range(p * 1000, p * 1000 + 999);
    if (error) throw error; if (!data?.length) break;
    for (const r of data as any[]) rc.set(r.id, r);
    if (data.length < 1000) break;
  }
  console.log(`racecards: ${rc.size}`);
  const best = new Map<number, number>();
  for (let p = 0; ; p++) {
    const { data, error } = await db.from("odds_enriched").select("race_horse_id,odd").order("id").range(p * 1000, p * 1000 + 999);
    if (error) throw error; if (!data?.length) break;
    for (const r of data as any[]) { if (r.odd > 1) { const c = best.get(r.race_horse_id); if (c === undefined || r.odd > c) best.set(r.race_horse_id, r.odd); } }
    if (data.length < 1000) break;
  }
  console.log(`odds: ${best.size} cavalos com preço de manhã`);
  const out = fs.createWriteStream("/tmp/morning.jsonl"); let n = 0;
  const ids = [...rc.keys()];
  for (let i = 0; i < ids.length; i += 150) {
    const ch = ids.slice(i, i + 150);
    for (let off = 0; ; off += 1000) {
      const { data, error } = await db.from("race_horses_hr_enriched").select("id,racecard_id,horse,non_runner,sp_decimal").in("racecard_id", ch).range(off, off + 999);
      if (error) throw error; if (!data?.length) break;
      for (const h of data as any[]) {
        const r = rc.get(h.racecard_id); if (!r) continue;
        out.write(JSON.stringify({ date: r.date, course: r.course, time: r.off_time_uk, going_am: r.going, race_type: r.race_type, surface: r.surface,
          rcid: r.id, horse: h.horse, nr: !!h.non_runner, sp: h.sp_decimal, best: best.get(h.id) ?? null }) + "\n"); n++;
      }
      if (data.length < 1000) break;
    }
  }
  out.end(); console.log(`FIM: ${n} linhas → /tmp/morning.jsonl`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
