import dotenv from "dotenv"; dotenv.config();
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
(async () => {
  const preds: any[] = [];
  for (const schema of ["prd", "hml"]) {
    const db = createClient(url, key, { db: { schema } });
    for (let p = 0; ; p++) {
      const { data, error } = await db.from("prediction_enriched_horse_features").select("race_horse_id,race_id,predicted_probability,race_date,model_version,generated_at,prediction_status").order("id").range(p * 1000, p * 1000 + 999);
      if (error) throw error; if (!data?.length) break; for (const r of data as any[]) preds.push({ ...r, schema }); if (data.length < 1000) break;
    }
  }
  const hml = createClient(url, key, { db: { schema: "hml" } });
  const ids = [...new Set(preds.map((p) => p.race_horse_id))]; const sp = new Map<number, number>(), pos = new Map<number, number>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await hml.from("race_horses_hr_enriched").select("id,sp_decimal,position,non_runner").in("id", ids.slice(i, i + 300));
    for (const r of data as any[]) { if (r.non_runner) continue; if (r.sp_decimal > 1) sp.set(r.id, r.sp_decimal); const q = Number(r.position); if (q > 0) pos.set(r.id, q); }
  }
  type Agg = { n: number; races: Map<string, any[]>; sumP: number; xy: number; xx: number; yy: number; nx: number; sx: number; sy: number; first: string; last: string };
  const byV = new Map<string, Agg>();
  for (const p of preds) {
    const s = sp.get(p.race_horse_id); if (!s || !pos.has(p.race_horse_id)) continue;
    const v = `${p.schema}:${p.model_version}`; const a = byV.get(v) || { n: 0, races: new Map(), sumP: 0, xy: 0, xx: 0, yy: 0, nx: 0, sx: 0, sy: 0, first: p.race_date, last: p.race_date };
    a.n++; a.sumP += p.predicted_probability; const x = Math.log(s), y = p.predicted_probability; a.nx++; a.sx += x; a.sy += y; a.xy += x * y; a.xx += x * x; a.yy += y * y;
    if (p.race_date < a.first) a.first = p.race_date; if (p.race_date > a.last) a.last = p.race_date;
    if (!a.races.has(p.race_id)) a.races.set(p.race_id, []); a.races.get(p.race_id)!.push({ ...p, sp: s, pos: pos.get(p.race_horse_id) });
    byV.set(v, a);
  }
  console.log(`versão                          n      janela                 média P   corr(logSP,P)   MIN-P vence   MAX-P vence   fav-SP vence`);
  for (const [v, a] of [...byV].sort((x, y) => x[1].first.localeCompare(y[1].first))) {
    const mx = a.sx / a.nx, my = a.sy / a.nx; const corr = (a.xy / a.nx - mx * my) / Math.sqrt((a.xx / a.nx - mx * mx) * (a.yy / a.nx - my * my));
    let nr = 0, minW = 0, maxW = 0, favW = 0;
    for (const [, rr] of a.races) { if (rr.length < 5) continue; nr++;
      const mn = rr.reduce((p: any, q: any) => (q.predicted_probability < p.predicted_probability ? q : p)); const mxr = rr.reduce((p: any, q: any) => (q.predicted_probability > p.predicted_probability ? q : p)); const fv = rr.reduce((p: any, q: any) => (q.sp < p.sp ? q : p));
      if (mn.pos === 1) minW++; if (mxr.pos === 1) maxW++; if (fv.pos === 1) favW++; }
    const pc = (k: number) => nr ? `${(100 * k / nr).toFixed(1)}%` : "—";
    console.log(`${v.padEnd(30)} ${String(a.n).padStart(6)}  ${a.first} → ${a.last}   ${(a.sumP / a.n).toFixed(3)}     ${corr.toFixed(3).padStart(6)}        ${pc(minW).padStart(6)}        ${pc(maxW).padStart(6)}        ${pc(favW).padStart(6)}   (${nr} corridas)`);
  }
  console.log("\nSe P = P(perder): corr(logSP,P) > 0 e MIN-P deveria vencer ≈ fav-SP. Se corr < 0 ou MAX-P vence mais, o sinal está INVERTIDO nessa versão.");
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
