// Wrapper manual do staging gate (mesma lógica do cron com ENABLE_CRON_RETRAIN=1).
//
// Uso normal (treina candidato + avalia + promove/rejeita):
//   nvm use 20 && PORT=3999 npx ts-node src/oneTimeScript/run_staging_gate.ts
//
// Smoke test / dry-run SEM treinar e SEM escrever nada (avalia candidato
// existente vs prod e loga a decisão que SERIA tomada):
//   GATE_DRY_RUN=1 GATE_SKIP_TRAINING=1 GATE_CANDIDATE_LABEL=multitask \
//     PORT=3999 npx ts-node src/oneTimeScript/run_staging_gate.ts
//
// Env vars do gate: GATE_PERIOD_DAYS (90), GATE_EDGE_TOLERANCE_PP (0.2),
// GATE_MIN_BETS (30), GATE_DRY_RUN, GATE_SKIP_TRAINING, GATE_CANDIDATE_LABEL.

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { trainAllModelsWithGate } from "../services/ml/staging-gate";

async function main() {
	const start = Date.now();
	console.log("🔌 Conectando ao MongoDB...");
	await mongoose.connect(process.env.MONGOOSE as string);
	console.log("✅ MongoDB conectado\n");

	try {
		await trainAllModelsWithGate();
		const total = ((Date.now() - start) / 1000).toFixed(0);
		console.log(`\n🏁 Staging gate finalizado em ${total}s`);
	} catch (err) {
		console.error("\n❌ Erro no staging gate:", err);
		process.exitCode = 1;
	} finally {
		await mongoose.disconnect();
		console.log("🔌 MongoDB desconectado");
	}
}

main().then(() => process.exit(process.exitCode ?? 0));
