// BOOTSTRAP DEV-ONLY: o edge do modo HONESTO é significativamente > 0?
//
// O eval_bsp mede o modo 3 (seleção por morningwap, liquidação no BSP real,
// sem look-ahead) e dá ROI positivo — mas com WR perto do break-even. Este
// script põe IC95 em volta desse número: se o limite inferior do P/L ficar
// acima de zero, o edge é real; se cruzar zero, não dá pra afirmar que existe.
//
// Cluster bootstrap no nível CORRIDA (unidade independente), igual ao resto
// do harness. Roda Flat e Jump separados — a hipótese é que o Flat perde
// quase todo o edge sem look-ahead e o Jump segura.
//
// Uso: nvm use 20 && PORT=3991 BSP_DIR=/caminho/betfair_sp_data \
//      npx ts-node src/oneTimeScript/bootstrap_bsp_vs_zero.ts
// Env: EVAL_DAYS (180), B (2000), BSP_DIR, GROUPS ("Flat,Jump")

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { supabase } from "..";
import {
	MAX_ODD_THRESHOLD,
	MIN_ODD_THRESHOLD,
	calculateCombinedScore,
	calculateLayValueIndex,
} from "../services/ml/claude-generate-picks";
import {
	loadBspLookup,
	lookupBsp,
	normName,
} from "../services/ml/eval/bsp-lookup";
import { bootstrapSummary } from "../services/ml/eval/bootstrap";
import {
	type HorseRecord,
	loadModelFromPath,
	loadPeriodData,
	predictRace,
} from "../services/ml/eval/harness";
import type { SimResult } from "../services/ml/eval/simulator";
import { COMMISSION_RATE, STAKE, WIN_PNL } from "../services/ml/eval/simulator";
import { getDataSchema } from "../shared/db-config";

const EVAL_DAYS = Number(process.env.EVAL_DAYS || 180);
const B = Number(process.env.B || 2000);
const BSP_DIR = process.env.BSP_DIR || "/home/mazedev/betfair_sp_data";

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

/** Modo 3 do eval_bsp, emitindo um SimResult por corrida (inclusive skips). */
function simulateHonest(
	raceMap: Map<number, HorseRecord[]>,
	model: Awaited<ReturnType<typeof loadModelFromPath>>,
	oddsOf: (rhId: number) => Odds | undefined,
): SimResult[] {
	const out: SimResult[] = [];
	for (const [raceId, horses] of raceMap) {
		const blank: SimResult = {
			raceId,
			raceDate: "",
			pickIndexUsed: null,
			skipReason: null,
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
			out.push(blank);
			continue;
		}
		const pLose = predictRace(horses, model);
		const cands: Array<{
			h: HorseRecord;
			combined: number;
			p: number;
			ivl: number;
		}> = [];
		for (let i = 0; i < horses.length; i++) {
			if (pLose[i] < 0) continue;
			const od = oddsOf(horses[i].race_horse_id);
			const selOdd = od?.morningwap ?? horses[i].market_odd;
			if (!selOdd || selOdd <= 0) continue;
			const ivl = calculateLayValueIndex(pLose[i], selOdd);
			cands.push({
				h: horses[i],
				combined: calculateCombinedScore(pLose[i], ivl, selOdd),
				p: pLose[i],
				ivl,
			});
		}
		cands.sort((a, b) => b.combined - a.combined);
		let placed = false;
		let idx = 0;
		for (const c of cands.slice(0, 3)) {
			if (c.h.non_runner) {
				idx++;
				continue;
			}
			const od = oddsOf(c.h.race_horse_id);
			const settleOdd = od?.bsp ?? c.h.market_odd;
			if (!settleOdd || settleOdd <= 0) {
				idx++;
				continue;
			}
			if (settleOdd < MIN_ODD_THRESHOLD || settleOdd > MAX_ODD_THRESHOLD) {
				idx++;
				continue;
			}
			const won = c.h.finish_position === 1;
			out.push({
				...blank,
				pickIndexUsed: idx,
				chosenHorseId: c.h.race_horse_id,
				chosenOdd: settleOdd,
				chosenPredictedProbability: c.p,
				chosenIvlScore: c.ivl,
				chosenWonRace: won,
				pnl: won ? -STAKE * (settleOdd - 1) : WIN_PNL * (1 - COMMISSION_RATE),
			});
			placed = true;
			break;
		}
		if (!placed) out.push(blank);
	}
	return out;
}

