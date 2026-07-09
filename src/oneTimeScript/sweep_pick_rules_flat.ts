// Sweep DEV-ONLY das regras de pick (Flat, prod v68/mt_b05):
//   1. Pesos do combined_score (W_PROB/W_IVL/W_ODD) — os 40/40/20 atuais
//      nunca foram re-tunados após sp_decimal + comissão 6,5%.
//   2. Filtro extra P(lose) >= threshold no cavalo apostado (recomendação
//      da pesquisa de mercado: reduz variância na cauda).
//
// Método: P(lose) do modelo cacheado por corrida (1 inferência), depois
// re-ranqueia candidatos com cada combinação de pesos e simula com as
// MESMAS regras de elegibilidade de prod ([13,20], cascata, comissão,
// P/L odd real). Threshold aplicado como corte de elegibilidade extra.
//
// ⚠️ Janela in-sample pro mt_b05 e sweep multi-config na mesma janela →
// vencedor tem viés de seleção; usar pra ELIMINAR configs ruins e indicar
// direção, não como estimativa de ROI.
//
// Uso: nvm use 20 && PORT=3999 npx ts-node src/oneTimeScript/sweep_pick_rules_flat.ts
// Env: EVAL_DAYS (180)

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import {
	MAX_ODD_THRESHOLD,
	MIN_ODD_THRESHOLD,
	calculateLayValueIndex,
} from "../services/ml/claude-generate-picks";
import {
	BANKROLL_INITIAL,
	type HorseRecord,
	loadModelFromPath,
	loadPeriodData,
	predictRace,
} from "../services/ml/eval/harness";
import { summarize } from "../services/ml/eval/report";
import {
	type PickCandidate,
	simulateRace,
} from "../services/ml/eval/simulator";

const EVAL_DAYS = Number(process.env.EVAL_DAYS || 180);
const PROD_PATH = "horse_probability_model/claude-ml-model-flat";

// Grade de pesos (prob/ivl/odd) — inclui o atual 40/40/20
const WEIGHTS: Array<[number, number, number]> = [
	[0.4, 0.4, 0.2], // atual
	[0.6, 0.3, 0.1],
	[0.6, 0.2, 0.2],
	[0.8, 0.1, 0.1],
	[1.0, 0.0, 0.0], // só P(lose)
	[0.3, 0.6, 0.1],
	[0.2, 0.4, 0.4],
	[0.5, 0.5, 0.0], // sem odd score
];

// Thresholds de P(lose) mínimos no cavalo apostado (0 = sem filtro)
const PLOSE_THRESHOLDS = [0, 0.94, 0.95, 0.96];

function oddRangeScore(marketOdd: number): number {
	// Rampa de prod (13→14 sobe, 14-17 plateau, 17→20 desce)
	if (marketOdd < MIN_ODD_THRESHOLD || marketOdd > MAX_ODD_THRESHOLD) return 0;
	if (marketOdd >= 14 && marketOdd <= 17) return 1;
	if (marketOdd < 14)
		return (marketOdd - MIN_ODD_THRESHOLD) / (14 - MIN_ODD_THRESHOLD);
	return 1 - (marketOdd - 17) / (MAX_ODD_THRESHOLD - 17);
}

async function main(): Promise<void> {
	console.log("🧪 Sweep de regras de pick — Flat (DEV-ONLY)\n");
	console.log(
		`📋 janela=[${EVAL_DAYS}d,0) | ${WEIGHTS.length} pesos × ${PLOSE_THRESHOLDS.length} thresholds\n`,
	);
	await mongoose.connect(process.env.MONGOOSE as string);

	const prod = await loadModelFromPath(PROD_PATH, "flat");
	console.log(`  ✅ prod v${prod.config.version}\n`);

	const raceMap = await loadPeriodData(["Flat"], EVAL_DAYS, 0);
	console.log(`  🏁 ${raceMap.size} corridas\n`);

	// Cache de P(lose) por corrida
	const pLoseCache = new Map<number, number[]>();
	for (const [raceId, horses] of raceMap) {
		pLoseCache.set(raceId, predictRace(horses, prod));
	}
	console.log("  🧠 inferência cacheada\n");

	console.log(
		"pesos (P/IVL/odd) | minP(lose) | apostas | win rate |  edge   |   pnl   | maxDD",
	);
	console.log("-".repeat(84));

	let best: { label: string; pnl: number; edge: number } | null = null;
	for (const [wp, wi, wo] of WEIGHTS) {
		for (const minPLose of PLOSE_THRESHOLDS) {
			let bankroll = BANKROLL_INITIAL;
			const results = [];
			for (const [raceId, horses] of raceMap) {
				if (horses.length < 3) continue;
				const pLose = pLoseCache.get(raceId) ?? [];
				const candidates: PickCandidate[] = [];
				for (let i = 0; i < horses.length; i++) {
					if (pLose[i] < 0) continue;
					if (minPLose > 0 && pLose[i] < minPLose) continue;
					const ivl = calculateLayValueIndex(pLose[i], horses[i].market_odd);
					const ivlScore = Math.min(ivl / 2, 1);
					const combined =
						pLose[i] * wp +
						ivlScore * wi +
						oddRangeScore(horses[i].market_odd) * wo;
					candidates.push({
						race_horse_id: horses[i].race_horse_id,
						horse_id: horses[i].horse_id,
						predicted_probability: pLose[i],
						combined_score: combined,
						ivl_score: ivl,
						market_odd: horses[i].market_odd,
						non_runner: horses[i].non_runner,
						won_race: horses[i].finish_position === 1,
						finish_position: horses[i].finish_position,
					});
				}
				candidates.sort((a, b) => b.combined_score - a.combined_score);
				const sim = simulateRace(
					raceId,
					horses[0].race_date,
					candidates.slice(0, 3),
					bankroll,
					MIN_ODD_THRESHOLD,
					MAX_ODD_THRESHOLD,
					true,
				);
				bankroll = sim.bankrollAfter;
				results.push(sim);
			}
			const s = summarize("sweep", results, BANKROLL_INITIAL);
			const label = `${(wp * 100).toFixed(0)}/${(wi * 100).toFixed(0)}/${(wo * 100).toFixed(0)}`;
			const marker =
				wp === 0.4 && wi === 0.4 && minPLose === 0 ? " ← atual" : "";
			console.log(
				`${label.padEnd(17)} | ${(minPLose || "—").toString().padStart(9)} | ${String(s.betsPlaced).padStart(7)} | ${(s.winRate * 100).toFixed(2).padStart(7)}% | ${(s.edge * 100).toFixed(2).padStart(6)}pp | ${s.totalPnl.toFixed(0).padStart(7)} | ${s.maxDrawdown.toFixed(0).padStart(5)}${marker}`,
			);
			if (s.betsPlaced >= 100 && (!best || s.totalPnl > best.pnl)) {
				best = {
					label: `${label} minP=${minPLose}`,
					pnl: s.totalPnl,
					edge: s.edge * 100,
				};
			}
		}
	}
	if (best)
		console.log(
			`\n🏆 melhor (≥100 apostas): ${best.label} — pnl ${best.pnl.toFixed(0)}, edge ${best.edge.toFixed(2)}pp`,
		);

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
