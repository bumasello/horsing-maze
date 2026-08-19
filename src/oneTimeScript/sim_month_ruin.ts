// RISCO DE RUÍNA DEV-ONLY: a banca de R$200 sobrevive a um mês? (meta novembro)
//
// Monte Carlo sobre o modo HONESTO (seleção por morningwap, liquidação no BSP
// real). Reamostra DIAS com reposição pra montar meses sintéticos de 30 dias e
// replica as apostas em ordem, com a regra de caixa real do LAY:
//
//   responsabilidade (liability) = stake × (odd − 1)
//   só dá pra apostar se banca ≥ liability; senão a aposta é PULADA
//   ruína = banca < liability mínima da banda → não consegue mais apostar
//
// Compara políticas de staking: stake fixo vs stake proporcional à banca
// (% de liability), pra achar o que sobrevive.
//
// Uso: nvm use 20 && PORT=3990 BSP_DIR=/caminho npx ts-node \
//      src/oneTimeScript/sim_month_ruin.ts
// Env: EVAL_DAYS (180), MONTHS (10000), DAYS_IN_MONTH (30), BANK0 (200),
//      BSP_DIR, GROUPS ("Flat,Jump")

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
import {
	type HorseRecord,
	loadModelFromPath,
	loadPeriodData,
	predictRace,
} from "../services/ml/eval/harness";
import { COMMISSION_RATE } from "../services/ml/eval/simulator";
import { getDataSchema } from "../shared/db-config";

const EVAL_DAYS = Number(process.env.EVAL_DAYS || 180);
const MONTHS = Number(process.env.MONTHS || 10000);
const DAYS_IN_MONTH = Number(process.env.DAYS_IN_MONTH || 30);
const BANK0 = Number(process.env.BANK0 || 200);
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

/** Uma aposta que o modelo faria: odd de liquidação + se o cavalo venceu. */
interface Bet {
	date: string;
	odd: number;
	horseWon: boolean;
}

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

function collectBets(
	raceMap: Map<number, HorseRecord[]>,
	model: Awaited<ReturnType<typeof loadModelFromPath>>,
	oddsOf: (rhId: number) => Odds | undefined,
	out: Bet[],
): void {
	for (const [, horses] of raceMap) {
		if (horses.length < 3) continue;
		const pLose = predictRace(horses, model);
		const cands: Array<{ h: HorseRecord; combined: number }> = [];
		for (let i = 0; i < horses.length; i++) {
			if (pLose[i] < 0) continue;
			const od = oddsOf(horses[i].race_horse_id);
			const selOdd = od?.morningwap ?? horses[i].market_odd;
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
			const settleOdd = od?.bsp ?? c.h.market_odd;
			if (!settleOdd || settleOdd <= 0) continue;
			if (settleOdd < MIN_ODD_THRESHOLD || settleOdd > MAX_ODD_THRESHOLD)
				continue;
			out.push({
				date: c.h.race_date,
				odd: settleOdd,
				horseWon: c.h.finish_position === 1,
			});
			break;
		}
	}
}

type Policy = {
	label: string;
	/** stake dado banca atual; 0 = não apostar */
	stake: (bank: number, odd: number) => number;
};

interface MonthOut {
	ruin: number;
	positive: number;
	finals: number[];
	betsPlaced: number[];
	skipped: number[];
}

