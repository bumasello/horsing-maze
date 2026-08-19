// SWEEP DEV-ONLY: qual banda de odd sobrevive a um mês com banca de R$200?
//
// Contexto (2026-08-12): o mínimo da Betfair em BRL é R$5 de STAKE. Na banda
// atual [13,20] isso dá responsabilidade de ~R$76 por aposta = 38% de uma
// banca de 200 → ruína estrutural (44% no melhor caso). Como liability escala
// com (odd−1), odd menor é a única saída aritmética. A pergunta empírica é se
// o modelo TEM edge em odd baixa.
//
// Avaliação honesta: seleção pela odd da manhã (morningwap), liquidação no
// BSP real, ambos dentro da banda testada. Monte Carlo de meses sintéticos
// com o mínimo de R$5 respeitado.
//
// Uso: nvm use 20 && PORT=3989 BSP_DIR=/caminho npx ts-node \
//      src/oneTimeScript/sweep_band_ruin.ts
// Env: EVAL_DAYS (180), MONTHS (5000), BANK0 (200), MIN_STAKE (5), BSP_DIR

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

const EVAL_DAYS = Number(process.env.EVAL_DAYS || 180);
const MONTHS = Number(process.env.MONTHS || 5000);
const DAYS_IN_MONTH = Number(process.env.DAYS_IN_MONTH || 30);
const BANK0 = Number(process.env.BANK0 || 200);
const MIN_STAKE = Number(process.env.MIN_STAKE || 5); // mínimo Betfair BRL
const BSP_DIR = process.env.BSP_DIR || "/home/mazedev/betfair_sp_data";

