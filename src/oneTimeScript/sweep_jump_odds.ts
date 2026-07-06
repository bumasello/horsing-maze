// Sweep DEV-ONLY de bandas de odd pro JUMP: existe faixa em que a estratégia
// LAY é lucrativa em jump, como [13,20] foi pro Flat?
//
// Motivação: 2026-07-06 — primeiro eval ROI de jump revelou edge NEGATIVO
// (prod v65-jump −2.81pp, candidato multitask −2.45pp) com as regras [13,20]
// que foram tunadas em dados FLAT. Este sweep varia SÓ a elegibilidade da
// cascata (metodologia igual ao sweep de MIN_ODD do Flat de 2026-07-01);
// o combined_score mantém a rampa de prod.
//
// Modelos: candidato multitask (baselines/candidate_jump, softmax e
// heads_avg) + prod v65-jump. P(lose) cacheado por corrida (1 inferência
// por corrida/modelo, reusada em todas as bandas).
//
// Uso: nvm use 20 && PORT=3999 npx ts-node src/oneTimeScript/sweep_jump_odds.ts
// Env: SWEEP_DAYS (180)

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import {
	type HorseRecord,
	type LoadedModel,
	evaluateWithPredictor,
	loadModelFromPath,
	loadPeriodData,
	predictRace,
	predictRaceLoseHead,
} from "../services/ml/eval/harness";
import { COMMISSION_RATE } from "../services/ml/eval/simulator";

const SWEEP_DAYS = Number(process.env.SWEEP_DAYS || 180);
const CANDIDATE_PATH = "horse_probability_model/baselines/candidate_jump";
const PROD_PATH = "horse_probability_model/claude-ml-model-jump";
const JUMP_RACE_TYPES = ["Hurdle", "Chase", "NHF"];

// Bandas [min, max) de elegibilidade da cascata
const BANDS: Array<[number, number]> = [
	[4, 8],
	[4, 12],
	[4, 20],
	[6, 12],
	[6, 15],
	[8, 15],
	[8, 20],
	[10, 17],
	[10, 20],
	[13, 17],
	[13, 20], // regra atual (tunada em Flat)
	[15, 20],
	[13, 25],
	[17, 25],
];

function cachedPredictor(
	raceMap: Map<number, HorseRecord[]>,
	fn: (horses: HorseRecord[]) => number[],
): (horses: HorseRecord[]) => number[] {
	const cache = new Map<number, number[]>();
	for (const [raceId, horses] of raceMap) cache.set(raceId, fn(horses));
	return (horses: HorseRecord[]) =>
		cache.get(horses[0].race_id) ?? new Array(horses.length).fill(-1);
}

async function main(): Promise<void> {
	console.log("🧪 Sweep de bandas de odd — JUMP (DEV-ONLY)\n");
	console.log(
		`📋 janela=[${SWEEP_DAYS}d,0) | comissão=${(COMMISSION_RATE * 100).toFixed(1)}% | ${BANDS.length} bandas\n`,
	);

	console.log("🔌 Conectando MongoDB...");
	await mongoose.connect(process.env.MONGOOSE as string);

	console.log("📥 Carregando modelos...");
	const candidate = await loadModelFromPath(CANDIDATE_PATH, "jump");
	console.log(`  ✅ candidato: ${candidate.config.features.length} feat`);
	const prod = await loadModelFromPath(PROD_PATH, "jump");
	console.log(
		`  ✅ prod v${prod.config.version}: ${prod.config.features.length} feat`,
	);

	console.log(`\n📥 Dados jump [${SWEEP_DAYS}d,0)...`);
	const raceMap = await loadPeriodData(JUMP_RACE_TYPES, SWEEP_DAYS, 0);
	console.log(`  🏁 ${raceMap.size} corridas\n`);

	const predictors: Array<{
		label: string;
		fn: (horses: HorseRecord[]) => number[];
	}> = [
		{
			label: "cand_softmax",
			fn: cachedPredictor(raceMap, (h) => predictRace(h, candidate)),
		},
		{
			label: "cand_headsavg",
			fn: cachedPredictor(raceMap, (h) => {
				const sm = predictRace(h, candidate);
				const lh = predictRaceLoseHead(h, candidate);
				if (!lh) return sm;
				return sm.map((p, i) => (p < 0 || lh[i] < 0 ? -1 : (p + lh[i]) / 2));
			}),
		},
		{
			label: "prod_v65",
			fn: cachedPredictor(raceMap, (h) => predictRace(h, prod)),
		},
	];

	for (const p of predictors) {
		console.log(`\n=== ${p.label} ===`);
		console.log(
			"banda      | apostas | win rate | edge     | pnl      | maxDD",
		);
		console.log("-".repeat(66));
		let best: { band: string; edge: number; pnl: number } | null = null;
		for (const [lo, hi] of BANDS) {
			const s = evaluateWithPredictor(`${p.label}_${lo}_${hi}`, raceMap, p.fn, {
				minOdd: lo,
				maxOdd: hi,
			});
			const label = `[${lo},${hi}]`.padEnd(10);
			const marker = lo === 13 && hi === 20 ? " ← atual" : "";
			console.log(
				`${label} | ${String(s.betsPlaced).padStart(7)} | ${(s.winRate * 100).toFixed(2).padStart(7)}% | ${(s.edge * 100).toFixed(2).padStart(6)}pp | ${s.totalPnl.toFixed(0).padStart(8)} | ${s.maxDrawdown.toFixed(0).padStart(6)}${marker}`,
			);
			if (s.betsPlaced >= 50 && (!best || s.totalPnl > best.pnl)) {
				best = { band: `[${lo},${hi}]`, edge: s.edge * 100, pnl: s.totalPnl };
			}
		}
		if (best) {
			console.log(
				`  🏆 melhor banda (≥50 apostas): ${best.band} — edge ${best.edge.toFixed(2)}pp, pnl ${best.pnl.toFixed(0)}`,
			);
		}
	}

	console.log(
		"\n⚠️ NOTA: edge é vs break-even da odd 20; em bandas de odd baixa o",
	);
	console.log(
		"   break-even real é menor — o PNL (com odd real) é a métrica comparável entre bandas.",
	);

	candidate.model.dispose();
	prod.model.dispose();
	await mongoose.disconnect();
	console.log("\n✅ Concluído.");
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
