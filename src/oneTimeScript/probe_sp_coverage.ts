import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";
const db = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL as string,
	process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
	{ db: { schema: "hml" } },
);
async function main() {
	const { data: first } = await db
		.from("racecards_hr_enriched")
		.select("id,date")
		.order("date", { ascending: true })
		.limit(1);
	const { data: last } = await db
		.from("racecards_hr_enriched")
		.select("id,date")
		.order("date", { ascending: false })
		.limit(1);
	console.log("racecards: de", first?.[0]?.date, "a", last?.[0]?.date);
	// amostra por ano: cobertura de sp_decimal
	for (const y of ["2024", "2025", "2026"]) {
		const { data: rc } = await db
			.from("racecards_hr_enriched")
			.select("id")
			.gte("date", `${y}-05-01`)
			.lt("date", `${y}-05-08`)
			.limit(200);
		const ids = (rc || []).map((r: any) => r.id);
		if (!ids.length) {
			console.log(`${y}: sem corridas na amostra`);
			continue;
		}
		const { data: rh } = await db
			.from("race_horses_hr_enriched")
			.select("sp_decimal,position,non_runner,horse")
			.in("racecard_id", ids)
			.limit(5000);
		const n = (rh || []).length;
		const withSp = (rh || []).filter(
			(r: any) => r.sp_decimal != null && r.sp_decimal > 1,
		).length;
		const withPos = (rh || []).filter(
			(r: any) => r.position != null && r.position !== "",
		).length;
		console.log(
			`${y} (1ª semana de maio): ${ids.length} corridas, ${n} runners | sp_decimal ${((100 * withSp) / n).toFixed(1)}% | position ${((100 * withPos) / n).toFixed(1)}%`,
		);
	}
	const { data: ex } = await db
		.from("race_horses_hr_enriched")
		.select("horse,sp,sp_decimal,position,non_runner")
		.limit(5);
	console.log("\namostra:", JSON.stringify(ex));
	const { data: rcx } = await db
		.from("racecards_hr_enriched")
		.select("course,date,title,race_type,off_time_uk,class")
		.limit(4);
	console.log("racecards amostra:", JSON.stringify(rcx, null, 1));
}
main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
