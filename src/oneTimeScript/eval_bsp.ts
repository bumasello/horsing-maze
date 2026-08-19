// EVAL DEV-ONLY: ROI com BSP real vs SP, Flat + Jump, 3 modos de execução.
//
// Modos (odd de SELEÇÃO / odd de LIQUIDAÇÃO):
//   1. sp / sp        → baseline (~o que media até 12/07)
//   2. sp / bsp       → seleção pelo SP, liquida no BSP real (ordem c/ limite)
//   3. morningwap/bsp → HONESTO PLENO: seleciona pela odd da manhã (conhecida
//                       pré-corrida, sem look-ahead) e liquida no BSP real
//
// Liquidação = ordem LAY ao BSP com limite [MIN,MAX]: só casa se a odd de
// liquidação ∈ range; P/L perda = -stake×(odd-1). Sem BSP (join ~13% miss) →
// fallback sp_decimal em ambas as odds.
//
// Uso: nvm use 20 && PORT=3995 BSP_DIR=/home/mazedev/betfair_sp_data \
//      npx ts-node src/oneTimeScript/eval_bsp.ts
// Env: EVAL_DAYS (180), BSP_DIR, GROUPS ("Flat,Jump")

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
import { COMMISSION_RATE, STAKE, WIN_PNL } from "../services/ml/eval/simulator";

const EVAL_DAYS = Number(process.env.EVAL_DAYS || 180);
const BSP_DIR = process.env.BSP_DIR || "/home/mazedev/betfair_sp_data";
const BANK0 = 200;
// Grupos de modelo: Flat e Jump (Jump = Hurdle+Chase+NHF, mesmos race_type do
// training_final.ts). Filtro via env GROUPS ("Flat,Jump").
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

interface Odds {
	bsp?: number;
	morningwap?: number;
}
type Mode = { sel: "sp" | "mw"; settle: "sp" | "bsp" };

interface SimOut {
	bets: number;
	wins: number;
	losses: number;
	pnl: number;
	oddSum: number;
	bspUsed: number;
	spFallback: number;
}
function blank(): SimOut {
	return {
		bets: 0,
		wins: 0,
		losses: 0,
		pnl: 0,
		oddSum: 0,
		bspUsed: 0,
		spFallback: 0,
	};
}

function simulate(
	raceMap: Map<number, HorseRecord[]>,
	model: LoadedModel,
	oddsOf: (rhId: number) => Odds | undefined,
	mode: Mode,
	acc: SimOut,
): void {
	for (const [, horses] of raceMap) {
		if (horses.length < 3) continue;
		const pLose = predictRace(horses, model);
		const cands = [];
		for (let i = 0; i < horses.length; i++) {
			if (pLose[i] < 0) continue;
			const od = oddsOf(horses[i].race_horse_id);
			// odd de SELEÇÃO: morningwap (fallback sp) ou sp
			const selOdd =
				mode.sel === "mw"
					? (od?.morningwap ?? horses[i].market_odd)
					: horses[i].market_odd;
			if (!selOdd || selOdd <= 0) continue;
			const ivl = calculateLayValueIndex(pLose[i], selOdd);
			cands.push({
				h: horses[i],
				combined: calculateCombinedScore(pLose[i], ivl, selOdd),
			});
		}
		cands.sort((a, b) => b.combined - a.combined);
		for (const c of cands.slice(0, 3)) {
			if (c.h.non_runner) continue;
			const od = oddsOf(c.h.race_horse_id);
			const bsp = od?.bsp;
			const settleOdd =
				mode.settle === "bsp" ? (bsp ?? c.h.market_odd) : c.h.market_odd;
			if (!settleOdd || settleOdd <= 0) continue;
			if (settleOdd < MIN_ODD_THRESHOLD || settleOdd > MAX_ODD_THRESHOLD)
				continue;
			acc.bets++;
			acc.oddSum += settleOdd;
			if (mode.settle === "bsp") {
				if (bsp && bsp > 0) acc.bspUsed++;
				else acc.spFallback++;
			}
			const won = c.h.finish_position === 1;
			acc.pnl += won
				? -STAKE * (settleOdd - 1)
				: WIN_PNL * (1 - COMMISSION_RATE);
			if (won) acc.losses++;
			else acc.wins++;
			break;
		}
	}
}

