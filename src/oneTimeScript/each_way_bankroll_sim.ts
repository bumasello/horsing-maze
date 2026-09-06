// SIMULAÇÃO DIÁRIA DE BANCA — each-way com BOG + vaga extra (§7.3 do mapa).
//
// Pergunta que este script responde: o "+8,77%" de `each_way_early.ts` é ROI POR
// UNIDADE APOSTADA, não por mês nem por ano. Pra virar retorno no tempo é preciso
// multiplicar pelo GIRO: quantas apostas por dia × quanto se aposta por vez.
// Este script faz exatamente isso, dia a dia, sobre o histórico real.
//
// Nada de modelo: preço real de casa (odds_enriched, melhor de 5), BOG
// (efetivo = max(preço da manhã, SP)), desfecho e posição de chegada reais.
//
// Uso:
//   NO_CRON=1 BSP_DIR=/home/maze/dev/betfair_sp_data \
//   npx ts-node src/oneTimeScript/each_way_bankroll_sim.ts
//
// Parâmetros (env):
//   BANK=200 STAKE=5          banca inicial e stake POR PERNA (2 pernas = 2×STAKE de risco)
//   STAKE_MODE=fixed|frac     frac = STAKE_FRAC da banca por perna (staking proporcional)
//   STAKE_FRAC=0.01
//   MIN_STAKE=1               abaixo disso não dá pra apostar → ruína
//   EXTRA=1                   vagas extras da promoção (0 = termos padrão)
//   PROMO=all|sat|hcap16|sat_or_hcap16   em quais corridas a promoção existe
//   ODD_MIN=1 ODD_MAX=9999    filtro de odd efetiva
//   MAX_PER_RACE=99           teto de apostas por corrida (sorteio, pra não enviesar)
//   B=2000                    reamostragens do bootstrap por DIA
import dotenv from "dotenv";
dotenv.config();
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const FROM = process.env.FROM || "2026-03-16";
const TO = process.env.TO || "2026-08-18";
const B = Number(process.env.B || 2000);

const BANK0 = Number(process.env.BANK || 200);
const STAKE = Number(process.env.STAKE || 5);
const STAKE_MODE = process.env.STAKE_MODE || "fixed";
const STAKE_FRAC = Number(process.env.STAKE_FRAC || 0.01);
const MIN_STAKE = Number(process.env.MIN_STAKE || 1);
const EXTRA = Number(process.env.EXTRA ?? 1);
const PROMO = process.env.PROMO || "all";
const ODD_MIN = Number(process.env.ODD_MIN || 1);
const ODD_MAX = Number(process.env.ODD_MAX || 9999);
const MAX_PER_RACE = Number(process.env.MAX_PER_RACE || 99);
const CACHE = process.env.CACHE || "/tmp/ew_sim_join.json";

const db = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL as string,
	process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
	{ db: { schema: process.env.SCH || "hml" } },
);
const norm = (s: string) =>
	s
		.toLowerCase()
		.replace(/\([a-z]{2,3}\)/g, "")
		.replace(/[^a-z0-9]/g, "");

interface C {
	won: boolean;
	places: number;
	field: number;
	hcap: boolean;
	raceKey: string;
	date: string;
}
function loadCsv(): Map<string, C> {
	const win = new Map<string, any>();
	const plc = new Map<string, boolean>();
	const plcN = new Map<string, number>();
	const rows = new Map<string, string[]>();
	const meta = new Map<string, boolean>();
	for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".csv"))) {
		const isP = /place/i.test(f);
		for (const line of fs
			.readFileSync(path.join(DIR, f), "utf8")
			.split("\n")
			.slice(1)) {
			const c = line.split(",");
			if (c.length < 17) continue;
			if (!(+c[7] > 0)) continue;
			const dm = c[3].match(/(\d{2})-(\d{2})-(\d{4})/);
			if (!dm) continue;
			const date = `${dm[3]}-${dm[2]}-${dm[1]}`;
			if (date < FROM || date > TO) continue;
			const race = `${c[1]}|${c[3]}`;
			const key = `${date}|${norm(c[5])}`;
			if (isP) {
				plc.set(key, +c[6] === 1);
				if (+c[6] === 1) plcN.set(race, (plcN.get(race) || 0) + 1);
			} else {
				win.set(key, { won: +c[6] === 1, race, date });
				if (!rows.has(race)) rows.set(race, []);
				rows.get(race)!.push(key);
				meta.set(race, /Hcap/i.test(c[2]));
			}
		}
	}
	const out = new Map<string, C>();
	for (const [k, w] of win) {
		if (!plc.has(k)) continue;
		const places = plcN.get(w.race) || 0;
		if (places < 2 || places > 4) continue;
		out.set(k, {
			won: w.won,
			places,
			field: (rows.get(w.race) || []).length,
			hcap: meta.get(w.race)!,
			raceKey: w.race,
			date: w.date,
		});
	}
	return out;
}
function termFor(p: number, h: boolean, fd: number) {
	if (p <= 2) return 4;
	if (p === 3) return h && fd >= 12 ? 4 : 5;
	return 4;
}

