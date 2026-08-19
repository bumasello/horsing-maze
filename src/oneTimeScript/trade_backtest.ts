// AMBIENTE DE BACKTEST DE TRADING — manhã → largada (DEV-ONLY, offline)
//
// Testa a operação: APOSTA CONTRA (lay) de manhã → APOSTA A FAVOR (back) na
// largada, travando lucro independente do resultado da corrida.
//
// Não precisa de API, conta, nem VPN: usa só os CSVs históricos da Betfair, que
// trazem morningwap (preço médio da manhã), bsp (preço na largada), ppmax/ppmin
// (extremos negociados antes da corrida) e volumes.
//
// O PONTO CENTRAL — CUSTO EM TICKS:
// O que decide a estratégia não é o drift bruto, é quanto dele sobra depois do
// spread. Como não temos o livro de ofertas, o spread entra como PARÂMETRO k =
// quantos ticks você atravessa em cada ponta:
//   entrada (lay):  paga k ticks A MAIS  → odd maior → responsabilidade maior
//   saída  (back):  recebe k ticks A MENOS → odd menor → lucro menor
// O output principal é o BREAK-EVEN em ticks: quantos ticks a estratégia
// aguenta antes de virar prejuízo. Esse número é estrutural — não é escolhido
// varrendo células — e dá pra comparar com o spread real olhando o site.
//
// Lucro travado (greening up): lay stake S na odd L, back S·L/B na odd B
//   lucro = S · (B − L) / B     (idêntico nos dois desfechos)
//
// Uso: nvm use 20 && npx ts-node src/oneTimeScript/trade_backtest.ts
// Env: BSP_DIR, STAKE (5), COMMISSION (0.065), MIN_VOL (100), B (2000),
//      SPLIT_DATE (2025-10-01) — só a janela HELD é reportada

import fs from "node:fs";
import path from "node:path";

const BSP_DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const STAKE = Number(process.env.STAKE || 5);
const COMMISSION = Number(process.env.COMMISSION || 0.065);
const MIN_VOL = Number(process.env.MIN_VOL || 100); // £ negociados de manhã
const NBOOT = Number(process.env.B || 2000);
const SPLIT_DATE = process.env.SPLIT_DATE || "2025-10-01";

const BANDS: Array<[number, number]> = [
	[2, 4],
	[4, 6],
	[6, 10],
	[10, 15],
	[15, 25],
	[25, 50],
];
const TICKS = [0, 1, 2, 3, 4];

/** Escada de ticks da Betfair. */
function tickSize(odd: number): number {
	if (odd < 2) return 0.01;
	if (odd < 3) return 0.02;
	if (odd < 4) return 0.05;
	if (odd < 6) return 0.1;
	if (odd < 10) return 0.2;
	if (odd < 20) return 0.5;
	if (odd < 30) return 1;
	if (odd < 50) return 2;
	if (odd < 100) return 5;
	return 10;
}
/** Move `n` ticks a partir de `odd` (n>0 sobe, n<0 desce), respeitando a escada. */
function moveTicks(odd: number, n: number): number {
	let o = odd;
	for (let i = 0; i < Math.abs(n); i++) o += Math.sign(n) * tickSize(o);
	return Math.max(1.01, o);
}

interface Runner {
	morning: number;
	bsp: number;
	ppmax: number;
	mVol: number;
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

function load(dir: string): Runner[] {
	const out: Runner[] = [];
	for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".csv"))) {
		const lines = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/);
		if (lines.length < 2) continue;
		const h = splitCsv(lines[0]).map((s) => s.trim().toLowerCase());
		const I = {
			ev: h.indexOf("event_id"),
			dt: h.indexOf("event_dt"),
			bsp: h.indexOf("bsp"),
			mw: h.indexOf("morningwap"),
			pmax: h.indexOf("ppmax"),
			mv: h.indexOf("morningtradedvol"),
		};
		if (I.bsp < 0 || I.mw < 0) continue;
		for (let i = 1; i < lines.length; i++) {
			if (!lines[i].trim()) continue;
			const c = splitCsv(lines[i]);
			const bsp = Number(c[I.bsp]);
			const morning = Number(c[I.mw]);
			if (!(bsp > 1) || !(morning > 1)) continue;
			const dt = (c[I.dt] ?? "").trim().split(/\s+/)[0];
			const [dd, mm, yyyy] = dt.split("-");
			if (!yyyy) continue;
			const date = `${yyyy}-${mm}-${dd}`;
			if (date < SPLIT_DATE) continue; // só janela de validação
			out.push({
				morning,
				bsp,
				ppmax: I.pmax >= 0 ? Number(c[I.pmax]) || 0 : 0,
				mVol: I.mv >= 0 ? Number(c[I.mv]) || 0 : 0,
				raceKey: `${date}|${c[I.ev]}`,
			});
		}
	}
	return out;
}

