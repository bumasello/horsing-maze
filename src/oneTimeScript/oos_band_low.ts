// OUT-OF-SAMPLE DEV-ONLY: a banda [1.5,3] é sinal ou seleção do sweep?
//
// O sweep_band_ruin testou 14 bandas na janela [180,0) e [1.5,3] saiu melhor
// (+3.70pp de margem, ROI +10%). Mas bandas vizinhas sobrepostas deram sinal
// oposto — assinatura de ruído. Este script re-testa a MESMA banda, sem sweep,
// numa janela ANTERIOR e DISJUNTA: [360,180).
//
// Se o edge reaparecer com sinal igual, vira candidato. Se sumir ou inverter,
// era seleção e a banda está morta.
//
// Uso: nvm use 20 && PORT=3987 BSP_DIR=/caminho npx ts-node \
//      src/oneTimeScript/oos_band_low.ts
// Env: LO (1.5), HI (3), IN_DAYS (180), OOS_DAYS (180), B (2000), BSP_DIR

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

const LO = Number(process.env.LO || 1.5);
const HI = Number(process.env.HI || 3);
const IN_DAYS = Number(process.env.IN_DAYS || 180);
const OOS_DAYS = Number(process.env.OOS_DAYS || 180);
const B = Number(process.env.B || 2000);
const MIN_STAKE = Number(process.env.MIN_STAKE || 5);
const BSP_DIR = process.env.BSP_DIR || "/home/mazedev/betfair_sp_data";

const GROUPS = [
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

interface Odds {
	bsp?: number;
	morningwap?: number;
}
interface Bet {
	odd: number;
	horseWon: boolean;
	raceId: number;
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

function combinedScore(p: number, ivl: number, odd: number): number {
	const ivlScore = Math.min(ivl / 2, 1);
	const a = LO + (HI - LO) * 0.33;
	const b = LO + (HI - LO) * 0.67;
	let oddScore = 0;
	if (odd >= LO && odd <= HI) {
		if (odd >= a && odd <= b) oddScore = 1;
		else if (odd < a) oddScore = (odd - LO) / (a - LO);
		else oddScore = 1 - (odd - b) / (HI - b);
	}
	return p * 0.4 + ivlScore * 0.4 + oddScore * 0.2;
}

async function windowBets(
	endDaysAgo: number,
	lookup: ReturnType<typeof loadBspLookup>["lookup"],
): Promise<{ bets: Bet[]; nRaces: number }> {
	const bets: Bet[] = [];
	let nRaces = 0;
	for (const g of GROUPS) {
		const model = await loadModelFromPath(g.path, g.mtype);
		const raceMap = await loadPeriodData(g.types, IN_DAYS, endDaysAgo);
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
				const f = lookupBsp(lookup, race.date, normName(rh.horse));
				if (f)
					oddsByRh.set(h.race_horse_id, {
						bsp: f.row.bsp,
						morningwap: f.row.morningwap,
					});
			}
		for (const [raceId, horses] of raceMap) {
			if (horses.length < 3) continue;
			nRaces++;
			const pLose = predictRace(horses, model);
			const cands: Array<{ h: HorseRecord; s: number }> = [];
			for (let i = 0; i < horses.length; i++) {
				if (pLose[i] < 0) continue;
				const od = oddsByRh.get(horses[i].race_horse_id);
				const selOdd = od?.morningwap ?? horses[i].market_odd;
				if (!selOdd || selOdd < LO || selOdd > HI) continue;
				const ivl = calculateLayValueIndex(pLose[i], selOdd);
				cands.push({ h: horses[i], s: combinedScore(pLose[i], ivl, selOdd) });
			}
			cands.sort((x, y) => y.s - x.s);
			for (const c of cands.slice(0, 3)) {
				if (c.h.non_runner) continue;
				const od = oddsByRh.get(c.h.race_horse_id);
				const settle = od?.bsp ?? c.h.market_odd;
				if (!settle || settle < LO || settle > HI) continue;
				bets.push({ odd: settle, horseWon: c.h.finish_position === 1, raceId });
				break;
			}
		}
		model.model.dispose();
	}
	return { bets, nRaces };
}

function report(label: string, bets: Bet[], nRaces: number): void {
	if (bets.length < 20)
		return void console.log(
			`\n📊 ${label}: amostra insuficiente (${bets.length})`,
		);
	const losses = bets.filter((b) => b.horseWon).length;
	const wr = ((bets.length - losses) / bets.length) * 100;
	const avgOdd = bets.reduce((a, b) => a + b.odd, 0) / bets.length;
	const be = ((avgOdd - 1) / (avgOdd - 1 + (1 - COMMISSION_RATE))) * 100;
	let pnl = 0;
	const perRace: number[] = new Array(nRaces).fill(0);
	let k = 0;
	for (const b of bets) {
		const v = b.horseWon
			? -MIN_STAKE * (b.odd - 1)
			: MIN_STAKE * (1 - COMMISSION_RATE);
		pnl += v;
		perRace[k++] = v;
	}
	const boot: number[] = [];
	for (let i = 0; i < B; i++) {
		let acc = 0;
		for (let j = 0; j < perRace.length; j++)
			acc += perRace[Math.floor(Math.random() * perRace.length)];
		boot.push(acc);
	}
	boot.sort((x, y) => x - y);
	const lo95 = boot[Math.floor(0.025 * B)];
	const hi95 = boot[Math.floor(0.975 * B)];
	const roi = (pnl / (bets.length * MIN_STAKE)) * 100;
	console.log(`\n📊 ${label}`);
	console.log(
		`   apostas=${bets.length} (${nRaces} corridas)  WR=${wr.toFixed(2)}%  break-even=${be.toFixed(2)}%  margem=${(wr - be >= 0 ? "+" : "") + (wr - be).toFixed(2)}pp`,
	);
	console.log(
		`   odd média=${avgOdd.toFixed(2)}  P/L=${pnl.toFixed(0)}  ROI=${(roi >= 0 ? "+" : "") + roi.toFixed(1)}%  IC95 [${lo95.toFixed(0)}, ${hi95.toFixed(0)}]`,
	);
	console.log(
		`   ${lo95 > 0 ? "✅ positivo com significância" : hi95 < 0 ? "❌ NEGATIVO com significância" : "⚠️  IC95 cruza zero"}`,
	);
}

async function main(): Promise<void> {
	console.log(
		`🧭 Out-of-sample da banda [${LO},${HI}] — sinal ou seleção do sweep? (DEV-ONLY)\n`,
	);
	console.log(
		`📋 in-sample=[${IN_DAYS + OOS_DAYS - IN_DAYS},0)d | out-of-sample=[${IN_DAYS + OOS_DAYS},${OOS_DAYS})d | stake ${MIN_STAKE} | comissão ${(COMMISSION_RATE * 100).toFixed(1)}%`,
	);
	await mongoose.connect(process.env.MONGOOSE as string);
	const { lookup, files } = loadBspLookup(BSP_DIR);
	console.log(`📂 BSP: ${files} arquivos, ${lookup.size} chaves`);

	const inS = await windowBets(0, lookup);
	report(
		`IN-SAMPLE — janela [${IN_DAYS},0) (onde a banda foi escolhida)`,
		inS.bets,
		inS.nRaces,
	);

	const oos = await windowBets(OOS_DAYS, lookup);
	report(
		`OUT-OF-SAMPLE — janela [${IN_DAYS + OOS_DAYS},${OOS_DAYS}) (nunca vista)`,
		oos.bets,
		oos.nRaces,
	);

	await mongoose.disconnect();
	console.log("\n✅ Concluído.");
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
