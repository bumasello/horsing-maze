// RULE 4: a dedução da casa é uma TABELA; a exchange reprecifica de verdade.
// Método C3 do mapa (§1), marcado 🟡 "exige execução em minutos, não temos infra".
// Não precisa de infra pra MEDIR — a tabela é pública e determinística.
//
// A TESE, em álgebra (verificada antes de codar):
//   Cavalo retirado com prob implícita p. O ajuste JUSTO é sobre o RETORNO:
//   odd nova = O*(1-p). A Tattersalls deduz d≈p dos GANHOS: lucro = (O-1)(1-d).
//   Folga = p/(O-1) por unidade de ganho, ou ~q*p por unidade de STAKE.
//   → a tabela é sistematicamente GENEROSA com quem apostou, e muito mais
//     em favorito (q alto) que em azarão.
//
// ⚠️ CONTAMINAÇÃO (ver docs/contaminacao_dados.md §10)
//   `non_runner` é 🔴 pra SELEÇÃO. Aqui ele NÃO seleciona nada: o universo é
//   "todo cavalo com preço de manhã", inclusive os que seriam retirados. O
//   retirado tem o stake DEVOLVIDO (void), que é o que acontece na vida real.
//   Foi exatamente filtrar por ele que fabricou a arbitragem falsa.
//
//   ⚠️ A tabela R4 usa o preço do retirado NO MOMENTO DA RETIRADA. Não temos
//   esse carimbo — usamos o preço de MANHÃ dele. Aproximação declarada: se o
//   cavalo encurtou até ser retirado, subestimamos a dedução (otimista).
//
// Uso: NO_CRON=1 BSP_DIR=... npx ts-node src/oneTimeScript/rule4_probe.ts
import dotenv from "dotenv"; dotenv.config();
import fs from "node:fs"; import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const FROM = process.env.FROM || "2026-03-16";
const TO = process.env.TO || "2026-08-18";
const B = Number(process.env.B || 2000);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string, { db: { schema: "hml" } });
const norm = (s: string) => s.toLowerCase().replace(/\([a-z]{2,3}\)/g, "").replace(/[^a-z0-9]/g, "");

// Tabela Tattersalls Rule 4: dedução dos GANHOS pela odd decimal do retirado.
const R4: [number, number][] = [
  [1.111, 0.90], [1.182, 0.85], [1.25, 0.80], [1.30, 0.75], [1.40, 0.70],
  [1.533, 0.65], [1.615, 0.60], [1.80, 0.55], [1.952, 0.50], [2.20, 0.45],
  [2.50, 0.40], [2.75, 0.35], [3.25, 0.30], [4.00, 0.25], [5.00, 0.20],
  [6.50, 0.15], [10.0, 0.10], [15.0, 0.05],
];
function r4Deduction(oddRetirado: number): number {
  for (const [lim, d] of R4) if (oddRetirado <= lim) return d;
  return 0; // acima de 14/1 não há dedução
}

interface Bet {
  race: string; date: string; won: boolean; odd: number;
  ded: number;      // dedução R4 total aplicada (já capada)
  voided: boolean;  // o próprio cavalo foi retirado → stake devolvido
  nWd: number;      // retiradas na corrida
}

const pct = (x: number) => `${x.toFixed(2)}%`;

function boot(rows: Bet[], fn: (r: Bet[]) => number): [number, number] {
  const m = new Map<string, Bet[]>();
  for (const r of rows) { if (!m.has(r.race)) m.set(r.race, []); m.get(r.race)!.push(r); }
  const g = [...m.values()]; const o: number[] = [];
  for (let b = 0; b < B; b++) {
    const s: Bet[] = [];
    for (let i = 0; i < g.length; i++) s.push(...g[(Math.random() * g.length) | 0]);
    o.push(fn(s));
  }
  o.sort((a, b2) => a - b2);
  return [o[Math.floor(0.025 * B)], o[Math.floor(0.975 * B)]];
}

