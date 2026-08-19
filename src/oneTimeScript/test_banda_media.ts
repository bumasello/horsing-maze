// TESTE PRÉ-REGISTRADO #2 — o modelo tem edge em banda média?
// Protocolo congelado em docs/pre_registro_banda_media_2026-08-18.md.
//
// Duas células: LAY [3,5] e LAY [4,7]. Janela [581,360) dias atrás — anterior
// a tudo que já foi olhado ([180,0) e [360,180) estão queimadas pelos sweeps
// de 2026-08-12). Correção de Bonferroni: IC de 97,5% por serem 2 hipóteses.
//
// ⚠️ A janela é ANTERIOR ao split de treino (2025-12-22 Flat / 2026-01-29 Jump),
// logo é IN-SAMPLE pro modelo e enviesa a favor dele. Resultado negativo é
// conclusivo; positivo é só permissivo.
//
// Uso: nvm use 20 && NO_CRON=1 PORT=3987 BSP_DIR=/home/maze/dev/betfair_sp_data \
//      npx ts-node src/oneTimeScript/test_banda_media.ts
// Env: PERIOD_DAYS (221), END_DAYS_AGO (360), B (2000), STAKE_TEST (5), BSP_DIR

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { supabase } from "..";
import { calculateLayValueIndex } from "../services/ml/claude-generate-picks";
import {
	loadBspLookup,
	lookupBsp,
	normName,
} from "../services/ml/eval/bsp-lookup";
import {
	type HorseRecord,
	loadModelFromPath,
	loadPeriodData,
	predictRace,
} from "../services/ml/eval/harness";
import { COMMISSION_RATE } from "../services/ml/eval/simulator";
import { getDataSchema } from "../shared/db-config";

const PERIOD_DAYS = Number(process.env.PERIOD_DAYS || 221);
const END_DAYS_AGO = Number(process.env.END_DAYS_AGO || 360);
const B = Number(process.env.B || 2000);
const STAKE = Number(process.env.STAKE_TEST || 5);
const BSP_DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
// Bonferroni: 2 hipóteses → cauda de 1,25% de cada lado (IC 97,5%)
const ALPHA_TAIL = 0.0125;

/** Células pré-registradas, com o ROI exigido vindo do feasibility_map. */
const CELLS: Array<{
	lo: number;
	hi: number;
	bank: number;
	requiredRoi: number;
}> = [
	{ lo: 3, hi: 5, bank: 200, requiredRoi: 0.085 },
	{ lo: 4, hi: 7, bank: 300, requiredRoi: 0.08 },
];

const ALL_GROUPS = [
	{
		name: "Flat",
		mtype: "flat" as const,
		types: ["Flat"],
		path: "horse_probability_model/claude-ml-model-flat",
	},
	{
		name: "Jump",
		mtype: "jump" as const,
		types: ["Hurdle", "Chase", "NHF"],
		path: "horse_probability_model/claude-ml-model-jump",
	},
];
const GROUPS = (process.env.GROUPS || "Flat,Jump")
	.split(",")
	.map((g) => ALL_GROUPS.find((x) => x.name === g.trim()))
	.filter((x): x is (typeof ALL_GROUPS)[number] => Boolean(x));

interface Odds {
	bsp?: number;
	morningwap?: number;
}
interface Loaded {
	raceMap: Map<number, HorseRecord[]>;
	pLose: Map<number, number[]>;
	oddsOf: (id: number) => Odds | undefined;
}
/** P/L de uma corrida (0 se não apostou) — unidade de reamostragem do bootstrap. */
interface RaceOutcome {
	pnl: number;
	bet: boolean;
	odd: number;
	won: boolean;
}

async function fetchMap<T extends { id: number }>(
	table: string,
	ids: number[],
	cols: string,
): Promise<Map<number, T>> {
	const out = new Map<number, T>();
	for (let i = 0; i < ids.length; i += 500) {
		const { data, error } = await supabase
			.schema(getDataSchema())
			.from(table)
			.select(cols)
			.in("id", ids.slice(i, i + 500));
		if (error) throw error;
		for (const r of (data ?? []) as unknown as T[]) out.set(r.id, r);
	}
	return out;
}

