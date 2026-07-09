// Bootstrap DEV-ONLY: as diferenças que medimos são reais ou ruído?
// Perguntas concretas (decisões pendentes pós-homologação):
//   A. heads_avg vs prod_softmax (+0.21pp medido em 07-06) — trocar inferência?
//   B. filtro P(lose)>=0.94 vs sem filtro (edge 2.16 vs 1.21) — modo conservador?
//
// Método: bootstrap PAREADO por corrida (B=2000) — mesmas corridas, diff de
// pnl por corrida. pWorseOrEqual ≈ p-value unicaudal de "A é melhor que B".
//
// Uso: nvm use 20 && PORT=3999 npx ts-node src/oneTimeScript/bootstrap_compare_flat.ts
// Env: EVAL_DAYS (180), B (2000)

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { pairedBootstrap } from "../services/ml/eval/bootstrap";
import {
	type HorseRecord,
	loadModelFromPath,
	loadPeriodData,
	predictRace,
	predictRaceLoseHead,
	simulateWithPredictor,
} from "../services/ml/eval/harness";
import { COMMISSION_RATE } from "../services/ml/eval/simulator";

const EVAL_DAYS = Number(process.env.EVAL_DAYS || 180);
const B = Number(process.env.B || 2000);
const PROD_PATH = "horse_probability_model/claude-ml-model-flat";

function show(label: string, r: ReturnType<typeof pairedBootstrap>): void {
	console.log(`\n📊 ${label} (n=${r.nRaces} corridas, B=${B})`);
	console.log(
		`   Δpnl total: ${r.pnlDiff.mean.toFixed(0)} [IC95 ${r.pnlDiff.lo95.toFixed(0)}, ${r.pnlDiff.hi95.toFixed(0)}]`,
	);
	console.log(
		`   Δwin rate: ${r.winRateDiffPp.mean.toFixed(2)}pp [IC95 ${r.winRateDiffPp.lo95.toFixed(2)}, ${r.winRateDiffPp.hi95.toFixed(2)}]`,
	);
	console.log(
		`   P(A ≤ B): ${(r.pWorseOrEqual * 100).toFixed(1)}% ${r.pWorseOrEqual < 0.05 ? "→ A é MELHOR com significância" : r.pWorseOrEqual > 0.95 ? "→ A é PIOR com significância" : "→ INCONCLUSIVO (ruído)"}`,
	);
}

async function main(): Promise<void> {
	console.log("🧪 Bootstrap pareado — Flat (DEV-ONLY)\n");
	console.log(
		`📋 janela=[${EVAL_DAYS}d,0) | comissão=${(COMMISSION_RATE * 100).toFixed(1)}%`,
	);
	await mongoose.connect(process.env.MONGOOSE as string);

	const prod = await loadModelFromPath(PROD_PATH, "flat");
	const raceMap = await loadPeriodData(["Flat"], EVAL_DAYS, 0);
	console.log(`🏁 ${raceMap.size} corridas`);

	// Cache de predições
	const softmaxCache = new Map<number, number[]>();
	const headsAvgCache = new Map<number, number[]>();
	for (const [raceId, horses] of raceMap) {
		const sm = predictRace(horses, prod);
		const lh = predictRaceLoseHead(horses, prod);
		softmaxCache.set(raceId, sm);
		headsAvgCache.set(
			raceId,
			lh ? sm.map((p, i) => (p < 0 || lh[i] < 0 ? -1 : (p + lh[i]) / 2)) : sm,
		);
	}
	const fromCache =
		(cache: Map<number, number[]>) =>
		(horses: HorseRecord[]): number[] =>
			cache.get(horses[0].race_id) ?? new Array(horses.length).fill(-1);

	// A. heads_avg vs softmax
	const rSoftmax = simulateWithPredictor(raceMap, fromCache(softmaxCache));
	const rHeadsAvg = simulateWithPredictor(raceMap, fromCache(headsAvgCache));
	show("A: heads_avg − prod_softmax", pairedBootstrap(rHeadsAvg, rSoftmax, B));

	// B. filtro P(lose)>=0.94 vs sem filtro (mesma base softmax)
	const filtered94 = new Map<number, number[]>();
	for (const [raceId, pl] of softmaxCache) {
		filtered94.set(
			raceId,
			pl.map((p) => (p >= 0.94 ? p : -1)),
		);
	}
	const rFiltered = simulateWithPredictor(raceMap, fromCache(filtered94));
	show(
		"B: P(lose)>=0.94 − sem filtro (softmax)",
		pairedBootstrap(rFiltered, rSoftmax, B),
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