const BANDS: Array<[number, number]> = [
	[1.01, 2],
	[1.2, 2.2],
	[1.5, 2.5],
	[1.5, 3],
	[1.8, 3.5],
	[2, 3],
	[2, 4],
	[3, 6],
	[4, 8],
	[5, 10],
	[6, 12],
	[8, 15],
	[10, 16],
	[13, 20],
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
interface Bet {
	date: string;
	odd: number;
	horseWon: boolean;
	raceId: number;
}
interface Loaded {
	raceMap: Map<number, HorseRecord[]>;
	model: Awaited<ReturnType<typeof loadModelFromPath>>;
	oddsOf: (id: number) => Odds | undefined;
	pLoseCache: Map<number, Float32Array | number[]>;
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

/** combined_score do prod, mas com a banda parametrizada. */
function combinedScore(
	p: number,
	ivl: number,
	odd: number,
	lo: number,
	hi: number,
): number {
	const ivlScore = Math.min(ivl / 2, 1);
	// sweet spot proporcional: plateau no terço central da banda
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

function collectBets(L: Loaded, lo: number, hi: number): Bet[] {
	const bets: Bet[] = [];
	for (const [raceId, horses] of L.raceMap) {
		if (horses.length < 3) continue;
		const pLose = L.pLoseCache.get(raceId) as number[];
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
		for (const c of cands.slice(0, 3)) {
			if (c.h.non_runner) continue;
			const od = L.oddsOf(c.h.race_horse_id);
			const settle = od?.bsp ?? c.h.market_odd;
			if (!settle || settle < lo || settle > hi) continue;
			bets.push({
				date: c.h.race_date,
				odd: settle,
				horseWon: c.h.finish_position === 1,
				raceId,
			});
			break;
		}
	}
	return bets;
}

/** Monte Carlo: stake = max(MIN_STAKE, fração da banca); pula se não cobre. */
function ruinSim(
	byDay: Bet[][],
	fracLiability: number,
): {
	ruin: number;
	positive: number;
	finals: number[];
	placed: number[];
} {
	const finals: number[] = [];
	const placed: number[] = [];
	let ruin = 0;
	let positive = 0;
	for (let m = 0; m < MONTHS; m++) {
		let bank = BANK0;
		let n = 0;
		let busted = false;
		for (let d = 0; d < DAYS_IN_MONTH && !busted; d++) {
			const day = byDay[Math.floor(Math.random() * byDay.length)];
			for (const b of day) {
				const target =
					fracLiability > 0 ? (bank * fracLiability) / (b.odd - 1) : MIN_STAKE;
				const stake = Math.max(MIN_STAKE, target);
				const liability = stake * (b.odd - 1);
				if (liability > bank) continue; // não cobre: não aposta
				n++;
				bank += b.horseWon ? -liability : stake * (1 - COMMISSION_RATE);
				if (bank < MIN_STAKE * (b.odd - 1)) {
					busted = true;
					break;
				}
			}
		}
		if (busted) ruin++;
		if (bank > BANK0) positive++;
		finals.push(bank);
		placed.push(n);
	}
	return { ruin, positive, finals, placed };
}

const q = (a: number[], p: number) => {
	const s = [...a].sort((x, y) => x - y);
	return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

async function main(): Promise<void> {
	console.log("🔎 Sweep de banda de odd × sobrevivência da banca (DEV-ONLY)\n");
	console.log(
		`📋 ${EVAL_DAYS}d | ${MONTHS} meses de ${DAYS_IN_MONTH}d | banca ${BANK0} | stake mín Betfair R$${MIN_STAKE} | comissão ${(COMMISSION_RATE * 100).toFixed(1)}%`,
	);
	await mongoose.connect(process.env.MONGOOSE as string);
	const { lookup, files } = loadBspLookup(BSP_DIR);
	console.log(`📂 BSP: ${files} arquivos, ${lookup.size} chaves`);

	const loaded: Loaded[] = [];
	for (const g of GROUPS) {
		const model = await loadModelFromPath(g.path, g.mtype);
		const raceMap = await loadPeriodData(g.types, EVAL_DAYS, 0);
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
		// predição é cara: roda uma vez por corrida e reusa em todas as bandas
		const pLoseCache = new Map<number, number[]>();
		for (const [rid, hs] of raceMap)
			if (hs.length >= 3)
				pLoseCache.set(rid, Array.from(predictRace(hs, model)));
		loaded.push({
			raceMap,
			model,
			oddsOf: (id) => oddsByRh.get(id),
			pLoseCache,
		});
		console.log(`   ${g.name}: ${raceIds.length} corridas carregadas`);
	}

	console.log(
		`\n${"banda".padEnd(11)}${"apostas".padStart(8)}${"/dia".padStart(6)}${"WR".padStart(8)}${"b/even".padStart(8)}${"marg".padStart(7)}${"ROI".padStart(8)}${"liab/aposta".padStart(12)}${"P(ruína)".padStart(10)}${"P(pos)".padStart(8)}${"mediana".padStart(9)}${"IC95 P/L".padStart(20)}`,
	);
	console.log("─".repeat(115));

	for (const [lo, hi] of BANDS) {
		const bets: Bet[] = [];
		let nRaces = 0;
		for (const L of loaded) {
			bets.push(...collectBets(L, lo, hi));
			nRaces += L.pLoseCache.size;
		}
		if (bets.length < 30) {
			console.log(
				`[${lo},${hi}]`.padEnd(11) +
					`${bets.length}`.padStart(8) +
					"   (amostra insuficiente)",
			);
			continue;
		}
		const dayMap = new Map<string, Bet[]>();
		for (const b of bets) {
			const arr = dayMap.get(b.date);
			if (arr) arr.push(b);
			else dayMap.set(b.date, [b]);
		}
		const byDay = Array.from(dayMap.values());
		const losses = bets.filter((b) => b.horseWon).length;
		const wr = ((bets.length - losses) / bets.length) * 100;
		const avgOdd = mean(bets.map((b) => b.odd));
		const be = ((avgOdd - 1) / (avgOdd - 1 + (1 - COMMISSION_RATE))) * 100;
		// ROI com stake fixo no mínimo
		let pnl = 0;
		for (const b of bets)
			pnl += b.horseWon
				? -MIN_STAKE * (b.odd - 1)
				: MIN_STAKE * (1 - COMMISSION_RATE);
		const roi = (pnl / (bets.length * MIN_STAKE)) * 100;
		// cluster bootstrap por corrida: IC95 do P/L com stake mínimo
		const pnlByRace = new Map<number, number>();
		for (const b of bets)
			pnlByRace.set(
				b.raceId,
				b.horseWon
					? -MIN_STAKE * (b.odd - 1)
					: MIN_STAKE * (1 - COMMISSION_RATE),
			);
		const racePnls: number[] = new Array(nRaces).fill(0);
		let k = 0;
		for (const v of pnlByRace.values()) racePnls[k++] = v;
		const boot: number[] = [];
		for (let bIt = 0; bIt < 2000; bIt++) {
			let acc = 0;
			for (let j = 0; j < racePnls.length; j++)
				acc += racePnls[Math.floor(Math.random() * racePnls.length)];
			boot.push(acc);
		}
		boot.sort((x, y) => x - y);
		const lo95 = boot[Math.floor(0.025 * boot.length)];
		const hi95 = boot[Math.floor(0.975 * boot.length)];

		const r = ruinSim(byDay, 0); // stake fixo no mínimo = melhor caso de sobrevivência
		console.log(
			`[${lo},${hi}]`.padEnd(11) +
				`${bets.length}`.padStart(8) +
				`${(bets.length / byDay.length).toFixed(1)}`.padStart(6) +
				`${wr.toFixed(2)}%`.padStart(8) +
				`${be.toFixed(2)}%`.padStart(8) +
				`${(wr - be >= 0 ? "+" : "") + (wr - be).toFixed(2)}`.padStart(7) +
				`${(roi >= 0 ? "+" : "") + roi.toFixed(1)}%`.padStart(8) +
				`R$${(MIN_STAKE * (avgOdd - 1)).toFixed(0)}`.padStart(12) +
				`${((r.ruin / MONTHS) * 100).toFixed(1)}%`.padStart(10) +
				`${((r.positive / MONTHS) * 100).toFixed(0)}%`.padStart(8) +
				`${q(r.finals, 0.5).toFixed(0)}`.padStart(9) +
				`[${lo95.toFixed(0)}, ${hi95.toFixed(0)}]${lo95 > 0 ? " ✅" : ""}`.padStart(
					20,
				),
		);
	}

	for (const L of loaded) L.model.model.dispose();
	await mongoose.disconnect();
	console.log("\n✅ Concluído.");
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
