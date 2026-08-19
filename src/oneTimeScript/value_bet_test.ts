// VALUE BETTING — a casa de aposta erra vs a exchange? (DEV-ONLY, offline)
//
// Tese (2026-08-18): provamos hoje que o preço da exchange é eficiente demais
// pra gente vencer. Então usamos ele como VERDADE e procuramos quem está errado:
// as casas de odd fixa. Quando a odd da casa > odd justa da exchange, a aposta
// na casa tem EV positivo — sem precisar prever nada.
//
//   fair prob  q_i = (1/morningwap_i) normalizado na corrida (tira o vig)
//   EV         = q_i × odd_casa − 1        (casa não cobra comissão)
//   aposta     = 1 unidade flat quando EV > limiar (limiares PRÉ-DEFINIDOS,
//                reportamos todos — sem varrer/selecionar)
//
// Dados: odds_enriched (odds de casas capturadas ~04:00-04:30 UTC pelo nosso
// pipeline, por bookie) × CSVs Betfair (morningwap/bsp/win_lose).
//
// ⚠️ LIMITAÇÕES DECLARADAS ANTES DE RODAR:
// 1. morningwap é média da MANHÃ inteira — posterior às 04:30 da captura. O
//    "fair" tem informação que você não teria no instante da decisão. Isso
//    infla o resultado; a versão real compara com a exchange AO VIVO no mesmo
//    instante. Este é um teste de EXISTÊNCIA do sinal.
// 2. β>1 (medido hoje): a exchange de manhã ainda sobreprecifica azarão, então
//    q_i SUPERESTIMA a chance real do azarão → EV inflado em odd alta. Reporto
//    também a versão "sharp" com q^1.1 renormalizado (correção do viés).
// 3. Odds capturadas são de casas UK (LadBrokes, Unibet...). Executar do Brasil
//    seria nas .bet.br — odds podem diferir.
//
// Uso: nvm use 20 && NO_CRON=1 PORT=3978 npx ts-node src/oneTimeScript/value_bet_test.ts
// Env: BSP_DIR, B (2000)

import dotenv from "dotenv";
dotenv.config();

import fs from "node:fs";
import path from "node:path";
import { supabase } from "..";
import { normName } from "../services/ml/eval/bsp-lookup";
import { getDataSchema } from "../shared/db-config";

const BSP_DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const NBOOT = Number(process.env.B || 2000);
const BETA_SHARP = 1.1; // correção do viés favorito-azarão medida hoje

// Limiares de EV pré-definidos (buckets, não sweep): reporto TODOS
const BUCKETS: Array<[number, number]> = [
	[-1, 0],
	[0, 0.02],
	[0.02, 0.05],
	[0.05, 0.1],
	[0.1, 0.25],
	[0.25, 99],
];

// ---------- CSVs da Betfair: corridas com fair prob normalizada ----------
interface XRunner {
	qm: number;
	qmSharp: number;
	win: boolean;
	raceKey: string;
}

function splitCsv(line: string): string[] {
	const out: string[] = [];
	let cur = "";
	let inQ = false;
	for (const ch of line) {
		if (ch === '"') inQ = !inQ;
		else if (ch === "," && !inQ) {
			out.push(cur);
			cur = "";
		} else cur += ch;
	}
	out.push(cur);
	return out;
}