/** combined_score do prod com a banda parametrizada (idêntico a sweep_band_ruin). */
function combinedScore(
	p: number,
	ivl: number,
	odd: number,
	lo: number,
	hi: number,
): number {
	const ivlScore = Math.min(ivl / 2, 1);
	const a = lo + (hi - lo) * 0.33;
	const b = lo + (hi - lo) * 0.67;
	let oddScore = 0;
	if (odd >= lo && odd <= hi) {
		if (odd >= a && odd <= b) oddScore = 1;
		else if (odd < a) oddScore = (odd - lo) / (a - lo);
		else oddScore = 1 - (odd - b) / (hi - b);
	}
	return p * 0.4 + ivlScore * 0.4 + oddScore * 0.2;
}

function collect(loaded: Loaded[], lo: number, hi: number): RaceOutcome[] {
	const out: RaceOutcome[] = [];
	for (const L of loaded) {
		for (const [raceId, horses] of L.raceMap) {
			const none: RaceOutcome = { pnl: 0, bet: false, odd: 0, won: false };
			if (horses.length < 3) {
				out.push(none);
				continue;
			}
			const pLose = L.pLose.get(raceId);
			if (!pLose) {
				out.push(none);
				continue;
			}
			const cands: Array<{ h: HorseRecord; s: number }> = [];
			for (let i = 0; i < horses.length; i++) {
				if (pLose[i] < 0) continue;
				const od = L.oddsOf(horses[i].race_horse_id);
				const selOdd = od?.morningwap ?? horses[i].market_odd;
				if (!selOdd || selOdd < lo || selOdd > hi) continue;
				const ivl = calculateLayValueIndex(pLose[i], selOdd);
				cands.push({
					h: horses[i],
					s: combinedScore(pLose[i], ivl, selOdd, lo, hi),
				});
			}
			cands.sort((x, y) => y.s - x.s);
			let placed = false;
			for (const c of cands.slice(0, 3)) {
				if (c.h.non_runner) continue;
				const settle = L.oddsOf(c.h.race_horse_id)?.bsp;
				if (!settle || settle < lo || settle > hi) continue; // ordem com limite
				const won = c.h.finish_position === 1;
				out.push({
					pnl: won ? -STAKE * (settle - 1) : STAKE * (1 - COMMISSION_RATE),
					bet: true,
					odd: settle,
					won,
				});
				placed = true;
				break;
			}
			if (!placed) out.push(none);
		}
	}
	return out;
}

/** Cluster bootstrap por corrida: reamostra corridas inteiras com reposição. */
function bootstrapRoi(
	races: RaceOutcome[],
	b: number,
): { lo: number; hi: number } {
	const n = races.length;
	const rois: number[] = [];
	for (let k = 0; k < b; k++) {
		let pnl = 0;
		let bets = 0;
		for (let i = 0; i < n; i++) {
			const r = races[(Math.random() * n) | 0];
			pnl += r.pnl;
			if (r.bet) bets++;
		}
		if (bets > 0) rois.push(pnl / (bets * STAKE));
	}
	rois.sort((x, y) => x - y);
	const at = (p: number) =>
		rois[Math.min(rois.length - 1, Math.floor(p * rois.length))];
	return { lo: at(ALPHA_TAIL), hi: at(1 - ALPHA_TAIL) };
}

function verdict(loCi: number, hiCi: number, required: number): string {
	if (hiCi < 0) return "❌ MORTA — o modelo perde dinheiro nessa banda";
	if (loCi <= 0) return "⚠️  SEM EDGE DEMONSTRÁVEL — o IC inclui zero";
	if (loCi <= required)
		return "🟡 TEM EDGE, mas insuficiente/indeterminado pra meta";
	return "✅ VIÁVEL — IC inteiramente acima do ROI exigido";
}

