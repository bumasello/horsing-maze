import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";
const db = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL as string,
	process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
	{ db: { schema: process.env.SCH || "hml" } },
);
async function main() {
	const { data: sample } = await db.from("odds_enriched").select("*").limit(5);
	console.log("AMOSTRA odds_enriched:");
	console.log(JSON.stringify(sample, null, 1));
	// distribuicao de bookies
	const bookies = new Map<string, number>();
	let min = "9999",
		max = "0",
		n = 0;
	for (let off = 0; off < 120000; off += 1000) {
		const { data, error } = await db
			.from("odds_enriched")
			.select("bookie,last_update,odd")
			.range(off, off + 999);
		if (error) {
			console.log("erro em", off, error.message);
			break;
		}
		if (!data || !data.length) break;
		for (const r of data as any[]) {
			bookies.set(r.bookie, (bookies.get(r.bookie) || 0) + 1);
			n++;
			const d = (r.last_update || "").slice(0, 10);
			if (d && d < min) min = d;
			if (d && d > max) max = d;
		}
	}
	console.log(`\ntotal lido: ${n} | last_update de ${min} a ${max}`);
	console.log("\nBOOKIES:");
	[...bookies.entries()]
		.sort((a, b) => b[1] - a[1])
		.forEach(([k, v]) => console.log(`  ${String(k).padEnd(24)} ${v}`));
}
main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
