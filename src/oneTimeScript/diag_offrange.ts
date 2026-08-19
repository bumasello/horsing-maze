// DIAGNÓSTICO DEV-ONLY: por que 64% dos picks ficam fora da banda [13,20]?
//
// Separa as duas causas possíveis:
//   (a) BUG do fallback em selectMainPick — o pick já nasce fora da banda
//       porque os branches probPicks/eligiblePicks[0] não filtram odd.
//   (b) DRIFT — o pick nasce na banda (market_odd) e sai dela até a largada
//       (sp_decimal). Drift mediano geração→SP é ~35%, ver analyze_odds_drift.
//
// Uso: nvm use 20 && PORT=3994 npx ts-node src/oneTimeScript/diag_offrange.ts
// Env: SINCE (2026-07-05), SCHEMA_OUT (prd), SCHEMA_DATA (hml)

import dotenv from "dotenv";
dotenv.config();

import { supabase } from "..";
import {
	MAX_ODD_THRESHOLD,
	MIN_ODD_THRESHOLD,
} from "../services/ml/claude-generate-picks";

const SINCE = process.env.SINCE || "2026-07-05";
const SCHEMA_OUT = process.env.SCHEMA_OUT || "prd";
const SCHEMA_DATA = process.env.SCHEMA_DATA || "hml";

interface Pick {
	race_horse_id: number;
	market_odd: number;
	predicted_probability: number;
	pick_type: string;
	race_date: string;
}

async function main(): Promise<void> {
	const { data: picks, error } = await supabase
		.schema(SCHEMA_OUT)
		.from("lay_betting_picks")
		.select(
			"race_horse_id, market_odd, predicted_probability, pick_type, race_date",
		)
		.gte("race_date", SINCE);
	if (error) throw error;
	const rows = (picks ?? []) as unknown as Pick[];

	const sp = new Map<number, number | null>();
	const ids = rows.map((p) => p.race_horse_id);
	for (let i = 0; i < ids.length; i += 500) {
		const { data, error: e2 } = await supabase
			.schema(SCHEMA_DATA)
			.from("race_horses_hr_enriched")
			.select("id, sp_decimal")
			.in("id", ids.slice(i, i + 500));
		if (e2) throw e2;
		for (const r of (data ?? []) as Array<{
			id: number;
			sp_decimal: number | null;
		}>)
			sp.set(r.id, r.sp_decimal ? Number(r.sp_decimal) : null);
	}

	let genOut = 0;
	let driftOut = 0;
	let bothIn = 0;
	let noSp = 0;
	const byType: Record<string, number> = {};
	const buckets: Record<string, number> = {};
	// direção do drift, só pros que nasceram na banda
	let driftUp = 0;
	let driftDown = 0;
	const ratios: number[] = [];

	for (const p of rows) {
		const mo = Number(p.market_odd);
		const s = sp.get(p.race_horse_id);
		if (mo < MIN_ODD_THRESHOLD || mo > MAX_ODD_THRESHOLD) {
			genOut++;
			byType[p.pick_type] = (byType[p.pick_type] ?? 0) + 1;
			const b =
				mo < MIN_ODD_THRESHOLD
					? "<13"
					: mo <= 30
						? "20-30"
						: mo <= 50
							? "30-50"
							: mo <= 100
								? "50-100"
								: ">100";
			buckets[b] = (buckets[b] ?? 0) + 1;
		} else if (s == null) noSp++;
		else {
			ratios.push(s / mo);
			if (s < MIN_ODD_THRESHOLD || s > MAX_ODD_THRESHOLD) {
				driftOut++;
				if (s > MAX_ODD_THRESHOLD) driftUp++;
				else driftDown++;
			} else bothIn++;
		}
	}
	ratios.sort((a, b) => a - b);
	const q = (p: number) => ratios[Math.floor(ratios.length * p)] ?? Number.NaN;

	const pct = (n: number) => `${((n / rows.length) * 100).toFixed(1)}%`;
	console.log(
		`\n📋 ${rows.length} picks desde ${SINCE} (schema ${SCHEMA_OUT}), banda [${MIN_ODD_THRESHOLD},${MAX_ODD_THRESHOLD}]\n`,
	);
	console.log(
		`❌ JÁ nasce fora da banda (bug do fallback): ${genOut} (${pct(genOut)})`,
	);
	console.log(`      por pick_type: ${JSON.stringify(byType)}`);
	console.log(`      odd de geração: ${JSON.stringify(buckets)}`);
	console.log(
		`⚠️  nasce na banda, sai no SP (drift):        ${driftOut} (${pct(driftOut)})`,
	);
	console.log(
		`      drift PRA CIMA (SP > ${MAX_ODD_THRESHOLD}): ${driftUp}  |  PRA BAIXO (SP < ${MIN_ODD_THRESHOLD}): ${driftDown}`,
	);
	console.log(
		`      razão SP/market_odd — p10 ${q(0.1).toFixed(2)} | mediana ${q(0.5).toFixed(2)} | p90 ${q(0.9).toFixed(2)}`,
	);
	console.log(
		`✅ na banda nas duas pontas (apostável):     ${bothIn} (${pct(bothIn)})`,
	);
	console.log(
		`   sem SP ainda:                             ${noSp} (${pct(noSp)})`,
	);
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