/** Lucro travado de um lay@L / back@B com stake S, comissão só sobre ganho. */
function lockedProfit(L: number, B: number): number {
	const gross = (STAKE * (B - L)) / B;
	return gross > 0 ? gross * (1 - COMMISSION) : gross;
}

interface Trade {
	pnl: number;
	liability: number;
	raceKey: string;
}

function runBand(rs: Runner[], lo: number, hi: number, k: number): Trade[] {
	const out: Trade[] = [];
	for (const r of rs) {
		if (r.morning < lo || r.morning > hi) continue;
		if (r.mVol < MIN_VOL) continue;
		// atravessa o spread nas duas pontas: lay mais caro, back mais barato
		const L = moveTicks(r.morning, k);
		const B = moveTicks(r.bsp, -k);
		out.push({
			pnl: lockedProfit(L, B),
			liability: STAKE * (L - 1),
			raceKey: r.raceKey,
		});
	}
	return out;
}

/** Cluster bootstrap por corrida sobre o P/L total. */
function bootstrapPnl(trades: Trade[]): { lo: number; hi: number } {
	const byRace = new Map<string, number>();
	for (const t of trades)
		byRace.set(t.raceKey, (byRace.get(t.raceKey) ?? 0) + t.pnl);
	const races = Array.from(byRace.values());
	const n = races.length;
	const sums: number[] = [];
	for (let b = 0; b < NBOOT; b++) {
		let s = 0;
		for (let i = 0; i < n; i++) s += races[(Math.random() * n) | 0];
		sums.push(s);
	}
	sums.sort((a, b) => a - b);
	return {
		lo: sums[Math.floor(0.025 * sums.length)],
		hi: sums[Math.floor(0.975 * sums.length)],
	};
}

function main(): void {
	console.log("🔁 Backtest de trading manhã→largada (DEV-ONLY, offline)\n");
	console.log(
		`📋 stake R$${STAKE} | comissão ${(COMMISSION * 100).toFixed(1)}% | volume mín. manhã £${MIN_VOL} | janela ≥ ${SPLIT_DATE}`,
	);
	console.log("📋 custo do spread = k ticks atravessados em CADA ponta\n");
	const rs = load(BSP_DIR);
	console.log(`📂 ${rs.length} participantes na janela de validação\n`);

	for (const [lo, hi] of BANDS) {
		const head = runBand(rs, lo, hi, 0);
		if (head.length < 200) {
			console.log(
				`banda [${lo},${hi}]: só ${head.length} operações — pulando\n`,
			);
			continue;
		}
		console.log("═".repeat(78));
		console.log(
			`  banda de odd da manhã [${lo},${hi}] — ${head.length} operações`,
		);
		console.log("═".repeat(78));
		console.log(
			`  ${"ticks".padStart(6)} ${"P/L total".padStart(11)} ${"por op.".padStart(9)} ${"% s/ resp.".padStart(11)} ${"IC95 do P/L".padStart(24)}`,
		);
		let breakEven = -1;
		for (const k of TICKS) {
			const t = runBand(rs, lo, hi, k);
			const pnl = t.reduce((a, x) => a + x.pnl, 0);
			const liab = t.reduce((a, x) => a + x.liability, 0);
			const ci = bootstrapPnl(t);
			if (pnl > 0) breakEven = k;
			console.log(
				`  ${String(k).padStart(6)} ${pnl.toFixed(0).padStart(11)} ${(pnl / t.length).toFixed(3).padStart(9)} ${((pnl / liab) * 100).toFixed(2).padStart(10)}% ${`[${ci.lo.toFixed(0)}, ${ci.hi.toFixed(0)}]`.padStart(24)}`,
			);
		}
		console.log(
			`  → aguenta até ${breakEven < 0 ? "MENOS DE 0" : breakEven} tick(s) por ponta antes de virar prejuízo`,
		);

		// Teto: e se déssemos a saída no MELHOR preço negociado antes da corrida?
		const ceil = rs.filter(
			(r) =>
				r.morning >= lo && r.morning <= hi && r.mVol >= MIN_VOL && r.ppmax > 0,
		);
		const ceilPnl = ceil.reduce(
			(a, r) => a + lockedProfit(r.morning, r.ppmax),
			0,
		);
		console.log(
			`  (teto teórico com saída no máximo negociado: R$${ceilPnl.toFixed(0)} = ${(ceilPnl / ceil.length).toFixed(3)}/op — exige timing perfeito, é limite superior)\n`,
		);
	}
	console.log("✅ Concluído.");
}

main();
