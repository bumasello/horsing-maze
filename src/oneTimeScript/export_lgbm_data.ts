// Benchmark LightGBM (Fase 3 do debug plan) — passo 1/3: EXPORT.
// Exporta features Flat pra CSV: treino = tudo ANTES dos últimos 90d,
// eval = últimos 90d (OOS pro LGBM; nota: mt_b05 é in-sample nessa janela,
// então se o LGBM chegar perto já é sinal forte).
//
// Ordem das colunas de feature = config.features do modelo de PROD (paridade).
// Valores CRUS (sem normalização; LGBM lida com NaN nativamente — missing
// vira campo vazio no CSV).
//
// Saída: tools/lgbm_benchmark/data/{train,eval}.csv
// Uso: nvm use 20 && PORT=3999 npx ts-node src/oneTimeScript/export_lgbm_data.ts
// Env: EVAL_DAYS (90), TRAIN_MAX_DAYS (1200)

import dotenv from "dotenv";
dotenv.config();

import * as fs from "node:fs";
import * as path from "node:path";
import mongoose from "mongoose";
import type { ModelConfig } from "../shared/types/ml.types";
import { download, loadPeriodData } from "../services/ml/eval/harness";

const EVAL_DAYS = Number(process.env.EVAL_DAYS || 90);
const TRAIN_MAX_DAYS = Number(process.env.TRAIN_MAX_DAYS || 1200);
const PROD_PATH = "horse_probability_model/claude-ml-model-flat";
const OUT_DIR = path.join(__dirname, "../../tools/lgbm_benchmark/data");

function toCsvRows(
	raceMap: Map<
		number,
		Array<{
			race_id: number;
			race_date: string;
			race_horse_id: number;
			features: Record<string, number | null>;
			finish_position: number;
			non_runner: boolean;
			market_odd: number;
		}>
	>,
	featureNames: string[],
): string[] {
	const rows: string[] = [];
	for (const horses of raceMap.values()) {
		if (horses.length < 3) continue;
		for (const h of horses) {
			const feats = featureNames.map((fn) => {
				const v = h.features?.[fn];
				return v === null || v === undefined ? "" : String(v);
			});
			rows.push(
				[
					h.race_id,
					h.race_date,
					h.race_horse_id,
					h.finish_position,
					h.non_runner ? 1 : 0,
					h.market_odd,
					...feats,
				].join(","),
			);
		}
	}
	return rows;
}

async function main(): Promise<void> {
	console.log("📦 Export LGBM — Flat\n");
	await mongoose.connect(process.env.MONGOOSE as string);

	const cfg = JSON.parse(
		Buffer.from(await download(`${PROD_PATH}/config.json`)).toString("utf8"),
	) as ModelConfig;
	const featureNames = cfg.features;
	console.log(`  📋 ${featureNames.length} features (ordem do prod v${cfg.version})`);

	fs.mkdirSync(OUT_DIR, { recursive: true });
	const header = [
		"race_id",
		"race_date",
		"race_horse_id",
		"finish_position",
		"non_runner",
		"market_odd",
		...featureNames,
	].join(",");

	console.log(`\n📥 EVAL [${EVAL_DAYS}d, 0)...`);
	const evalMap = await loadPeriodData(["Flat"], EVAL_DAYS, 0);
	const evalRows = toCsvRows(evalMap, featureNames);
	fs.writeFileSync(
		path.join(OUT_DIR, "eval.csv"),
		[header, ...evalRows].join("\n"),
	);
	console.log(`  ✅ eval.csv: ${evalRows.length} linhas (${evalMap.size} corridas)`);

	console.log(`\n📥 TREINO [${TRAIN_MAX_DAYS}d, ${EVAL_DAYS}d)...`);
	const trainMap = await loadPeriodData(
		["Flat"],
		TRAIN_MAX_DAYS - EVAL_DAYS,
		EVAL_DAYS,
	);
	const trainRows = toCsvRows(trainMap, featureNames);
	fs.writeFileSync(
		path.join(OUT_DIR, "train.csv"),
		[header, ...trainRows].join("\n"),
	);
	console.log(`  ✅ train.csv: ${trainRows.length} linhas (${trainMap.size} corridas)`);

	await mongoose.disconnect();
	console.log("\n✅ Export concluído.");
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
