// Bootstrap DEV-ONLY: no_market vs prod é real ou ruído? (Flat, honesto)
//
// Liquidação honesta: seleção por morningwap, aposta no BSP real (limite [13,20]).
// Bootstrap PAREADO por corrida (mesmas corridas, diff de pnl). pWorseOrEqual =
// fração de resamples onde no_market ≤ prod ≈ p-value unicaudal de "no_market melhor".
//
// Uso: nvm use 20 && PORT=3992 BSP_DIR=/home/mazedev/betfair_sp_data \
//      npx ts-node src/oneTimeScript/bootstrap_bsp_flat.ts
// Env: EVAL_DAYS (180), B (2000), BSP_DIR

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { supabase } from "..";
import { getDataSchema } from "../shared/db-config";
import {
	MAX_ODD_THRESHOLD,
	MIN_ODD_THRESHOLD,
	calculateCombinedScore,
	calculateLayValueIndex,
} from "../services/ml/claude-generate-picks";
import { pairedBootstrap } from "../services/ml/eval/bootstrap";
import {
	type HorseRecord,
	type LoadedModel,
	loadModelFromPath,
	loadPeriodData,
	predictRace,
} from "../services/ml/eval/harness";
import {
	loadBspLookup,
	lookupBsp,
	normName,
} from "../services/ml/eval/bsp-lookup";
import {
	COMMISSION_RATE,
	STAKE,
	WIN_PNL,
	type SimResult,
} from "../services/ml/eval/simulator";

const EVAL_DAYS = Number(process.env.EVAL_DAYS || 180);
const B = Number(process.env.B || 2000);
const BSP_DIR = process.env.BSP_DIR || "/home/mazedev/betfair_sp_data";
const PROD = "horse_probability_model/claude-ml-model-flat";
const NO_MARKET = "horse_probability_model/baselines/no_market_flat";