async function main() {
  console.log("\n📕 RULE 4 — a tabela da casa vs o ajuste justo\n");
  const outcome = new Map<string, { won: boolean; race: string; date: string }>();
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".csv"))) {
    if (/place/i.test(f)) continue;
    for (const line of fs.readFileSync(path.join(DIR, f), "utf8").split("\n").slice(1)) {
      const c = line.split(","); if (c.length < 17 || !(+c[7] > 0)) continue;
      const dm = c[3].match(/(\d{2})-(\d{2})-(\d{4})/); if (!dm) continue;
      const date = `${dm[3]}-${dm[2]}-${dm[1]}`; if (date < FROM || date > TO) continue;
      outcome.set(`${date}|${norm(c[5])}`, { won: +c[6] === 1, race: `${c[1]}|${c[3]}`, date });
    }
  }
  console.log(`  desfechos nos CSVs: ${outcome.size}`);

  const rc: any[] = [];
  for (let p = 0; ; p++) {
    const { data } = await db.from("racecards_hr_enriched").select("id,date")
      .gte("date", FROM).lte("date", TO).order("id").range(p * 1000, p * 1000 + 999);
    if (!data?.length) break; rc.push(...data); if (data.length < 1000) break;
  }
  const dateOf = new Map(rc.map((r: any) => [r.id, r.date]));
  // TODOS os cavalos, inclusive non_runner — o universo não pode ser filtrado por ele
  const horses: { id: number; rcid: number; key: string; nr: boolean }[] = [];
  const ids = rc.map((r: any) => r.id);
  for (let i = 0; i < ids.length; i += 150) {
    const ch = ids.slice(i, i + 150);
    for (let off = 0; ; off += 1000) {
      const { data } = await db.from("race_horses_hr_enriched")
        .select("id,racecard_id,horse,non_runner").in("racecard_id", ch).range(off, off + 999);
      if (!data?.length) break;
      for (const r of data as any[]) {
        const d = dateOf.get(r.racecard_id); if (!d) continue;
        horses.push({ id: r.id, rcid: r.racecard_id, key: `${d}|${norm(r.horse)}`, nr: !!r.non_runner });
      }
      if (data.length < 1000) break;
    }
  }
  const best = new Map<number, number>();
  for (let p = 0; ; p++) {
    const { data } = await db.from("odds_enriched").select("race_horse_id,odd")
      .order("id").range(p * 1000, p * 1000 + 999);
    if (!data?.length) break;
    for (const r of data as any[]) {
      if (!(r.odd > 1)) continue;
      const cur = best.get(r.race_horse_id);
      if (cur === undefined || r.odd > cur) best.set(r.race_horse_id, r.odd);
    }
    if (data.length < 1000) break;
  }

  // dedução total por racecard: soma dos R4 dos retirados que TINHAM preço
  const dedOf = new Map<number, number>(); const wdOf = new Map<number, number>();
  for (const h of horses) {
    if (!h.nr) continue;
    const o = best.get(h.id); if (o === undefined) continue;
    dedOf.set(h.rcid, (dedOf.get(h.rcid) || 0) + r4Deduction(o));
    wdOf.set(h.rcid, (wdOf.get(h.rcid) || 0) + 1);
  }

  const bets: Bet[] = [];
  for (const h of horses) {
    const o = best.get(h.id); if (o === undefined) continue;
    const oc = outcome.get(h.key);
    // retirado: não está no CSV; stake devolvido
    if (h.nr) {
      bets.push({ race: `RC${h.rcid}`, date: dateOf.get(h.rcid)!, won: false, odd: o,
                  ded: 0, voided: true, nWd: wdOf.get(h.rcid) || 0 });
      continue;
    }
    if (!oc) continue;
    bets.push({ race: oc.race, date: oc.date, won: oc.won, odd: o,
                ded: Math.min(dedOf.get(h.rcid) || 0, 0.90),
                voided: false, nWd: wdOf.get(h.rcid) || 0 });
  }
  const live = bets.filter((b) => !b.voided);
  console.log(`  apostas simuladas: ${bets.length} (${bets.length - live.length} anuladas por retirada)`);
  console.log(`  corridas: ${new Set(live.map((b) => b.race)).size}\n`);

  // ROI COM e SEM aplicar R4. Stake devolvido não conta no denominador (aposta anulada).
  const roiR4 = (rr: Bet[]) => {
    let s = 0, n = 0;
    for (const b of rr) { if (b.voided) continue; n++; s += b.won ? (b.odd - 1) * (1 - b.ded) : -1; }
    return n ? (100 * s) / n : NaN;
  };
  const roiNo = (rr: Bet[]) => {
    let s = 0, n = 0;
    for (const b of rr) { if (b.voided) continue; n++; s += b.won ? b.odd - 1 : -1; }
    return n ? (100 * s) / n : NaN;
  };
  // ajuste JUSTO: odd nova = O*(1-p_total). p_total ≈ soma das probs implícitas dos retirados.
  const roiFair = (rr: Bet[]) => {
    let s = 0, n = 0;
    for (const b of rr) { if (b.voided) continue; n++; s += b.won ? b.odd * (1 - b.ded) - 1 : -1; }
    return n ? (100 * s) / n : NaN;
  };

  const cells: [string, (b: Bet) => boolean][] = [
    ["TODOS", () => true],
    ["só corridas c/ retirada", (b) => b.nWd > 0],
    ["  odd [1,3)", (b) => b.nWd > 0 && b.odd < 3],
    ["  odd [3,6)", (b) => b.nWd > 0 && b.odd >= 3 && b.odd < 6],
    ["  odd [6,12)", (b) => b.nWd > 0 && b.odd >= 6 && b.odd < 12],
    ["  odd [12,+)", (b) => b.nWd > 0 && b.odd >= 12],
    ["sem retirada", (b) => b.nWd === 0],
  ];
  console.log(`  ${"célula".padEnd(26)} ${"n".padStart(6)} ${"ROI c/ R4".padStart(10)} ${"IC95".padStart(20)} ${"s/ dedução".padStart(11)} ${"dedução JUSTA".padStart(14)}`);
  for (const [lab, sel] of cells) {
    const rr = live.filter(sel);
    if (rr.length < 200) { console.log(`  ${lab.padEnd(26)} ${String(rr.length).padStart(6)}  (amostra insuficiente)`); continue; }
    const [lo, hi] = boot(rr, roiR4);
    console.log(
      `  ${lab.padEnd(26)} ${String(rr.length).padStart(6)} ${pct(roiR4(rr)).padStart(10)} ` +
      `[${lo.toFixed(2)}, ${hi.toFixed(2)}]`.padEnd(21) +
      ` ${pct(roiNo(rr)).padStart(11)} ${pct(roiFair(rr)).padStart(14)}${lo > 0 ? " ✅" : ""}`,
    );
  }
  const wd = live.filter((b) => b.nWd > 0);
  console.log(`\n  ── quanto a folga da tabela vale ──`);
  console.log(`  ROI com a dedução REAL da casa (R4) ....... ${pct(roiR4(wd))}`);
  console.log(`  ROI com a dedução JUSTA (sobre o retorno) . ${pct(roiFair(wd))}`);
  console.log(`  folga capturada pela tabela ............... ${pct(roiR4(wd) - roiFair(wd))} por aposta`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
