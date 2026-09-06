// SEM PREVISÃO NENHUMA: o livro de manhã das casas vs o desfecho real.
//
// POR QUE ESTE PROBE EXISTE
//   O encompassing test fechou o eixo "prever melhor que o preço". Mas o §0 do
//   mapa lista TRÊS coisas que quebram o eixo, e a terceira é "renda que não vem
//   de previsão". Este probe mede as duas formas dela que os dados já permitem,
//   e nenhuma usa modelo, feature ou probabilidade estimada.
//
//   Q1. ARBITRAGEM ENTRE CASAS (método B5 do mapa, ⚪ nunca testado).
//       `odds_enriched` traz o preço de N casas na MESMA foto (~04:04 UTC).
//       Se o overround do livro "melhor preço de cada cavalo entre as casas"
//       cair abaixo de 1, dá pra cobrir todos os cavalos e travar lucro. Isso
//       é aritmética, não aposta: não depende de acertar nada.
//
//   Q2. BOG COMO OPÇÃO GRÁTIS (método C2 do mapa, 🟡 nunca medido sozinho).
//       Com Best Odds Guaranteed o preço efetivo é max(preço tomado, SP) — a
//       casa te dá o melhor dos dois de graça. Pegando o MELHOR preço de manhã
//       entre as casas, a pergunta é se a opção cobre a margem da casa.
//       (BOG confirmado em 37/37 corridas na Paddy Power — ver §11 do mapa.)
//
// HONESTIDADE
//   * Preço de manhã = foto única por casa, anterior à corrida. Sem look-ahead:
//     é literalmente o que estaria na tela na hora de apostar.
//   * Desfecho e BSP vêm dos CSVs da Betfair. SP vem de sp_decimal.
//   * O overround SÓ é calculado em corrida com preço pra TODOS os corredores.
//     Livro parcial daria overround artificialmente baixo — seria arb falsa.
//   * Cluster bootstrap por corrida, e split FIT/HELD.
//
// Uso: NO_CRON=1 BSP_DIR=... npx ts-node src/oneTimeScript/bog_value_probe.ts
import dotenv from "dotenv";
dotenv.config();
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const FROM = process.env.FROM || "2026-03-16";
const TO = process.env.TO || "2026-08-18";
const SPLIT = process.env.SPLIT || "2026-06-01";
const B = Number(process.env.B || 2000);
const COMM = Number(process.env.COMMISSION_RATE || 0); // casa não cobra comissão

const db = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL as string,
	process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
	{ db: { schema: process.env.SCH || "hml" } },
);
const norm = (s: string) =>
	s.toLowerCase().replace(/\([a-z]{2,3}\)/g, "").replace(/[^a-z0-9]/g, "");

interface Out { won: boolean; race: string; date: string; bsp: number; mw: number; mvol: number }

// fieldOf: nº REAL de corredores por corrida, contado no próprio CSV da Betfair.
// Contar pelo join seria circular: corrida em que metade dos nomes não casou
// pareceria "livro completo" com metade dos cavalos, e o overround sairia
// artificialmente baixo. Foi essa a primeira leitura, e estava errada.
const fieldOf = new Map<string, number>();

function loadCsv(): Map<string, Out> {
	const out = new Map<string, Out>();
	for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".csv"))) {
		if (/place/i.test(f)) continue; // só mercado de vitória
		for (const line of fs.readFileSync(path.join(DIR, f), "utf8").split("\n").slice(1)) {
			const c = line.split(",");
			if (c.length < 17) continue;
			if (!(+c[7] > 0)) continue;
			const dm = c[3].match(/(\d{2})-(\d{2})-(\d{4})/);
			if (!dm) continue;
			const date = `${dm[3]}-${dm[2]}-${dm[1]}`;
			if (date < FROM || date > TO) continue;
			const race = `${c[1]}|${c[3]}`;
			fieldOf.set(race, (fieldOf.get(race) || 0) + 1);
			out.set(`${date}|${norm(c[5])}`, {
				won: +c[6] === 1, race, date, bsp: +c[7], mw: +c[9] || 0, mvol: +c[14] || 0,
			});
		}
	}
	return out;
}

interface R {
	race: string; date: string; won: boolean;
	best: number; nBookies: number; sp: number; bsp: number; mw: number; mvol: number;
}

const pct = (x: number) => `${(100 * x).toFixed(2)}%`;

