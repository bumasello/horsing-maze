// Treina o baseline SEM features de mercado pro JUMP (não existia — só havia
// no_market_flat). Necessário pra rodar a sonda de encompassing
// (benter_alpha_probe.ts) no Jump, que é a única frente que ainda pode mudar a
// conclusão de que as features não superam o preço.
//
// BASELINE_MODE=no_market → save ISOLADO em baselines/no_market_jump.
// Prod NÃO é tocado (sem bump de versão).
//
// Uso: nvm use 20 && NO_CRON=1 PORT=3983 BASELINE_MODE=no_market \
//      npx ts-node src/oneTimeScript/run_training_no_market_jump.ts

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { trainLayBettingModel } from "../services/ml/training_final";

async function main(): Promise<void> {
	if ((process.env.BASELINE_MODE || "").trim() !== "no_market") {
		throw new Error(
			"BASELINE_MODE=no_market é obrigatório — sem ele o treino salvaria no PATH DE PROD",
		);
	}
	const start = Date.now();
	console.log("🔌 Conectando ao MongoDB...");
	await mongoose.connect(process.env.MONGOOSE as string);
	console.log("✅ MongoDB conectado\n");

	try {
		await trainLayBettingModel("jump");
		console.log(
			`\n🏁 Treino jump finalizado em ${((Date.now() - start) / 1000).toFixed(0)}s`,
		);
	} finally {
		await mongoose.disconnect();
	}
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