interface Odds {
	bsp?: number;
	morningwap?: number;
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

// SimResult por corrida sob honesto morningwap/BSP.
function simToResults(
	raceMap: Map<number, HorseRecord[]>,
	model: LoadedModel,
	oddsOf: (rhId: number) => Odds | undefined,
): SimResult[] {
	const out: SimResult[] = [];
	for (const [raceId, horses] of raceMap) {
		const base: SimResult = {
			raceId,
			raceDate: horses[0]?.race_date ?? "",
			pickIndexUsed: null,
			skipReason: "no_picks",
			chosenHorseId: null,
			chosenOdd: null,
			chosenPredictedProbability: null,
			chosenIvlScore: null,
			chosenWonRace: null,
			pnl: 0,
			bankrollBefore: 0,
			bankrollAfter: 0,
		};
		if (horses.length < 3) {
			out.push(base);
			continue;
		}
		const pLose = predictRace(horses, model);
		const cands = [];
		for (let i = 0; i < horses.length; i++) {
			if (pLose[i] < 0) continue;
			const selOdd =
				oddsOf(horses[i].race_horse_id)?.morningwap ?? horses[i].market_odd;
			if (!selOdd || selOdd <= 0) continue;
			const ivl = calculateLayValueIndex(pLose[i], selOdd);
			cands.push({
				h: horses[i],
				combined: calculateCombinedScore(pLose[i], ivl, selOdd),
			});
		}
		cands.sort((a, b) => b.combined - a.combined);
		let idx = 0;
		let placed = false;
		for (const c of cands.slice(0, 3)) {
			if (c.h.non_runner) {
				idx++;
				continue;
			}
			const settleOdd = oddsOf(c.h.race_horse_id)?.bsp ?? c.h.market_odd;
			if (
				!settleOdd ||
				settleOdd <= 0 ||
				settleOdd < MIN_ODD_THRESHOLD ||
				settleOdd > MAX_ODD_THRESHOLD
			) {
				idx++;
				continue;
			}
			const won = c.h.finish_position === 1;
			out.push({
				...base,
				pickIndexUsed: idx,
				skipReason: null,
				chosenHorseId: c.h.horse_id,
				chosenOdd: settleOdd,
				chosenWonRace: won,
				pnl: won ? -STAKE * (settleOdd - 1) : WIN_PNL * (1 - COMMISSION_RATE),
			});
			placed = true;
			break;
		}
		if (!placed) out.push({ ...base, skipReason: "all_ineligible" });
	}
	return out;
}

async function main(): Promise<void> {
	console.log(
		"🧪 Bootstrap BSP honesto — no_market vs prod (Flat, DEV-ONLY)\n",
	);
	console.log(
		`📋 janela=${EVAL_DAYS}d | B=${B} | comissão=${(COMMISSION_RATE * 100).toFixed(1)}% | range=[${MIN_ODD_THRESHOLD},${MAX_ODD_THRESHOLD}]`,
	);
	await mongoose.connect(process.env.MONGOOSE as string);

	const { lookup } = loadBspLookup(BSP_DIR);
	const prod = await loadModelFromPath(PROD, "flat");
	const noMkt = await loadModelFromPath(NO_MARKET, "flat");
	const raceMap = await loadPeriodData(["Flat"], EVAL_DAYS, 0);
	const raceIds = Array.from(raceMap.keys());
	const rhIds: number[] = [];
	for (const hs of raceMap.values())
		for (const h of hs) rhIds.push(h.race_horse_id);
	console.log(`🏁 ${raceIds.length} corridas, ${rhIds.length} cavalos`);

	const races = await fetchMap<{ id: number; date: string }>(
		"racecards_hr_enriched",
		raceIds,
		"id, date",
	);
	const horses = await fetchMap<{ id: number; horse: string }>(
		"race_horses_hr_enriched",
		rhIds,
		"id, horse",
	);
	const oddsByRh = new Map<number, Odds>();
	for (const [, group] of raceMap)
		for (const h of group) {
			const race = races.get(h.race_id);
			const rh = horses.get(h.race_horse_id);
			if (!race || !rh?.horse) continue;
			const found = lookupBsp(lookup, race.date, normName(rh.horse));
			if (found)
				oddsByRh.set(h.race_horse_id, {
					bsp: found.row.bsp,
					morningwap: found.row.morningwap,
				});
		}
	const oddsOf = (id: number) => oddsByRh.get(id);

	const rProd = simToResults(raceMap, prod, oddsOf);
	const rNoMkt = simToResults(raceMap, noMkt, oddsOf);
	const sumPnl = (r: SimResult[]) => r.reduce((a, x) => a + x.pnl, 0);
	const bets = (r: SimResult[]) =>
		r.filter((x) => x.pickIndexUsed !== null).length;
	console.log(
		`\n   prod:      P/L=${sumPnl(rProd).toFixed(0)} em ${bets(rProd)} apostas`,
	);
	console.log(
		`   no_market: P/L=${sumPnl(rNoMkt).toFixed(0)} em ${bets(rNoMkt)} apostas`,
	);

	const r = pairedBootstrap(rNoMkt, rProd, B);
	console.log(
		`\n📊 no_market − prod (pareado por corrida, n=${r.nRaces}, B=${B})`,
	);
	console.log(
		`   Δpnl total: ${r.pnlDiff.mean.toFixed(0)} [IC95 ${r.pnlDiff.lo95.toFixed(0)}, ${r.pnlDiff.hi95.toFixed(0)}]`,
	);
	console.log(
		`   Δwin rate:  ${r.winRateDiffPp.mean.toFixed(2)}pp [IC95 ${r.winRateDiffPp.lo95.toFixed(2)}, ${r.winRateDiffPp.hi95.toFixed(2)}]`,
	);
	console.log(
		`   P(no_market ≤ prod): ${(r.pWorseOrEqual * 100).toFixed(1)}% ${r.pWorseOrEqual < 0.05 ? "→ no_market MELHOR com significância" : r.pWorseOrEqual > 0.95 ? "→ no_market PIOR com significância" : "→ INCONCLUSIVO (ruído)"}`,
	);

	prod.model.dispose();
	noMkt.model.dispose();
	await mongoose.disconnect();
	console.log("\n✅ Concluído.");
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
