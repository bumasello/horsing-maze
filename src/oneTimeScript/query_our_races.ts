// DIAG DEV-ONLY: datas reais das nossas corridas p/ courses que deram 0% no join BSP.
// Uso: nvm use 20 && PORT=3997 npx ts-node src/oneTimeScript/query_our_races.ts
import dotenv from "dotenv";
dotenv.config();
import { supabase } from "..";
import { getDataSchema } from "../shared/db-config";

async function main(): Promise<void> {
	const schema = getDataSchema();
	console.log(`schema de dados: ${schema}\n`);
	for (const course of ["Ascot", "Fairyhouse", "Chester"]) {
		const { data, error } = await supabase
			.schema(schema)
			.from("racecards_hr_enriched")
			.select("id, course, date, off_time_uk, off_time_br")
			.ilike("course", `%${course}%`)
			.gte("date", "2026-05-25")
			.lte("date", "2026-07-12")
			.order("date");
		if (error) {
			console.log(`${course}: ERRO ${error.message}`);
			continue;
		}
		const byDate = new Map<string, number>();
		for (const r of data ?? [])
			byDate.set(r.date, (byDate.get(r.date) ?? 0) + 1);
		console.log(`=== ${course}: ${data?.length ?? 0} racecards ===`);
		for (const [d, n] of Array.from(byDate).sort())
			console.log(`   ${d}  (${n} corridas)`);
		// amostra de horse names de uma corrida
		if (data && data.length > 0) {
			const sample = data[Math.floor(data.length / 2)];
			const { data: hs } = await supabase
				.schema(schema)
				.from("race_horses_hr_enriched")
				.select("horse")
				.eq("racecard_id", sample.id)
				.limit(4);
			console.log(
				`   amostra corrida ${sample.id} (${sample.date} ${sample.off_time_uk}/${sample.off_time_br}): ${(hs ?? []).map((h) => h.horse).join(", ")}`,
			);
		}
		console.log();
	}
	process.exit(0);
}
main().catch((e) => {
	console.error(e);
	process.exit(1);
});