function bootstrap(rows: R[], fn: (rr: R[]) => number): [number, number] {
	const m = new Map<string, R[]>();
	for (const r of rows) {
		if (!m.has(r.race)) m.set(r.race, []);
		m.get(r.race)!.push(r);
	}
	const g = [...m.values()];
	const o: number[] = [];
	for (let b = 0; b < B; b++) {
		const s: R[] = [];
		for (let i = 0; i < g.length; i++) s.push(...g[(Math.random() * g.length) | 0]);
		o.push(fn(s));
	}
	o.sort((a, b2) => a - b2);
	return [o[Math.floor(0.025 * B)], o[Math.floor(0.975 * B)]];
}

async function main() {
	console.log("\n🎲 SEM PREVISÃO: livro de manhã das casas vs desfecho real\n");
	const csv = loadCsv();
	console.log(`  CSVs de vitória em [${FROM},${TO}]: ${csv.size} runners`);

	const rc: any[] = [];
	for (let p = 0; ; p++) {
		const { data, error } = await db.from("racecards_hr_enriched")
			.select("id,date").gte("date", FROM).lte("date", TO)
			.order("id").range(p * 1000, p * 1000 + 999);
		if (error) throw error;
		if (!data?.length) break;
		rc.push(...data);
		if (data.length < 1000) break;
	}
	const dateOf = new Map(rc.map((r: any) => [r.id, r.date]));
	const rh = new Map<number, { key: string; sp: number; rid: number }>();
	const ids = rc.map((r: any) => r.id);
	for (let i = 0; i < ids.length; i += 150) {
		const ch = ids.slice(i, i + 150);
		for (let off = 0; ; off += 1000) {
			const { data, error } = await db.from("race_horses_hr_enriched")
				.select("id,racecard_id,horse,sp_decimal,non_runner")
				.in("racecard_id", ch).range(off, off + 999);
			if (error) throw error;
			if (!data?.length) break;
			for (const r of data as any[]) {
				if (r.non_runner) continue;
				const d = dateOf.get(r.racecard_id);
				if (!d) continue;
				rh.set(r.id, { key: `${d}|${norm(r.horse)}`, sp: r.sp_decimal, rid: r.racecard_id });
			}
			if (data.length < 1000) break;
		}
	}

	// melhor preço de manhã entre as casas + quantas casas cotaram
	const best = new Map<number, number>();
	const nb = new Map<number, number>();
	for (let p = 0; ; p++) {
		const { data, error } = await db.from("odds_enriched")
			.select("race_horse_id,odd").order("id").range(p * 1000, p * 1000 + 999);
		if (error) throw error;
		if (!data?.length) break;
		for (const r of data as any[]) {
			if (!(r.odd > 1)) continue;
			nb.set(r.race_horse_id, (nb.get(r.race_horse_id) || 0) + 1);
			const cur = best.get(r.race_horse_id);
			if (cur === undefined || r.odd > cur) best.set(r.race_horse_id, r.odd);
		}
		if (data.length < 1000) break;
	}

	// runners com tudo: preço de manhã, SP, desfecho
	const rows: R[] = [];
	const perRace = new Map<string, { withPrice: number; total: number; inv: number }>();
	for (const [rhid, v] of rh) {
		const c = csv.get(v.key);
		if (!c) continue;
		const agg = perRace.get(c.race) || { withPrice: 0, total: 0, inv: 0 };
		agg.total++;
		const b = best.get(rhid);
		if (b !== undefined) {
			agg.withPrice++;
			agg.inv += 1 / b;
			rows.push({
				race: c.race, date: c.date, won: c.won, best: b,
				nBookies: nb.get(rhid) || 0, sp: v.sp > 1 ? v.sp : Number.NaN, bsp: c.bsp, mw: c.mw, mvol: c.mvol,
			});
		}
		perRace.set(c.race, agg);
	}
	console.log(`  runners com preço de manhã + desfecho: ${rows.length}`);
	console.log(`  corridas tocadas: ${perRace.size}\n`);
	if (rows.length < 500) { console.log("  amostra insuficiente"); return; }

	// ===== Q1. ARBITRAGEM: overround do livro "melhor de N casas" =====
	console.log("  ══ Q1. ARBITRAGEM ENTRE CASAS (livro completo, melhor preço de cada cavalo) ══");
	const full = [...perRace.entries()].filter(
		([race, a]) => (fieldOf.get(race) || 0) >= 3 && a.withPrice === fieldOf.get(race),
	);
	const joinOnly = [...perRace.entries()].filter(([, a]) => a.total >= 3 && a.withPrice === a.total);
	console.log(`  corridas com preço para todos os corredores DO JOIN: ${joinOnly.length} (medida ingênua)`);
	console.log(`  corridas com preço para todos os corredores REAIS (CSV): ${full.length} de ${perRace.size}`);
	if (full.length) {
		const ovs = full.map(([, a]) => a.inv).sort((a, b2) => a - b2);
		const q = (p: number) => ovs[Math.min(ovs.length - 1, Math.floor(p * ovs.length))];
		const arb = ovs.filter((x) => x < 1).length;
		console.log(`  overround: p05 ${q(0.05).toFixed(4)} · p25 ${q(0.25).toFixed(4)} · mediana ${q(0.5).toFixed(4)} · p75 ${q(0.75).toFixed(4)} · p95 ${q(0.95).toFixed(4)}`);
		console.log(`  corridas com overround < 1 (ARBITRAGEM PURA): ${arb} (${pct(arb / ovs.length)})`);
		if (arb > 0) {
			const lucros = ovs.filter((x) => x < 1).map((x) => 1 / x - 1);
			const med = lucros.sort((a, b2) => a - b2)[Math.floor(lucros.length / 2)];
			console.log(`  lucro travado mediano nessas: ${pct(med)}`);
		}
	}

	// ===== Q2. BOG como opção grátis =====
	console.log("\n  ══ Q2. BOG: back no melhor preço de manhã, efetivo = max(manhã, SP) ══");
	const wBog = rows.filter((r) => Number.isFinite(r.sp));
	console.log(`  runners com SP conhecido: ${wBog.length}`);
	const upl = wBog.filter((r) => r.best > r.sp).length;
	console.log(`  preço de manhã > SP em ${pct(upl / wBog.length)} dos casos\n`);

	const roiBog = (rr: R[]) => {
		let s = 0;
		for (const r of rr) {
			const eff = Math.max(r.best, r.sp);
			s += r.won ? (eff - 1) * (1 - COMM) : -1;
		}
		return (100 * s) / rr.length;
	};
	const roiAt = (rr: R[], pick: (r: R) => number) => {
		let s = 0;
		for (const r of rr) {
			const o = pick(r);
			s += r.won ? (o - 1) * (1 - COMM) : -1;
		}
		return (100 * s) / rr.length;
	};

	const cells: [string, (r: R) => boolean][] = [
		["TODOS", () => true],
		["odd [1,4)", (r) => r.best < 4],
		["odd [4,8)", (r) => r.best >= 4 && r.best < 8],
		["odd [8,15)", (r) => r.best >= 8 && r.best < 15],
		["odd [15,30)", (r) => r.best >= 15 && r.best < 30],
		["odd [30,+)", (r) => r.best >= 30],
		["3+ casas cotando", (r) => r.nBookies >= 3],
	];
	const show = (label: string, rr: R[]) => {
		if (rr.length < 200) {
			console.log(`  ${label.padEnd(20)} ${String(rr.length).padStart(6)}  (amostra insuficiente)`);
			return;
		}
		const [lo, hi] = bootstrap(rr, roiBog);
		console.log(
			`  ${label.padEnd(20)} ${String(rr.length).padStart(6)} ` +
			`${roiBog(rr).toFixed(2).padStart(8)}% [${lo.toFixed(2)}, ${hi.toFixed(2)}]`.padEnd(30) +
			` ${roiAt(rr, (r) => r.sp).toFixed(2).padStart(8)}% ${roiAt(rr, (r) => r.best).toFixed(2).padStart(9)}%` +
			`${lo > 0 ? " ✅" : ""}`,
		);
	};
	console.log(`  ${"célula".padEnd(20)} ${"n".padStart(6)} ${"ROI com BOG".padStart(9)} ${"IC95".padStart(20)} ${"só SP".padStart(8)} ${"só manhã".padStart(9)}`);
	for (const [lab, sel] of cells) show(lab, wBog.filter(sel));

	// ===== Q3. CASA × EXCHANGE — o motor do matched betting =====
	// Back na casa (melhor preço de manhã, Ob) e lay na exchange (Ol). Lucro
	// travado sse Ob > (Ol − c)/(1 − c). Proxy de Ol = MORNINGWAP (média
	// negociada da manhã — NÃO é o toque de lay, que é pior por meia spread;
	// logo ISTO É OTIMISTA). Segunda régua: lay "at SP" (executável, mas o
	// preço não é conhecido na hora — é EV, não lock).
	console.log("\n  ══ Q3. CASA × EXCHANGE (back na casa de manhã, lay na exchange) ══");
	const C = 0.065;
	const lock = (ob: number, ol: number) => ob * (1 - C) / (ol - C) - 1; // por unidade de back
	const wMw = rows.filter((r) => r.mw > 1.01);
	console.log(`  runners com preço de manhã na casa E na exchange (MORNINGWAP): ${wMw.length}`);
	const arbMw = wMw.filter((r) => lock(r.best, r.mw) > 0);
	const arbBsp = rows.filter((r) => lock(r.best, r.bsp) > 0);
	const med = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
	console.log(`  lock > 0 vs MORNINGWAP (otimista): ${arbMw.length} (${pct(arbMw.length / wMw.length)}) · lucro travado mediano ${pct(med(arbMw.map((r) => lock(r.best, r.mw))))}`);
	console.log(`  lock > 0 vs BSP (não é lock, é EV): ${arbBsp.length} (${pct(arbBsp.length / rows.length)}) · mediano ${pct(med(arbBsp.map((r) => lock(r.best, r.bsp))))}`);
	// quanto vale se você fizesse TODAS as que parecem arb pela manhã e liquidasse no BSP real
	let pl = 0;
	for (const r of arbMw) { pl += lock(r.best, r.bsp); }
	console.log(`  P/L REAL (seleciona pela manhã, hedge liquida no BSP): ${pct(pl / Math.max(arbMw.length, 1))} por aposta em ${arbMw.length} apostas`);
	const cheap = arbMw.filter((r) => r.best < 10);
	let pl2 = 0; for (const r of cheap) pl2 += lock(r.best, r.bsp);
	console.log(`    idem, só odd < 10 (liquidez de lay real): ${pct(pl2 / Math.max(cheap.length, 1))} em ${cheap.length}`);

	// ---- diagnóstico do Q3: é preço real ou artefato? ----
	console.log("\n  ── Q3 diagnóstico ──");
	// (a) sanidade do join: correlação log(best) × log(bsp)
	const lx = rows.map((r) => Math.log(r.best)), ly = rows.map((r) => Math.log(r.bsp));
	const mx = lx.reduce((a, b) => a + b, 0) / lx.length, my = ly.reduce((a, b) => a + b, 0) / ly.length;
	let sxy = 0, sxx = 0, syy = 0;
	for (let i = 0; i < lx.length; i++) { sxy += (lx[i] - mx) * (ly[i] - my); sxx += (lx[i] - mx) ** 2; syy += (ly[i] - my) ** 2; }
	console.log(`  (a) corr(log preço casa, log BSP) = ${(sxy / Math.sqrt(sxx * syy)).toFixed(3)}  (join certo ≈ 0,9; join errado ≈ 0)`);
	// (b) volume matinal na exchange nas "arb" vs no resto
	const mvA = med(arbMw.map((r) => r.mvol)), mvN = med(wMw.filter((r) => lock(r.best, r.mw) <= 0).map((r) => r.mvol));
	console.log(`  (b) MORNINGTRADEDVOL mediano: 'arb' £${mvA.toFixed(0)} vs resto £${mvN.toFixed(0)}`);
	// (c) refaz o Q3 exigindo volume matinal mínimo (a média só é preço se alguém negociou)
	for (const minVol of [50, 200, 500, 1000]) {
		const univ = wMw.filter((r) => r.mvol >= minVol);
		const arb = univ.filter((r) => lock(r.best, r.mw) > 0);
		let p2 = 0; for (const r of arb) p2 += lock(r.best, r.bsp);
		console.log(`  (c) MORNINGTRADEDVOL ≥ £${String(minVol).padStart(4)}: universo ${String(univ.length).padStart(6)} · lock>0 ${String(arb.length).padStart(5)} (${pct(arb.length / Math.max(univ.length, 1)).padStart(6)}) · lock med ${pct(med(arb.map((r) => lock(r.best, r.mw)))).padStart(7)} · P/L real no BSP ${pct(p2 / Math.max(arb.length, 1)).padStart(7)}`);
	}
	// (d) por faixa de odd da casa
	for (const [lo, hi] of [[1, 3], [3, 6], [6, 12], [12, 30], [30, 999]] as [number, number][]) {
		const univ = wMw.filter((r) => r.best >= lo && r.best < hi && r.mvol >= 200);
		const arb = univ.filter((r) => lock(r.best, r.mw) > 0);
		console.log(`  (d) odd casa [${lo},${hi}) vol≥200: ${String(univ.length).padStart(6)} → lock>0 ${String(arb.length).padStart(5)} (${pct(arb.length / Math.max(univ.length, 1))})`);
	}

	console.log(`\n  ── FIT [${FROM},${SPLIT}) vs HELD [${SPLIT},${TO}] ──`);
	show("FIT", wBog.filter((r) => r.date < SPLIT));
	show("HELD", wBog.filter((r) => r.date >= SPLIT));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