function runPolicy(byDay: Bet[][], p: Policy): MonthOut {
	const out: MonthOut = {
		ruin: 0,
		positive: 0,
		finals: [],
		betsPlaced: [],
		skipped: [],
	};
	for (let m = 0; m < MONTHS; m++) {
		let bank = BANK0;
		let placed = 0;
		let skip = 0;
		let busted = false;
		for (let d = 0; d < DAYS_IN_MONTH && !busted; d++) {
			const day = byDay[Math.floor(Math.random() * byDay.length)];
			for (const b of day) {
				const st = p.stake(bank, b.odd);
				const liability = st * (b.odd - 1);
				if (st <= 0 || liability > bank) {
					skip++;
					continue;
				}
				placed++;
				bank += b.horseWon ? -liability : st * (1 - COMMISSION_RATE);
				// ruína: não cobre nem a menor responsabilidade possível da banda
				if (bank < p.stake(bank, MIN_ODD_THRESHOLD) * (MIN_ODD_THRESHOLD - 1)) {
					busted = true;
					break;
				}
			}
		}
		if (busted) out.ruin++;
		if (bank > BANK0) out.positive++;
		out.finals.push(bank);
		out.betsPlaced.push(placed);
		out.skipped.push(skip);
	}
	return out;
}

const q = (a: number[], p: number) => {
	const s = [...a].sort((x, y) => x - y);
	return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

function report(p: Policy, o: MonthOut): void {
	console.log(`\n📊 ${p.label}`);
	console.log(
		`   P(ruína no mês) = ${((o.ruin / MONTHS) * 100).toFixed(1)}%   P(termina positivo) = ${((o.positive / MONTHS) * 100).toFixed(1)}%`,
	);
	console.log(
		`   banca final: mediana ${q(o.finals, 0.5).toFixed(0)} | p5 ${q(o.finals, 0.05).toFixed(0)} | p95 ${q(o.finals, 0.95).toFixed(0)}`,
	);
	console.log(
		`   apostas/mês: média ${mean(o.betsPlaced).toFixed(0)} | puladas por falta de caixa: ${mean(o.skipped).toFixed(0)}`,
	);
}

async function main(): Promise<void> {
	console.log("🎲 Risco de ruína — banca 200 sobrevive a um mês? (DEV-ONLY)\n");
	console.log(
		`📋 janela=${EVAL_DAYS}d | ${MONTHS} meses sintéticos de ${DAYS_IN_MONTH}d | banca inicial=${BANK0} | comissão=${(COMMISSION_RATE * 100).toFixed(1)}%`,
	);
	await mongoose.connect(process.env.MONGOOSE as string);

	const { lookup, files } = loadBspLookup(BSP_DIR);
	console.log(`📂 BSP: ${files} arquivos, ${lookup.size} chaves`);

	const bets: Bet[] = [];
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
		collectBets(raceMap, model, (id) => oddsByRh.get(id), bets);
		model.model.dispose();
	}

	// agrupa por dia — a unidade de reamostragem
	const dayMap = new Map<string, Bet[]>();
	for (const b of bets)
		(dayMap.get(b.date) ?? (dayMap.set(b.date, []).get(b.date) as Bet[])).push(
			b,
		);
	const byDay = Array.from(dayMap.values());
	const losses = bets.filter((b) => b.horseWon).length;
	console.log(
		`\n🏁 ${bets.length} apostas em ${byDay.length} dias (${(bets.length / byDay.length).toFixed(1)}/dia) | derrotas ${losses} (WR ${(((bets.length - losses) / bets.length) * 100).toFixed(2)}%)`,
	);
	console.log(
		`   responsabilidade por aposta na odd média: ${(mean(bets.map((b) => b.odd)) - 1).toFixed(1)}× o stake`,
	);

	const policies: Policy[] = [
		{ label: "A. stake fixo 10 (atual)", stake: () => 10 },
		{ label: "B. stake fixo 5", stake: () => 5 },
		{ label: "C. stake fixo 2", stake: () => 2 },
		{
			label: "D. liability = 10% da banca",
			stake: (bank, odd) => (bank * 0.1) / (odd - 1),
		},
		{
			label: "E. liability = 5% da banca",
			stake: (bank, odd) => (bank * 0.05) / (odd - 1),
		},
		{
			label: "F. liability = 2% da banca",
			stake: (bank, odd) => (bank * 0.02) / (odd - 1),
		},
	];
	for (const p of policies) report(p, runPolicy(byDay, p));

	await mongoose.disconnect();
	console.log("\n✅ Concluído.");
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
