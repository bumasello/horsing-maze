// Experimento DEV-ONLY: usar a cabeça sigmoid `lose_output` do mt_b05 (v68)
// como fonte de P(perder) nos picks, em vez de 1 − softmax(score).
//
// Motivação: a cabeça lose foi treinada EXATAMENTE pra tarefa LAY (BCE contra
// target invertido, β=0.5), mas a predição de prod a descarta na inferência
// (claude-prediction-model usa só o scoreOutput). Se ela discriminar melhor a
// cauda direita, é ganho de graça no modelo já em prod.
//
// Compara no harness do gate (90d, regras de prod, comissão):
//   1. prod_softmax  — 1 − softmax(score) (comportamento atual de prod)
//   2. lose_head     — sigmoid direto da cabeça lose
//   3. heads_avg     — média simples das duas (ensemble barato)
//
// Uso: nvm use 20 && PORT=3999 npx ts-node src/oneTimeScript/eval_lose_head_flat.ts

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import {
	type HorseRecord,
	evaluateModel,
	evaluateWithPredictor,
	loadModelFromPath,
	loadPeriodData,
	predictRace,
	predictRaceLoseHead,
} from "../services/ml/eval/harness";
import { printConsoleTable } from "../services/ml/eval/report";
import { COMMISSION_RATE } from "../services/ml/eval/simulator";

const EVAL_DAYS = Number(process.env.EVAL_DAYS || 90);
const PROD_PATH = "horse_probability_model/claude-ml-model-flat";

async function main(): Promise<void> {
	console.log(
		"🧪 Eval cabeça lose_output vs softmax — Flat (DEV-ONLY, não toca prod)\n",
	);
	console.log(
		`📋 EVAL=[${EVAL_DAYS}d,0) | modelo=${PROD_PATH} | comissão=${(COMMISSION_RATE * 100).toFixed(1)}%\n`,
	);

	console.log("🔌 Conectando MongoDB...");
	await mongoose.connect(process.env.MONGOOSE as string);

	console.log("📥 Carregando modelo de prod (v68/mt_b05)...");
	const prod = await loadModelFromPath(PROD_PATH, "flat");
	console.log(
		`  ✅ v${prod.config.version}, ${prod.config.features.length} feat, T=${prod.temperature}`,
	);

	// Sanity: modelo precisa ser multi-task
	console.log("\n🔎 Sanity check da cabeça lose...");
	const probe = await loadPeriodData(["Flat"], 3, 0);
	const probeRace = Array.from(probe.values()).find((h) => h.length >= 5);
	if (!probeRace) throw new Error("Sem corrida de probe nos últimos 3 dias");
	const probeLose = predictRaceLoseHead(probeRace, prod);
	if (!probeLose) {
		throw new Error(
			"Modelo de prod NÃO tem cabeça lose_output (single-head?) — abortando",
		);
	}
	const probeSoftmax = predictRace(probeRace, prod);
	console.log(
		`  cavalo0: softmax P(lose)=${probeSoftmax[0]?.toFixed(4)} | lose_head=${probeLose[0]?.toFixed(4)}`,
	);

	console.log(`\n📥 Janela EVAL [hoje-${EVAL_DAYS}d, hoje)...`);
	const evalMap = await loadPeriodData(["Flat"], EVAL_DAYS, 0);
	console.log(`  🏁 ${evalMap.size} corridas`);

	console.log("\n📊 Simulando (regras de prod + comissão):");

	console.log("  1/3 prod_softmax...");
	const softmaxSummary = evaluateModel("prod_softmax", prod, evalMap);

	console.log("  2/3 lose_head...");
	const loseHeadSummary = evaluateWithPredictor(
		"lose_head",
		evalMap,
		(horses: HorseRecord[]) =>
			predictRaceLoseHead(horses, prod) ?? new Array(horses.length).fill(-1),
	);

	console.log("  3/3 heads_avg (média das duas)...");
	const avgSummary = evaluateWithPredictor(
		"heads_avg",
		evalMap,
		(horses: HorseRecord[]) => {
			const sm = predictRace(horses, prod);
			const lh = predictRaceLoseHead(horses, prod);
			if (!lh) return sm;
			return sm.map((p, i) => (p < 0 || lh[i] < 0 ? -1 : (p + lh[i]) / 2));
		},
	);

	printConsoleTable([softmaxSummary, loseHeadSummary, avgSummary]);

	const dEdge = (loseHeadSummary.edge - softmaxSummary.edge) * 100;
	const dEdgeAvg = (avgSummary.edge - softmaxSummary.edge) * 100;
	console.log("\n📌 Leitura:");
	console.log(
		`   lose_head − softmax: ${dEdge >= 0 ? "+" : ""}${dEdge.toFixed(2)}pp de edge`,
	);
	console.log(
		`   heads_avg − softmax: ${dEdgeAvg >= 0 ? "+" : ""}${dEdgeAvg.toFixed(2)}pp de edge`,
	);
	console.log(
		"   ⚠️ Janela ~in-sample pro mt_b05 nas DUAS variantes — comparação interna justa.",
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