interface Bet {
	date: string;
	raceKey: string;
	O: number;
	f: number;
	places: number;
	field: number;
	hcap: boolean;
	won: boolean;
	pos: number;
	promo: boolean;
}

// retorno por UNIDADE de stake por perna (2 unidades apostadas no total)
function pnlUnits(b: Bet): number {
	const k = b.places + (b.promo ? EXTRA : 0);
	const legWin = b.won ? b.O - 1 : -1;
	const legPlace = b.pos > 0 && b.pos <= k ? (b.O - 1) / b.f : -1;
	return legWin + legPlace;
}

function dow(d: string): number {
	return new Date(`${d}T12:00:00Z`).getUTCDay(); // 6 = sábado
}
function hasPromo(b: { date: string; places: number; hcap: boolean; field: number }) {
	const sat = dow(b.date) === 6;
	const big = b.hcap && b.field >= 16;
	if (PROMO === "all") return true;
	if (PROMO === "sat") return sat;
	if (PROMO === "hcap16") return big;
	if (PROMO === "sat_or_hcap16") return sat || big;
	throw new Error(`PROMO desconhecido: ${PROMO}`);
}

interface SimOut {
	final: number;
	peak: number;
	maxDD: number;
	ruined: boolean;
	bets: number;
	staked: number;
	pnl: number;
	path: { date: string; bank: number; bets: number; pnl: number }[];
}
function simulate(days: { date: string; bets: Bet[] }[], keepPath: boolean): SimOut {
	let bank = BANK0;
	let peak = BANK0;
	let maxDD = 0;
	let nb = 0;
	let staked = 0;
	const path: SimOut["path"] = [];
	for (const d of days) {
		if (bank <= 0) break;
		const s = STAKE_MODE === "frac" ? bank * STAKE_FRAC : STAKE;
		if (s < MIN_STAKE) break; // não dá pra apostar o mínimo → parado
		// não arriscar mais do que a banca tem: cada aposta consome 2×s
		let dayPnl = 0;
		let dayBets = 0;
		let avail = bank;
		for (const b of d.bets) {
			if (avail < 2 * s) break;
			avail -= 2 * s;
			dayPnl += s * pnlUnits(b);
			dayBets++;
			staked += 2 * s;
		}
		bank += dayPnl;
		nb += dayBets;
		if (bank > peak) peak = bank;
		const dd = peak > 0 ? (peak - bank) / peak : 0;
		if (dd > maxDD) maxDD = dd;
		if (keepPath) path.push({ date: d.date, bank, bets: dayBets, pnl: dayPnl });
		if (bank <= 0) {
			bank = 0;
			break;
		}
	}
	return {
		final: bank,
		peak,
		maxDD,
		ruined: bank < 2 * MIN_STAKE,
		bets: nb,
		staked,
		pnl: bank - BANK0,
		path,
	};
}