function report(label: string, o: SimOut): void {
	if (o.bets === 0) return void console.log(`\n📊 ${label}: sem apostas`);
	const roi = (o.pnl / (o.bets * STAKE)) * 100;
	console.log(`\n📊 ${label}`);
	console.log(
		`   apostas=${o.bets}  WR=${((o.wins / o.bets) * 100).toFixed(2)}%  odd média=${(o.oddSum / o.bets).toFixed(2)}`,
	);
	console.log(
		`   P/L=${o.pnl.toFixed(0)}  banca ${BANK0}→${(BANK0 + o.pnl).toFixed(0)}  ROI/aposta=${roi.toFixed(1)}%`,
	);
	if (o.bspUsed + o.spFallback > 0)
		console.log(
			`   liquidação: BSP real=${o.bspUsed} fallback sp=${o.spFallback} (${((o.bspUsed / (o.bspUsed + o.spFallback)) * 100).toFixed(0)}% BSP)`,
		);
}

async function main(): Promise<void> {
	console.log("💰 Eval BSP — Flat+Jump, 3 modos (DEV-ONLY)\n");
	console.log(
		`📋 janela=${EVAL_DAYS}d | comissão=${(COMMISSION_RATE * 100).toFixed(1)}% | range=[${MIN_ODD_THRESHOLD},${MAX_ODD_THRESHOLD}] | grupos=${GROUPS.map((g) => g.name).join("+")}`,
	);
	await mongoose.connect(process.env.MONGOOSE as string);

	const { lookup, files, ambiguous } = loadBspLookup(BSP_DIR);
	console.log(
		`📂 BSP: ${files} arquivos, ${lookup.size} chaves, ${ambiguous} ambíguas`,
	);

	const modes: Array<{ label: string; mode: Mode }> = [
		{ label: "1. sp/sp (baseline)", mode: { sel: "sp", settle: "sp" } },
		{ label: "2. sp/BSP", mode: { sel: "sp", settle: "bsp" } },
		{
			label: "3. morningwap/BSP (honesto pleno)",
			mode: { sel: "mw", settle: "bsp" },
		},
	];
	const totals = modes.map(() => blank());

	for (const group of GROUPS) {
		// override de path via env FLAT_PATH / JUMP_PATH (avaliar baselines)
		const path = process.env[`${group.name.toUpperCase()}_PATH`] || group.path;
		console.log(`\n═══ ${group.name} ═══  (${path})`);
		const model = await loadModelFromPath(path, group.mtype);
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
		const horses = await fetchMap<{ id: number; horse: string }>(
			"race_horses_hr_enriched",
			rhIds,
			"id, horse",
		);
		const oddsByRh = new Map<number, Odds>();
		let matched = 0;
		for (const [, group] of raceMap) {
			for (const h of group) {
				const race = races.get(h.race_id);
				const rh = horses.get(h.race_horse_id);
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
		}
		console.log(
			`🏁 ${raceIds.length} corridas, ${rhIds.length} cavalos | BSP casado ${matched} (${((matched / rhIds.length) * 100).toFixed(1)}%)`,
		);
		const oddsOf = (id: number) => oddsByRh.get(id);

		modes.forEach((m, i) => {
			const o = blank();
			simulate(raceMap, model, oddsOf, m.mode, o);
			report(`[${group.name}] ${m.label}`, o);
			// acumula no total
			const t = totals[i];
			t.bets += o.bets;
			t.wins += o.wins;
			t.losses += o.losses;
			t.pnl += o.pnl;
			t.oddSum += o.oddSum;
			t.bspUsed += o.bspUsed;
			t.spFallback += o.spFallback;
		});
		model.model.dispose();
	}

	console.log(
		`\n\n═══════ TOTAL (${GROUPS.map((g) => g.name).join("+")}) ═══════`,
	);
	modes.forEach((m, i) => report(m.label, totals[i]));

	await mongoose.disconnect();
	console.log("\n✅ Concluído.");
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
