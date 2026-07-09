// Runner manual da captura intraday de odds (mesmo código do cron opt-in
// ENABLE_INTRADAY_ODDS). Pra teste em dev antes de ativar no servidor.
//
// Uso: nvm use 20 && PORT=3999 npx ts-node src/oneTimeScript/run_intraday_odds.ts
//
// Nota: só encontra corridas se houver racecards de hoje aguardando largada
// (manhã UK). Rodar entre ~06:00 e ~09:30 BRT em dia de corrida.

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { captureIntradayOdds } from "../pipeline/pipeline";

async function main() {
	await mongoose.connect(process.env.MONGOOSE as string);
	try {
		await captureIntradayOdds();
	} finally {
		await mongoose.disconnect();
	}
}

main().then(() => process.exit(process.exitCode ?? 0));