async function buildJoin(): Promise<Bet[]> {
	const csv = loadCsv();
	console.log(`  CSVs na janela [${FROM}, ${TO}]: ${csv.size} runners`);
	const rc: any[] = [];
	for (let p = 0; ; p++) {
		const { data, error } = await db
			.from("racecards_hr_enriched")
			.select("id,date")
			.gte("date", FROM)
			.lte("date", TO)
			.order("id")
			.range(p * 1000, p * 1000 + 999);
		if (error) throw error;
		if (!data?.length) break;
		rc.push(...data);
		if (data.length < 1000) break;
	}
	const dateOf = new Map(rc.map((r: any) => [r.id, r.date]));
	const rh = new Map<number, { key: string; sp: number; pos: number }>();
	const ids = rc.map((r: any) => r.id);
	for (let i = 0; i < ids.length; i += 150) {
		const ch = ids.slice(i, i + 150);
		for (let off = 0; ; off += 1000) {
			const { data, error } = await db
				.from("race_horses_hr_enriched")
				.select("id,racecard_id,horse,sp_decimal,non_runner,position")
				.in("racecard_id", ch)
				.range(off, off + 999);
			if (error) throw error;
			if (!data?.length) break;
			for (const r of data as any[]) {
				if (r.non_runner) continue;
				const d = dateOf.get(r.racecard_id);
				if (!d) continue;
				rh.set(r.id, {
					key: `${d}|${norm(r.horse)}`,
					sp: r.sp_decimal,
					pos: Number(r.position),
				});
			}
			if (data.length < 1000) break;
		}
	}
	const best = new Map<number, number>();
	for (let p = 0; ; p++) {
		const { data, error } = await db
			.from("odds_enriched")
			.select("race_horse_id,odd")
			.order("id")
			.range(p * 1000, p * 1000 + 999);
		if (error) throw error;
		if (!data?.length) break;
		for (const r of data as any[]) {
			if (!(r.odd > 1)) continue;
			const cur = best.get(r.race_horse_id);
			if (cur === undefined || r.odd > cur) best.set(r.race_horse_id, r.odd);
		}
		if (data.length < 1000) break;
	}

	const all: Bet[] = [];
	let noPos = 0;
	for (const [rhid, v] of rh) {
		const o = best.get(rhid);
		if (o === undefined) continue;
		const c = csv.get(v.key);
		if (!c) continue;
		const eff = Math.max(o, v.sp > 1 ? v.sp : 0);
		if (!(eff > 1)) continue;
		if (!(Number.isFinite(v.pos) && v.pos > 0)) noPos++;
		all.push({
			date: c.date,
			raceKey: c.raceKey,
			O: eff,
			f: termFor(c.places, c.hcap, c.field),
			places: c.places,
			field: c.field,
			hcap: c.hcap,
			won: c.won,
			pos: Number.isFinite(v.pos) && v.pos > 0 ? v.pos : 999,
			promo: hasPromo({ date: c.date, places: c.places, hcap: c.hcap, field: c.field }),
		});
	}
	console.log(`  JOIN final: ${all.length} runners (${noPos} sem posição de chegada → tratados como NÃO colocados)`);
	return all;
}

