// Benchmark LightGBM — passo 3/3: EVAL ROI no harness (regras de prod +
// comissão). Compara LGBM lambdarank (OOS nos últimos 90d) vs prod v68
// (in-sample na mesma janela — se o LGBM chegar perto, sinal forte).
//
// Lê tools/lgbm_benchmark/data/eval_scores.csv (do train_lgbm.py).
// P(lose) do LGBM = 1 − softmax(scores) na corrida (T=1; scores lambdarank
// não são calibrados — mesma transformação usada no TF.js).
//
// Uso: nvm use 20 && PORT=3999 npx ts-node src/oneTimeScript/eval_lgbm_flat.ts

import dotenv from "dotenv";
dotenv.config();

import * as fs from "node:fs";
import * as path from "node:path";
import mongoose from "mongoose";
import {
	type HorseRecord,
	evaluateModel,
	evaluateWithPredictor,
	loadModelFromPath,
	loadPeriodData,
	scoresToPLose,
} from "../services/ml/eval/harness";
import { printConsoleTable } from "../services/ml/eval/report";
import { COMMISSION_RATE } from "../services/ml/eval/simulator";

const EVAL_DAYS = Number(process.env.EVAL_DAYS || 90);
const PROD_PATH = "horse_probability_model/claude-ml-model-flat";
const SCORES_CSV = path.join(
	__dirname,
	"../../tools/lgbm_benchmark/data/eval_scores.csv",
);

async function main(): Promise<void> {
	console.log("🧪 Eval ROI — LGBM lambdarank vs prod v68 (Flat)\n");
	console.log(
		`📋 EVAL=[${EVAL_DAYS}d,0) | comissão=${(COMMISSION_RATE * 100).toFixed(1)}%\n`,
	);

	const scoreMap = new Map<number, number>();
	const lines = fs.readFileSync(SCORES_CSV, "utf8").trim().split("\n").slice(1);
	for (const l of lines) {
		const [id, s] = l.split(",");
		scoreMap.set(Number(id), Number(s));
	}
	console.log(`  📥 ${scoreMap.size} scores LGBM`);

	await mongoose.connect(process.env.MONGOOSE as string);

	const prod = await loadModelFromPath(PROD_PATH, "flat");
	console.log(`  📥 prod v${prod.config.version}\n`);

	console.log(`📥 Janela EVAL [${EVAL_DAYS}d,0)...`);
	const evalMap = await loadPeriodData(["Flat"], EVAL_DAYS, 0);
	console.log(`  🏁 ${evalMap.size} corridas\n`);

	const lgbmPredictor = (horses: HorseRecord[]): number[] => {
		const scores: (number | null)[] = horses.map((h) => {
			const s = scoreMap.get(h.race_horse_id);
			return s === undefined ? null : s;
		});
		return scoresToPLose(scores, 1);
	};

	console.log("📊 Simulando:");
	console.log("  1/2 lgbm_lambdarank (OOS)...");
	const lgbmSummary = evaluateWithPredictor(
		"lgbm_oos",
		evalMap,
		lgbmPredictor,
	);
	console.log("  2/2 prod v68 (in-sample)...");
	const prodSummary = evaluateModel("prod_v68_is", prod, evalMap);

	printConsoleTable([lgbmSummary, prodSummary]);

	const d = (lgbmSummary.edge - prodSummary.edge) * 100;
	console.log(
		`\n📌 lgbm(OOS) − prod(in-sample): ${d >= 0 ? "+" : ""}${d.toFixed(2)}pp de edge`,
	);
	console.log(
		"   LGBM é OOS na janela; prod v68 treinou nela. Empate ≈ vitória do LGBM.",
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
