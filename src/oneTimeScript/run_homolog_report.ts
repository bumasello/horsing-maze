// Wrapper manual do relatório de homologação (mesmo código do cron 20:00).
// Uso: nvm use 20 && PORT=3999 npx ts-node src/oneTimeScript/run_homolog_report.ts
// Env: REPORT_DAYS (10)

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { generateHomologReport } from "../services/ml/homolog-report";

async function main() {
	await mongoose.connect(process.env.MONGOOSE as string);
	try {
		await generateHomologReport(Number(process.env.REPORT_DAYS || 10));
	} finally {
		await mongoose.disconnect();
	}
}

main().then(() => process.exit(process.exitCode ?? 0));