function loadExchange(dir: string): Map<string, XRunner> {
	const byEvent = new Map<
		string,
		Array<{ name: string; mw: number; win: boolean; date: string; ev: string }>
	>();
	for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".csv"))) {
		const lines = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/);
		if (lines.length < 2) continue;
		const h = splitCsv(lines[0]).map((s) => s.trim().toLowerCase());
		const I = {
			ev: h.indexOf("event_id"),
			dt: h.indexOf("event_dt"),
			sel: h.indexOf("selection_name"),
			wl: h.indexOf("win_lose"),
			mw: h.indexOf("morningwap"),
		};
		if (I.mw < 0 || I.sel < 0) continue;
		for (let i = 1; i < lines.length; i++) {
			if (!lines[i].trim()) continue;
			const c = splitCsv(lines[i]);
			const mw = Number(c[I.mw]);
			if (!(mw > 1)) continue;
			const dt = (c[I.dt] ?? "").trim().split(/\s+/)[0];
			const [dd, mm, yyyy] = dt.split("-");
			if (!yyyy) continue;
			const date = `${yyyy}-${mm}-${dd}`;
			if (date < "2026-03-16") continue; // só a janela com odds de casas
			const key = `${date}|${c[I.ev]}`;
			if (!byEvent.has(key)) byEvent.set(key, []);
			byEvent.get(key)!.push({
				name: normName(c[I.sel] ?? ""),
				mw,
				win: Number(c[I.wl]) === 1,
				date,
				ev: key,
			});
		}
	}
	// normaliza por corrida (plain e sharp β=1.1) e indexa por data|cavalo
	const out = new Map<string, XRunner>();
	for (const [key, rs] of byEvent) {
		if (rs.length < 4) continue;
		const raw = rs.map((r) => 1 / r.mw);
		const rawSharp = raw.map((q) => q ** BETA_SHARP);
		const s = raw.reduce((a, b) => a + b, 0);
		const sSharp = rawSharp.reduce((a, b) => a + b, 0);
		for (let i = 0; i < rs.length; i++) {
			const k = `${rs[i].date}|${rs[i].name}`;
			if (out.has(k)) {
				out.delete(k);
				continue;
			} // colisão de nome no dia: descarta
			out.set(k, {
				qm: raw[i] / s,
				qmSharp: rawSharp[i] / sSharp,
				win: rs[i].win,
				raceKey: key,
			});
		}
	}
	return out;
}

// ---------- odds das casas: melhor odd por cavalo ----------
interface HouseBet {
	date: string;
	horse: string;
	bestOdd: number;
	bestBookie: string;
	secondOdd: number | null; // 2ª melhor entre casas — robustez a erro de feed
	nBookies: number;
	racecardId: number;
	allOdds: number[]; // todas as odds (desc) — pro fair por consenso
}

async function loadHouseOdds(): Promise<HouseBet[]> {
	const schema = getDataSchema();
	// 1. odds_enriched completo (paginado)
	const odds: Array<{ race_horse_id: number; bookie: string; odd: number }> =
		[];
	for (let page = 0; ; page++) {
		const { data, error } = await supabase
			.schema(schema)
			.from("odds_enriched")
			.select("race_horse_id, bookie, odd")
			.order("id", { ascending: true })
			.range(page * 1000, page * 1000 + 999);
		if (error) throw error;
		if (!data?.length) break;
		odds.push(...data);
		if (data.length < 1000) break;
	}
	console.log(`   odds de casas: ${odds.length} linhas`);

	// todas as odds por race_horse_id (pra extrair 1ª e 2ª melhores)
	const byRh = new Map<number, Array<{ odd: number; bookie: string }>>();
	for (const o of odds) {
		if (!(o.odd > 1) || o.odd > 200) continue;
		if (!byRh.has(o.race_horse_id)) byRh.set(o.race_horse_id, []);
		byRh.get(o.race_horse_id)!.push({ odd: o.odd, bookie: o.bookie });
	}
	const best = new Map<
		number,
		{ odd: number; bookie: string; second: number | null; n: number }
	>();
	for (const [rhId, list] of byRh) {
		list.sort((a, b) => b.odd - a.odd);
		best.set(rhId, {
			odd: list[0].odd,
			bookie: list[0].bookie,
			second: list.length > 1 ? list[1].odd : null,
			n: list.length,
		});
	}

	// 2. race_horses → nome + racecard; racecards → data
	const rhIds = Array.from(best.keys());
	const rhMap = new Map<number, { horse: string; racecard_id: number }>();
	for (let i = 0; i < rhIds.length; i += 500) {
		const { data, error } = await supabase
			.schema(schema)
			.from("race_horses_hr_enriched")
			.select("id, horse, racecard_id")
			.in("id", rhIds.slice(i, i + 500));
		if (error) throw error;
		for (const r of data ?? [])
			rhMap.set(r.id, { horse: r.horse, racecard_id: r.racecard_id });
	}
	const rcIds = Array.from(
		new Set(Array.from(rhMap.values()).map((r) => r.racecard_id)),
	);
	const rcDate = new Map<number, string>();
	for (let i = 0; i < rcIds.length; i += 500) {
		const { data, error } = await supabase
			.schema(schema)
			.from("racecards_hr_enriched")
			.select("id, date")
			.in("id", rcIds.slice(i, i + 500));
		if (error) throw error;
		for (const r of data ?? []) rcDate.set(r.id, r.date);
	}

	const out: HouseBet[] = [];
	for (const [rhId, b] of best) {
		const rh = rhMap.get(rhId);
		const date = rh ? rcDate.get(rh.racecard_id) : undefined;
		if (!rh?.horse || !date) continue;
		const all = byRh.get(rhId)!.map((o) => o.odd); // já ordenado desc
		out.push({
			date,
			horse: normName(rh.horse),
			bestOdd: b.odd,
			bestBookie: b.bookie,
			secondOdd: b.second,
			nBookies: b.n,
			racecardId: rh.racecard_id,
			allOdds: all,
		});
	}
	return out;
}