async function main() {
	console.log("\n🏦 SIMULAÇÃO DIÁRIA DE BANCA — each-way, preço de manhã + BOG\n");
	console.log(
		`  banca ${BANK0} · stake ${STAKE_MODE === "frac" ? `${(100 * STAKE_FRAC).toFixed(2)}% da banca` : STAKE}/perna · +${EXTRA} vaga(s) · promo=${PROMO} · odd [${ODD_MIN},${ODD_MAX}) · máx ${MAX_PER_RACE}/corrida\n`,
	);
	let all: Bet[] = [];
	if (fs.existsSync(CACHE)) {
		all = JSON.parse(fs.readFileSync(CACHE, "utf8"));
		console.log(`  join lido do cache ${CACHE}: ${all.length} runners`);
	} else {
		all = await buildJoin();
		fs.writeFileSync(CACHE, JSON.stringify(all));
		console.log(`  join gravado em ${CACHE}`);
	}
	// promo é decidida a cada rodada (depende de PROMO), não vem do cache
	for (const b of all)
		b.promo = hasPromo({ date: b.date, places: b.places, hcap: b.hcap, field: b.field });


	// universo apostável: promoção presente + filtro de odd
	let pool = all.filter((b) => b.promo && b.O >= ODD_MIN && b.O < ODD_MAX);
	// teto por corrida, por sorteio (qualquer regra determinística introduziria seleção)
	if (MAX_PER_RACE < 99) {
		const byRace = new Map<string, Bet[]>();
		for (const b of pool) {
			if (!byRace.has(b.raceKey)) byRace.set(b.raceKey, []);
			byRace.get(b.raceKey)!.push(b);
		}
		pool = [];
		for (const rr of byRace.values()) {
			for (let i = rr.length - 1; i > 0; i--) {
				const j = (Math.random() * (i + 1)) | 0;
				[rr[i], rr[j]] = [rr[j], rr[i]];
			}
			pool.push(...rr.slice(0, MAX_PER_RACE));
		}
	}
	console.log(`  universo apostável (promo + filtro): ${pool.length} apostas\n`);
	if (pool.length < 200) {
		console.log("  amostra insuficiente");
		return;
	}

	// ===== 1. O QUE O "+8,77%" É =====
	const roiUnit = (rr: Bet[]) => {
		let s = 0;
		for (const b of rr) s += pnlUnits(b);
		return (100 * s) / (2 * rr.length);
	};
	const dayMap = new Map<string, Bet[]>();
	for (const b of pool) {
		if (!dayMap.has(b.date)) dayMap.set(b.date, []);
		dayMap.get(b.date)!.push(b);
	}
	const days = [...dayMap.keys()]
		.sort()
		.map((date) => ({ date, bets: dayMap.get(date)! }));
	const nDays = days.length;
	const span =
		(new Date(days[nDays - 1].date).getTime() - new Date(days[0].date).getTime()) /
			86400000 +
		1;
	const betsPerDay = pool.length / span;
	// IC95 do ROI do POOL (cluster bootstrap por corrida) — muda com cada filtro,
	// então não vale herdar o IC do +8,77% da tabela "TODOS".
	const byRaceB = new Map<string, Bet[]>();
	for (const b of pool) {
		if (!byRaceB.has(b.raceKey)) byRaceB.set(b.raceKey, []);
		byRaceB.get(b.raceKey)!.push(b);
	}
	const grpB = [...byRaceB.values()];
	const roiBoot: number[] = [];
	for (let i = 0; i < B; i++) {
		const smp: Bet[] = [];
		for (let j = 0; j < grpB.length; j++) smp.push(...grpB[(Math.random() * grpB.length) | 0]);
		roiBoot.push(roiUnit(smp));
	}
	roiBoot.sort((a, b2) => a - b2);
	const rlo = roiBoot[Math.floor(0.025 * B)];
	const rhi = roiBoot[Math.floor(0.975 * B)];
	console.log("  ══ 1. O QUE A PORCENTAGEM É ══");
	console.log(`  ROI por unidade apostada .......... ${roiUnit(pool).toFixed(2)}%  IC95 [${rlo.toFixed(2)}, ${rhi.toFixed(2)}]${rlo > 0 ? " ✅" : " ❌ cruza zero"}`);
	console.log(`  período coberto .................. ${days[0].date} → ${days[nDays - 1].date} (${span.toFixed(0)} dias corridos, ${nDays} com corrida)`);
	console.log(`  apostas/dia (média sobre o período) ${betsPerDay.toFixed(1)}`);
	const stakePerDay = betsPerDay * 2 * STAKE;
	if (STAKE_MODE === "fixed") {
		console.log(`  giro/dia com stake ${STAKE}/perna ....... ${stakePerDay.toFixed(0)} (= ${((100 * stakePerDay) / BANK0).toFixed(0)}% da banca inicial POR DIA)`);
		console.log(`  ⇒ lucro esperado/dia ............. ${((stakePerDay * roiUnit(pool)) / 100).toFixed(2)} (${((100 * (stakePerDay * roiUnit(pool))) / 100 / BANK0).toFixed(2)}% da banca inicial/dia)`);
		console.log(`  ⇒ lucro esperado/mês (30d) ....... ${((30 * stakePerDay * roiUnit(pool)) / 100).toFixed(0)}\n`);
	} else {
		console.log("");
	}

	// ===== 2. TRAJETÓRIA HISTÓRICA REAL =====
	const hist = simulate(days, true);
	console.log("  ══ 2. TRAJETÓRIA HISTÓRICA (a ordem real dos dias) ══");
	console.log(`  ${"mês".padEnd(9)} ${"dias".padStart(5)} ${"apostas".padStart(8)} ${"P/L".padStart(10)} ${"banca fim".padStart(11)}`);
	const byMonth = new Map<string, { d: number; b: number; p: number; end: number }>();
	for (const p of hist.path) {
		const m = p.date.slice(0, 7);
		const cur = byMonth.get(m) || { d: 0, b: 0, p: 0, end: 0 };
		cur.d++;
		cur.b += p.bets;
		cur.p += p.pnl;
		cur.end = p.bank;
		byMonth.set(m, cur);
	}
	for (const [m, v] of byMonth)
		console.log(`  ${m.padEnd(9)} ${String(v.d).padStart(5)} ${String(v.b).padStart(8)} ${v.p.toFixed(0).padStart(10)} ${v.end.toFixed(0).padStart(11)}`);
	console.log(`  ${"—".repeat(48)}`);
	console.log(`  apostas ${hist.bets} · total apostado ${hist.staked.toFixed(0)} · P/L ${hist.pnl.toFixed(0)} · ROI ${((100 * hist.pnl) / Math.max(hist.staked, 1)).toFixed(2)}%`);
	console.log(`  banca ${BANK0} → ${hist.final.toFixed(0)} (${((100 * hist.pnl) / BANK0).toFixed(0)}%) · pico ${hist.peak.toFixed(0)} · max drawdown ${(100 * hist.maxDD).toFixed(1)}%${hist.ruined ? " · ⚠️ RUÍNA" : ""}\n`);

	// sparkline da banca
	if (hist.path.length > 1) {
		const bl = "▁▂▃▄▅▆▇█";
		const vs = hist.path.map((p) => p.bank);
		const lo = Math.min(...vs);
		const hi = Math.max(...vs);
		const step = Math.max(1, Math.ceil(vs.length / 90));
		let spark = "";
		for (let i = 0; i < vs.length; i += step)
			spark += bl[Math.min(7, Math.floor(((vs[i] - lo) / Math.max(hi - lo, 1e-9)) * 7.99))];
		console.log(`  banca dia a dia (${lo.toFixed(0)} … ${hi.toFixed(0)}):`);
		console.log(`  ${spark}\n`);
	}

	// ===== 3. BOOTSTRAP POR DIA =====
	// Uma trajetória é amostra de 1. Reamostra DIAS inteiros com reposição
	// (preserva a correlação dentro da corrida e dentro do dia).
	console.log("  ══ 3. BOOTSTRAP POR DIA (B=" + B + ") — a trajetória é amostra de 1 ══");
	const finals: number[] = [];
	const dds: number[] = [];
	const peaks: number[] = [];
	let ruins = 0;
	for (let b = 0; b < B; b++) {
		const samp: typeof days = [];
		for (let i = 0; i < nDays; i++) samp.push(days[(Math.random() * nDays) | 0]);
		const r = simulate(samp, false);
		finals.push(r.final);
		dds.push(r.maxDD);
		peaks.push(r.peak);
		if (r.ruined) ruins++;
	}
	finals.sort((a, b2) => a - b2);
	dds.sort((a, b2) => a - b2);
	peaks.sort((a, b2) => a - b2);
	const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
	console.log(`  banca final: mediana ${q(finals, 0.5).toFixed(0)} · IC95 [${q(finals, 0.025).toFixed(0)}, ${q(finals, 0.975).toFixed(0)}] · p10 ${q(finals, 0.1).toFixed(0)} · p90 ${q(finals, 0.9).toFixed(0)}`);
	console.log(`  P(ruína) ................ ${((100 * ruins) / B).toFixed(1)}%`);
	console.log(`  P(terminar positivo) .... ${((100 * finals.filter((f) => f > BANK0).length) / B).toFixed(1)}%`);
	console.log(`  P(dobrar a banca) ....... ${((100 * finals.filter((f) => f >= 2 * BANK0).length) / B).toFixed(1)}%`);
	console.log(`  max drawdown: mediana ${(100 * q(dds, 0.5)).toFixed(1)}% · p95 ${(100 * q(dds, 0.95)).toFixed(1)}%`);
	console.log(`  pico: mediana ${q(peaks, 0.5).toFixed(0)} · p95 ${q(peaks, 0.95).toFixed(0)}\n`);
}
main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
