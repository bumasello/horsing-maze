// Inventário do Supabase: tabelas, colunas, contagem e janela temporal.
// Autocontido: cria o próprio client, NÃO importa src/index (nada de cron).
// Uso: npx ts-node src/oneTimeScript/inventory_supabase.ts [schema]
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
const SCHEMAS = (process.env.SCHEMAS || "hml,prd").split(",");
const TABLES = [
	"racecards_hr_enriched",
	"race_horses_hr_enriched",
	"odds_enriched",
	"training_enriched_horse_features",
	"prediction_enriched_horse_features",
	"lay_betting_picks",
	"lay_betting_top_picks",
	"lay_betting_race_results",
	"lay_betting_all_eligible",
	"rpscrape_results",
	"model_metrics_history",
	"horse_stats_enriched",
	"racing_api_raw",
	"horse_results_enriched",
];

async function main() {
	for (const schema of SCHEMAS) {
		console.log(`\n${"=".repeat(70)}\nSCHEMA: ${schema}\n${"=".repeat(70)}`);
		const db = createClient(url, key, { db: { schema } });
		for (const t of TABLES) {
			const { count, error: ce } = await db
				.from(t)
				.select("*", { count: "exact", head: true });
			if (ce) {
				console.log(`  ${t.padEnd(38)} ERRO: ${ce.message.slice(0, 60)}`);
				continue;
			}
			const { data } = await db.from(t).select("*").limit(1);
			const cols = data && data[0] ? Object.keys(data[0]) : [];
			console.log(`\n  ▸ ${t}  —  ${count} linhas, ${cols.length} colunas`);
			if (cols.length) console.log(`    ${cols.join(", ")}`);
		}
	}
}
main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