// ---------- avaliação ----------
interface Bet {
	pnl: number;
	raceKey: string;
	odd: number;
	win: boolean;
}

function ciCluster(bets: Bet[]): { lo: number; hi: number } {
	const byRace = new Map<string, number>();
	for (const b of bets)
		byRace.set(b.raceKey, (byRace.get(b.raceKey) ?? 0) + b.pnl);
	const races = Array.from(byRace.values());
	const sums: number[] = [];
	for (let k = 0; k < NBOOT; k++) {
		let s = 0;
		for (let i = 0; i < races.length; i++)
			s += races[(Math.random() * races.length) | 0];
		sums.push(s);
	}
	sums.sort((a, b) => a - b);
	return {
		lo: sums[Math.floor(0.025 * sums.length)],
		hi: sums[Math.floor(0.975 * sums.length)],
	};
}

function report(
	title: string,
	evOf: (x: XRunner, odd: number) => number,
	house: HouseBet[],
	xch: Map<string, XRunner>,
): void {
	console.log(`\n${"═".repeat(78)}\n  ${title}\n${"═".repeat(78)}`);
	console.log(
		`  ${"EV bucket".padEnd(14)} ${"apostas".padStart(8)} ${"WR".padStart(7)} ${"odd méd".padStart(8)} ${"P/L".padStart(8)} ${"ROI".padStart(8)} ${"IC95 do P/L".padStart(20)}`,
	);
	for (const [lo, hi] of BUCKETS) {
		const bets: Bet[] = [];
		for (const h of house) {
			const x = xch.get(`${h.date}|${h.horse}`);
			if (!x) continue;
			const ev = evOf(x, h.bestOdd);
			if (ev < lo || ev >= hi) continue;
			bets.push({
				pnl: x.win ? h.bestOdd - 1 : -1,
				raceKey: x.raceKey,
				odd: h.bestOdd,
				win: x.win,
			});
		}
		if (bets.length < 30) {
			console.log(
				`  ${`[${lo}, ${hi})`.padEnd(14)} ${String(bets.length).padStart(8)}  — amostra insuficiente`,
			);
			continue;
		}
		const pnl = bets.reduce((a, b) => a + b.pnl, 0);
		const wins = bets.filter((b) => b.win).length;
		const avgOdd = bets.reduce((a, b) => a + b.odd, 0) / bets.length;
		const ci = ciCluster(bets);
		const sig = ci.lo > 0 ? " ✅" : ci.hi < 0 ? " ❌" : "";
		console.log(
			`  ${`[${lo}, ${hi})`.padEnd(14)} ${String(bets.length).padStart(8)} ${((wins / bets.length) * 100).toFixed(1).padStart(6)}% ${avgOdd.toFixed(1).padStart(8)} ${pnl.toFixed(0).padStart(8)} ${((pnl / bets.length) * 100).toFixed(1).padStart(7)}% ${`[${ci.lo.toFixed(0)}, ${ci.hi.toFixed(0)}]`.padStart(20)}${sig}`,
		);
	}
}