function summarize(label: string, results: SimResult[]): void {
	const bets = results.filter((r) => r.pickIndexUsed !== null);
	const losses = bets.filter((r) => r.chosenWonRace).length;
	const pnl = results.reduce((a, r) => a + r.pnl, 0);
	const avgOdd =
		bets.reduce((a, r) => a + (r.chosenOdd ?? 0), 0) / (bets.length || 1);
	const wr = ((bets.length - losses) / (bets.length || 1)) * 100;
	// break-even exato na odd média: 0.935*WR = (odd-1)*(1-WR)
	const be = ((avgOdd - 1) / (avgOdd - 1 + (1 - COMMISSION_RATE))) * 100;
	const ci = bootstrapSummary(results, B);
	console.log(`\n📊 ${label}  (n=${results.length} corridas, B=${B})`);
	console.log(
		`   apostas=${bets.length}  WR=${wr.toFixed(2)}%  odd média=${avgOdd.toFixed(2)}  break-even=${be.toFixed(2)}%  margem=${(wr - be).toFixed(2)}pp`,
	);
	console.log(
		`   P/L total: ${pnl.toFixed(0)}  |  IC95 [${ci.pnl.lo95.toFixed(0)}, ${ci.pnl.hi95.toFixed(0)}]`,
	);
	console.log(
		`   ROI/aposta: ${((pnl / (bets.length * STAKE)) * 100).toFixed(1)}%  |  IC95 [${((ci.pnl.lo95 / (bets.length * STAKE)) * 100).toFixed(1)}%, ${((ci.pnl.hi95 / (bets.length * STAKE)) * 100).toFixed(1)}%]`,
	);
	console.log(
		`   ${ci.pnl.lo95 > 0 ? "✅ edge > 0 com significância (IC95 não cruza zero)" : "⚠️  IC95 CRUZA ZERO — não dá pra afirmar que o edge existe"}`,
	);
}

async function main(): Promise<void> {
	console.log(
		"🧪 Bootstrap: o edge do modo HONESTO (morningwap→BSP) é > 0? (DEV-ONLY)\n",
	);
	console.log(
		`📋 janela=${EVAL_DAYS}d | B=${B} | comissão=${(COMMISSION_RATE * 100).toFixed(1)}% | range=[${MIN_ODD_THRESHOLD},${MAX_ODD_THRESHOLD}]`,
	);
	await mongoose.connect(process.env.MONGOOSE as string);

	const { lookup, files } = loadBspLookup(BSP_DIR);
	console.log(`📂 BSP: ${files} arquivos, ${lookup.size} chaves`);

	const pooled: SimResult[] = [];
	for (const group of GROUPS) {
		const model = await loadModelFromPath(group.path, group.mtype);
		const raceMap = await loadPeriodData(group.types, EVAL_DAYS, 0);
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
		for (const [, hs] of raceMap)
			for (const h of hs) {
				const race = races.get(h.race_id);
				const rh = horsesTbl.get(h.race_horse_id);
				if (!race || !rh?.horse) continue;
				const found = lookupBsp(lookup, race.date, normName(rh.horse));
				if (found)
					oddsByRh.set(h.race_horse_id, {
						bsp: found.row.bsp,
						morningwap: found.row.morningwap,
					});
			}
		const res = simulateHonest(raceMap, model, (id) => oddsByRh.get(id));
		summarize(group.name, res);
		pooled.push(...res);
		model.model.dispose();
	}

	if (GROUPS.length > 1) summarize("TOTAL (Flat+Jump)", pooled);

	await mongoose.disconnect();
	console.log("\n✅ Concluído.");
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
