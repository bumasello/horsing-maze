// Quantas vezes o FAVORITO do mercado venceu vs quantas vezes o TOP do MODELO venceu,
// nas MESMAS corridas, com as predições reais gravadas em produção.
// Uso: NO_CRON=1 npx ts-node src/oneTimeScript/fav_vs_model_top.ts
import dotenv from "dotenv"; dotenv.config();
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
(async () => {
  const preds: any[] = [];
  for (const schema of ["prd", "hml"]) {
    const db = createClient(url, key, { db: { schema } });
    for (let p = 0; ; p++) {
      const { data, error } = await db.from("prediction_enriched_horse_features")
        .select("race_horse_id,race_id,predicted_probability,race_date,model_version")
        .order("id").range(p * 1000, p * 1000 + 999);
      if (error) throw error; if (!data?.length) break;
      for (const r of data as any[]) preds.push({ ...r, schema });
      if (data.length < 1000) break;
    }
  }
  console.log(`predições com desfecho: ${preds.length}`);
  const hml = createClient(url, key, { db: { schema: "hml" } });
  const ids = [...new Set(preds.map((p) => p.race_horse_id))];
  const sp = new Map<number, number>(); const pos = new Map<number, number>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await hml.from("race_horses_hr_enriched").select("id,sp_decimal,position,non_runner").in("id", ids.slice(i, i + 300));
    if (error) throw error;
    for (const r of data as any[]) { if (r.non_runner) continue; if (r.sp_decimal > 1) sp.set(r.id, r.sp_decimal); const q = Number(r.position); if (q > 0) pos.set(r.id, q); }
  }
  for (const p of preds) p.actual_position = pos.get(p.race_horse_id) ?? null;
  console.log(`com desfecho (position) e SP: ${preds.filter((p) => p.actual_position && sp.has(p.race_horse_id)).length}`);
  // dedupe (mesma corrida pode estar em prd e hml, e em várias versões): fica a última versão por race_horse
  const byRace = new Map<string, any[]>();
  const seen = new Set<string>();
  for (const p of preds.sort((a, b) => String(a.model_version).localeCompare(String(b.model_version)))) {
    const k = `${p.race_id}|${p.race_horse_id}`; if (seen.has(k)) continue; seen.add(k);
    if (!sp.has(p.race_horse_id) || !p.actual_position) continue;
    if (!byRace.has(p.race_id)) byRace.set(p.race_id, []);
    byRace.get(p.race_id)!.push(p);
  }
  let n = 0, favWon = 0, modWon = 0, agree = 0, agreeWon = 0, disFavWon = 0, disModWon = 0, dis = 0;
  const byYear = new Map<string, { n: number; f: number; m: number }>();
  for (const [, rr] of byRace) {
    if (rr.length < 5) continue;
    const fav = rr.reduce((a, b) => (sp.get(b.race_horse_id)! < sp.get(a.race_horse_id)! ? b : a));
    // predicted_probability = P(perder) → top do modelo = MENOR
    const top = rr.reduce((a, b) => (b.predicted_probability < a.predicted_probability ? b : a));
    n++;
    const fw = Number(fav.actual_position) === 1, mw = Number(top.actual_position) === 1;
    if (fw) favWon++; if (mw) modWon++;
    if (fav.race_horse_id === top.race_horse_id) { agree++; if (fw) agreeWon++; }
    else { dis++; if (fw) disFavWon++; if (mw) disModWon++; }
    const y = String(rr[0].race_date).slice(0, 7); const b = byYear.get(y) || { n: 0, f: 0, m: 0 };
    b.n++; b.f += fw ? 1 : 0; b.m += mw ? 1 : 0; byYear.set(y, b);
  }
  const pc = (a: number, b: number) => `${(100 * a / Math.max(b, 1)).toFixed(1)}%`;
  console.log(`\ncorridas com predição + SP (≥5 cavalos): ${n}\n`);
  console.log(`  favorito do MERCADO (menor SP) venceu ...... ${favWon} (${pc(favWon, n)})`);
  console.log(`  top do MODELO (maior P(win)) venceu ........ ${modWon} (${pc(modWon, n)})`);
  console.log(`\n  modelo e mercado escolhem o MESMO cavalo em ${agree} corridas (${pc(agree, n)}) → vence ${pc(agreeWon, agree)}`);
  console.log(`  quando DISCORDAM (${dis} corridas): favorito do mercado vence ${pc(disFavWon, dis)} · top do modelo vence ${pc(disModWon, dis)}`);
  console.log(`\n  por mês:  mês       n   mercado   modelo`);
  for (const [y, b] of [...byYear].sort()) console.log(`            ${y}  ${String(b.n).padStart(4)}   ${pc(b.f, b.n).padStart(6)}   ${pc(b.m, b.n).padStart(6)}`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