async function main(): Promise<void> {
	console.log(
		"💡 Value betting — casa de odd fixa vs exchange (DEV-ONLY, offline)\n",
	);
	console.log(
		"📋 aposta = 1 unidade flat na MELHOR odd entre casas | sem comissão (casa)",
	);
	console.log(
		"📋 fair = exchange da manhã, vig removido | buckets de EV pré-definidos\n",
	);

	console.log("📂 carregando exchange (CSVs)...");
	const xch = loadExchange(BSP_DIR);
	console.log(`   ${xch.size} cavalos com fair price na janela`);

	console.log("📂 carregando odds das casas (Supabase)...");
	const house = await loadHouseOdds();
	console.log(`   ${house.length} cavalos com melhor odd de casa`);

	let matched = 0;
	for (const h of house) if (xch.has(`${h.date}|${h.horse}`)) matched++;
	console.log(
		`   join casa↔exchange: ${matched} (${((matched / house.length) * 100).toFixed(1)}%)`,
	);

	report(
		"EV com fair PLAIN (q = 1/morningwap normalizado)",
		(x, odd) => x.qm * odd - 1,
		house,
		xch,
	);
	report(
		`EV com fair SHARP (q^${BETA_SHARP} renormalizado — corrige viés favorito-azarão)`,
		(x, odd) => x.qmSharp * odd - 1,
		house,
		xch,
	);

	// ---------- ROBUSTEZ do bucket alto (EV sharp ≥ 0.25) ----------
	// Suspeito nº 1: erro de feed — uma odd errada vira "valor" e o max entre
	// casas seleciona exatamente os erros. Antídotos:
	//   a) refazer com a 2ª MELHOR odd (seleção E liquidação) — um feed errado
	//      isolado não sobrevive
	//   b) quebrar por mês (glitch de uma semana concentraria) e por bookie
	console.log(
		`\n${"═".repeat(78)}\n  ROBUSTEZ — bucket EV sharp ≥ 0.25\n${"═".repeat(78)}`,
	);

	const topBets: Array<{ b: HouseBet; x: XRunner }> = [];
	for (const h of house) {
		const x = xch.get(`${h.date}|${h.horse}`);
		if (!x) continue;
		if (x.qmSharp * h.bestOdd - 1 >= 0.25) topBets.push({ b: h, x });
	}
	// (a) segunda melhor odd
	const second: Bet[] = [];
	for (const h of house) {
		const x = xch.get(`${h.date}|${h.horse}`);
		if (!x || h.secondOdd === null) continue;
		if (x.qmSharp * h.secondOdd - 1 >= 0.25)
			second.push({
				pnl: x.win ? h.secondOdd - 1 : -1,
				raceKey: x.raceKey,
				odd: h.secondOdd,
				win: x.win,
			});
	}
	if (second.length >= 30) {
		const pnl = second.reduce((a, b) => a + b.pnl, 0);
		const ci = ciCluster(second);
		console.log(
			`  2ª melhor odd: ${second.length} apostas | P/L ${pnl.toFixed(0)} | ROI ${((pnl / second.length) * 100).toFixed(1)}% | IC95 [${ci.lo.toFixed(0)}, ${ci.hi.toFixed(0)}] ${ci.lo > 0 ? "✅" : ""}`,
		);
	} else console.log(`  2ª melhor odd: só ${second.length} apostas`);

	// (b) por mês e por bookie
	const byMonth = new Map<string, { n: number; pnl: number }>();
	const byBookie = new Map<string, { n: number; pnl: number }>();
	for (const { b, x } of topBets) {
		const pnl = x.win ? b.bestOdd - 1 : -1;
		const m = b.date.slice(0, 7);
		if (!byMonth.has(m)) byMonth.set(m, { n: 0, pnl: 0 });
		const mm = byMonth.get(m)!;
		mm.n++;
		mm.pnl += pnl;
		if (!byBookie.has(b.bestBookie))
			byBookie.set(b.bestBookie, { n: 0, pnl: 0 });
		const bb = byBookie.get(b.bestBookie)!;
		bb.n++;
		bb.pnl += pnl;
	}
	console.log("  por mês:");
	for (const [m, v] of Array.from(byMonth).sort())
		console.log(
			`    ${m}: ${v.n} apostas, P/L ${v.pnl.toFixed(0)} (ROI ${((v.pnl / v.n) * 100).toFixed(0)}%)`,
		);
	console.log("  por bookie (da melhor odd):");
	for (const [bk, v] of Array.from(byBookie).sort((a, b2) => b2[1].n - a[1].n))
		console.log(
			`    ${bk}: ${v.n} apostas, P/L ${v.pnl.toFixed(0)} (ROI ${((v.pnl / v.n) * 100).toFixed(0)}%)`,
		);

	// ---------- FAIR POR CONSENSO (100% executável, sem look-ahead) ----------
	// fair = mediana das odds das OUTRAS casas (exclui a melhor, que é a que
	// apostamos), vig removido normalizando na corrida. Tudo do mesmo snapshot
	// ~04:30 — nada de exchange, nada de informação futura. É exatamente o que
	// o pipeline coleta todo dia, então uma versão ao vivo usaria isto.
	// Exige ≥3 cotações no cavalo e ≥4 cavalos com consenso na corrida.
	console.log(
		`\n${"═".repeat(78)}\n  EV com fair por CONSENSO das outras casas (executável, mesmo instante)\n${"═".repeat(78)}`,
	);

	const byRace = new Map<number, HouseBet[]>();
	for (const h of house) {
		if (!byRace.has(h.racecardId)) byRace.set(h.racecardId, []);
		byRace.get(h.racecardId)!.push(h);
	}
	const median = (a: number[]): number => {
		const s = [...a].sort((x, y) => x - y);
		const m = s.length >> 1;
		return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
	};
	console.log(
		`  ${"EV bucket".padEnd(14)} ${"apostas".padStart(8)} ${"WR".padStart(7)} ${"odd méd".padStart(8)} ${"P/L".padStart(8)} ${"ROI".padStart(8)} ${"IC95 do P/L".padStart(20)}`,
	);
	for (const [lo, hi] of BUCKETS) {
		const bets: Bet[] = [];
		for (const [rcId, horses] of byRace) {
			// consenso por cavalo: mediana excluindo a melhor odd
			const cons: Array<{ h: HouseBet; consOdd: number }> = [];
			for (const h of horses) {
				if (h.nBookies < 3) continue;
				cons.push({ h, consOdd: median(h.allOdds.slice(1)) });
			}
			if (cons.length < 4) continue;
			const raw = cons.map((c) => 1 / c.consOdd);
			const sum = raw.reduce((a, b) => a + b, 0);
			for (let i = 0; i < cons.length; i++) {
				const q = raw[i] / sum; // vig-free
				const ev = q * cons[i].h.bestOdd - 1;
				if (ev < lo || ev >= hi) continue;
				const x = xch.get(`${cons[i].h.date}|${cons[i].h.horse}`);
				if (!x) continue; // resultado vem do CSV (join necessário só pra liquidar)
				bets.push({
					pnl: x.win ? cons[i].h.bestOdd - 1 : -1,
					raceKey: `rc${rcId}`,
					odd: cons[i].h.bestOdd,
					win: x.win,
				});
			}
		}
		if (bets.length < 30) {
			console.log(
				`  ${`[${lo}, ${hi})`.padEnd(14)} ${String(bets.length).padStart(8)}  — amostra insuficiente`,
			);
			continue;
		}
		const pnl = bets.reduce((a, b) => a + b.pnl, 0);
		const wins = bets.filter((b) => b.win).length;
		const avgOdd = bets.reduce((a, b) => a + b.odd, 0) / bets.length;
		const ci = ciCluster(bets);
		const sig = ci.lo > 0 ? " ✅" : ci.hi < 0 ? " ❌" : "";
		console.log(
			`  ${`[${lo}, ${hi})`.padEnd(14)} ${String(bets.length).padStart(8)} ${((wins / bets.length) * 100).toFixed(1).padStart(6)}% ${avgOdd.toFixed(1).padStart(8)} ${pnl.toFixed(0).padStart(8)} ${((pnl / bets.length) * 100).toFixed(1).padStart(7)}% ${`[${ci.lo.toFixed(0)}, ${ci.hi.toFixed(0)}]`.padStart(20)}${sig}`,
		);
	}

	console.log("\n✅ Concluído.");
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