async function main(): Promise<void> {
	console.log("🧪 Teste pré-registrado #2 — banda média (DEV-ONLY)\n");
	console.log(
		`📋 janela [${PERIOD_DAYS + END_DAYS_AGO}, ${END_DAYS_AGO}) dias atrás | stake R$${STAKE} | comissão ${(COMMISSION_RATE * 100).toFixed(1)}%`,
	);
	console.log(
		`📋 Bonferroni p/ 2 hipóteses → IC de ${((1 - 2 * ALPHA_TAIL) * 100).toFixed(1)}% (cauda ${(ALPHA_TAIL * 100).toFixed(2)}%), B=${B}`,
	);
	console.log(
		"📋 ⚠️  janela é IN-SAMPLE pro modelo — negativo é conclusivo, positivo é só permissivo\n",
	);
	await mongoose.connect(process.env.MONGOOSE as string);

	const { lookup, files } = loadBspLookup(BSP_DIR);
	console.log(`📂 BSP: ${files} arquivos, ${lookup.size} chaves`);

	const loaded: Loaded[] = [];
	for (const g of GROUPS) {
		const model = await loadModelFromPath(g.path, g.mtype);
		const raceMap = await loadPeriodData(g.types, PERIOD_DAYS, END_DAYS_AGO);
		const raceIds = Array.from(raceMap.keys());
		const rhIds: number[] = [];
		for (const hs of raceMap.values())
			for (const h of hs) rhIds.push(h.race_horse_id);
		const races = await fetchMap<{ id: number; date: string }>(
			"racecards_hr_enriched",
			raceIds,
			"id, date",
		);
		const horsesTbl = await fetchMap<{ id: number; horse: string }>(
			"race_horses_hr_enriched",
			rhIds,
			"id, horse",
		);
		const oddsByRh = new Map<number, Odds>();
		let matched = 0;
		for (const [, hs] of raceMap)
			for (const h of hs) {
				const race = races.get(h.race_id);
				const rh = horsesTbl.get(h.race_horse_id);
				if (!race || !rh?.horse) continue;
				const found = lookupBsp(lookup, race.date, normName(rh.horse));
				if (found) {
					oddsByRh.set(h.race_horse_id, {
						bsp: found.row.bsp,
						morningwap: found.row.morningwap,
					});
					matched++;
				}
			}
		const pLose = new Map<number, number[]>();
		for (const [raceId, hs] of raceMap)
			if (hs.length >= 3) pLose.set(raceId, Array.from(predictRace(hs, model)));
		console.log(
			`🏁 ${g.name}: ${raceIds.length} corridas | BSP casado ${matched}/${rhIds.length} (${((matched / rhIds.length) * 100).toFixed(1)}%)`,
		);
		loaded.push({ raceMap, pLose, oddsOf: (id) => oddsByRh.get(id) });
		model.model.dispose();
	}

	for (const cell of CELLS) {
		const races = collect(loaded, cell.lo, cell.hi);
		const bets = races.filter((r) => r.bet);
		if (bets.length === 0) {
			console.log(`\n[${cell.lo},${cell.hi}]: sem apostas`);
			continue;
		}
		const pnl = races.reduce((a, r) => a + r.pnl, 0);
		const roi = pnl / (bets.length * STAKE);
		const wins = bets.filter((r) => !r.won).length;
		const wr = (wins / bets.length) * 100;
		const avgOdd = bets.reduce((a, r) => a + r.odd, 0) / bets.length;
		const be = ((avgOdd - 1) / (avgOdd - 1 + (1 - COMMISSION_RATE))) * 100;
		const ci = bootstrapRoi(races, B);

		console.log(`\n${"═".repeat(74)}`);
		console.log(
			`  LAY [${cell.lo},${cell.hi}] — banca ${cell.bank}, ROI exigido ${(cell.requiredRoi * 100).toFixed(1)}%`,
		);
		console.log("═".repeat(74));
		console.log(
			`  corridas=${races.length}  apostas=${bets.length}  odd média=${avgOdd.toFixed(2)}`,
		);
		console.log(
			`  WR=${wr.toFixed(2)}%  break-even=${be.toFixed(2)}%  margem=${(wr - be).toFixed(2)}pp`,
		);
		console.log(
			`  P/L=R$${pnl.toFixed(0)}  ROI/aposta=${(roi * 100).toFixed(2)}%`,
		);
		console.log(
			`  IC97,5% do ROI: [${(ci.lo * 100).toFixed(2)}%, ${(ci.hi * 100).toFixed(2)}%]`,
		);
		console.log(`  → ${verdict(ci.lo, ci.hi, cell.requiredRoi)}`);
	}

	await mongoose.disconnect();
	console.log("\n✅ Concluído.");
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
