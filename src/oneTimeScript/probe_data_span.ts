// DIAG DEV-ONLY: span dos dados de treino e onde cai o split temporal 80/20.
// Responde: qual janela é out-of-sample pro modelo de prod (val 20% = mais recente).
// Uso: nvm use 20 && NO_CRON=1 PORT=3994 npx ts-node src/oneTimeScript/probe_data_span.ts

import dotenv from "dotenv";
dotenv.config();
import { supabase } from "..";
import { getOutputSchema } from "../shared/db-config";

const GROUPS: Array<{ name: string; types: string[] }> = [
	{ name: "Flat", types: ["Flat"] },
	{ name: "Jump", types: ["Hurdle", "Chase", "NHF"] },
];

function daysAgo(dateStr: string): number {
	const ms = Date.now() - new Date(`${dateStr}T00:00:00Z`).getTime();
	return Math.round(ms / 86400000);
}

async function main(): Promise<void> {
	const schema = getOutputSchema();
	console.log(`schema de saída: ${schema}\n`);

	for (const g of GROUPS) {
		const base = () =>
			supabase
				.schema(schema)
				.from("training_enriched_horse_features")
				.select("race_date, race_id", { count: "exact" })
				.in("race_type", g.types)
				.eq("model_version", "v5.0")
				.gte("quality_score", 0.7);

		const { data: first, error: e1 } = await base()
			.order("race_date", { ascending: true })
			.limit(1);
		if (e1) throw e1;
		const { data: last, error: e2 } = await base()
			.order("race_date", { ascending: false })
			.limit(1);
		if (e2) throw e2;
		const { count, error: e3 } = await base().limit(1);
		if (e3) throw e3;

		if (!first?.length || !last?.length) {
			console.log(`=== ${g.name}: sem dados`);
			continue;
		}
		const minD = first[0].race_date as string;
		const maxD = last[0].race_date as string;
		console.log(`=== ${g.name} ===`);
		console.log(`   linhas (cavalos): ${count}`);
		console.log(
			`   span: ${minD} (${daysAgo(minD)}d atrás) → ${maxD} (${daysAgo(maxD)}d atrás)`,
		);

		// O split é por CORRIDA (validRaces.sort por data, 80/20). Conta corridas
		// distintas por data pra achar a data que separa os 80% mais antigos.
		const dates: string[] = [];
		const seenRace = new Set<number>();
		const pageSize = 1000;
		for (let page = 0; ; page++) {
			const { data, error } = await supabase
				.schema(schema)
				.from("training_enriched_horse_features")
				.select("race_date, race_id")
				.in("race_type", g.types)
				.eq("model_version", "v5.0")
				.gte("quality_score", 0.7)
				.order("race_date", { ascending: true })
				.range(page * pageSize, page * pageSize + pageSize - 1);
			if (error) throw error;
			if (!data?.length) break;
			for (const r of data) {
				if (seenRace.has(r.race_id)) continue;
				seenRace.add(r.race_id);
				dates.push(r.race_date as string);
			}
			if (data.length < pageSize) break;
		}
		dates.sort();
		const splitIdx = Math.floor(dates.length * 0.8);
		const splitDate = dates[splitIdx];
		console.log(`   corridas distintas: ${dates.length}`);
		console.log(
			`   split 80/20 cai em: ${splitDate} (${daysAgo(splitDate)}d atrás)`,
		);
		console.log(`   → val (out-of-sample) = janela [${daysAgo(splitDate)}, 0)`);
	}
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
