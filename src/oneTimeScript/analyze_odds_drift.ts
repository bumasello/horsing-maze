// Análise DEV-ONLY: drift de odds entre a GERAÇÃO dos picks (~00:40 local =
// ~03:40 UTC do dia da corrida) e a LARGADA (sp_decimal).
//
// Motivação: picks nascem de madrugada com mercado ilíquido — daí odds
// absurdas como 81 e 26 em picks recentes. Quantifica:
//   1. Distribuição do drift (odd_geração vs SP) na faixa relevante
//   2. % de cavalos "apostáveis na geração" ([13,20]) que saem do range no SP
//      (na prática: cascata pularia OU apostaríamos odd pior)
//   3. % de "fora do range na geração" que ENTRAM no range no SP
//      (oportunidades que o filtro atual descarta cedo demais)
//
// odd_geração = última odd de odds_enriched com last_update ≤ race_date 04:00 UTC
// (aproxima o momento em que o pipeline gerou os picks).
//
// Uso: nvm use 20 && PORT=3999 npx ts-node src/oneTimeScript/analyze_odds_drift.ts
// Env: DRIFT_DAYS (90)

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { supabase } from "..";
import { withRetry } from "../shared/retry";

const DRIFT_DAYS = Number(process.env.DRIFT_DAYS || 90);
const MIN_ODD = 13;
const MAX_ODD = 20;

interface Row {
	race_horse_id: number;
	race_date: string;
	sp: number;
	oddGen: number | null;
}

async function q<T>(
	label: string,
	fn: () => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
	return withRetry(
		async () => {
			const { data, error } = await fn();
			if (error) throw error;
			return (data ?? []) as T[];
		},
		{},
		label,
	);
}

function pct(n: number, d: number): string {
	return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—";
}

function quantile(sorted: number[], p: number): number {
	if (sorted.length === 0) return Number.NaN;
	const i = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
	return sorted[i];
}

async function main(): Promise<void> {
	console.log("🧪 Drift de odds: geração (madrugada) → largada (SP)\n");
	console.log(
		`📋 janela=${DRIFT_DAYS}d Flat | range apostável=[${MIN_ODD},${MAX_ODD}]\n`,
	);
	await mongoose.connect(process.env.MONGOOSE as string);

	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - DRIFT_DAYS);
	const cutoffStr = cutoff.toISOString().split("T")[0];

	// 1. Cavalos Flat com SP no período (via features pra filtrar race_type)
	const pageSize = 1000;
	let page = 0;
	const base: Array<{ race_horse_id: number; race_date: string }> = [];
	while (true) {
		const data = await q<{ race_horse_id: number; race_date: string }>(
			`features p${page}`,
			() =>
				supabase
					.schema("hml")
					.from("training_enriched_horse_features")
					.select("race_horse_id, race_date")
					.eq("race_type", "Flat")
					.eq("model_version", "v5.0")
					.gte("race_date", cutoffStr)
					.range(page * pageSize, page * pageSize + pageSize - 1),
		);
		if (data.length === 0) break;
		base.push(...data);
		if (data.length < pageSize) break;
		page++;
	}
	console.log(`  🐴 ${base.length} horse-records`);

	const dateById = new Map(base.map((b) => [b.race_horse_id, b.race_date]));
	const ids = Array.from(dateById.keys());

	// 2. SP
	const spById = new Map<number, number>();
	const CHUNK = 500;
	for (let i = 0; i < ids.length; i += CHUNK) {
		const data = await q<{ id: number; sp_decimal: number | null }>(
			`rh chunk ${i}`,
			() =>
				supabase
					.schema("hml")
					.from("race_horses_hr_enriched")
					.select("id, sp_decimal")
					.in("id", ids.slice(i, i + CHUNK)),
		);
		for (const r of data) {
			if (r.sp_decimal && Number(r.sp_decimal) > 1)
				spById.set(r.id, Number(r.sp_decimal));
		}
	}
	console.log(`  💰 ${spById.size} com sp_decimal`);

	// 3. Odd na geração: última odd com last_update ≤ race_date 04:00 UTC
	const rows: Row[] = [];
	const genById = new Map<number, { odd: number; ts: string }>();
	for (let i = 0; i < ids.length; i += CHUNK) {
		const data = await q<{
			race_horse_id: number;
			odd: number;
			last_update: string;
		}>(`odds chunk ${i}`, () =>
			supabase
				.schema("hml")
				.from("odds_enriched")
				.select("race_horse_id, odd, last_update")
				.in("race_horse_id", ids.slice(i, i + CHUNK)),
		);
		for (const r of data) {
			const raceDate = dateById.get(r.race_horse_id);
			if (!raceDate) continue;
			const genCutoff = `${raceDate}T04:00:00`;
			const ts = String(r.last_update);
			if (ts > genCutoff) continue; // depois da geração — ignora
			const cur = genById.get(r.race_horse_id);
			if (!cur || ts > cur.ts) {
				genById.set(r.race_horse_id, { odd: Number(r.odd), ts });
			}
		}
	}

	for (const [id, sp] of spById) {
		const gen = genById.get(id);
		rows.push({
			race_horse_id: id,
			race_date: dateById.get(id) ?? "",
			sp,
			oddGen: gen && gen.odd > 1 ? gen.odd : null,
		});
	}
	const withGen = rows.filter((r) => r.oddGen !== null) as Array<
		Row & { oddGen: number }
	>;
	console.log(
		`  📊 ${withGen.length}/${rows.length} com odd pré-04:00 UTC (${pct(withGen.length, rows.length)} cobertura)\n`,
	);

	// ---- Métricas ----
	// Foco na vizinhança do range (odd_gen 8..30, onde decisões acontecem)
	const zone = withGen.filter((r) => r.oddGen >= 8 && r.oddGen <= 30);
	const drifts = zone
		.map((r) => (r.sp - r.oddGen) / r.oddGen)
		.sort((a, b) => a - b);
	console.log(`Zona de decisão (odd_gen 8-30): ${zone.length} cavalos`);
	console.log(
		`  drift relativo SP vs geração: mediana ${(quantile(drifts, 0.5) * 100).toFixed(1)}% | p10 ${(quantile(drifts, 0.1) * 100).toFixed(1)}% | p90 ${(quantile(drifts, 0.9) * 100).toFixed(1)}%`,
	);
	const absDrift = zone
		.map((r) => Math.abs(r.sp - r.oddGen) / r.oddGen)
		.sort((a, b) => a - b);
	console.log(
		`  |drift|: mediana ${(quantile(absDrift, 0.5) * 100).toFixed(1)}% | p90 ${(quantile(absDrift, 0.9) * 100).toFixed(1)}%\n`,
	);

	// Estabilidade do range apostável
	const genIn = withGen.filter(
		(r) => r.oddGen >= MIN_ODD && r.oddGen <= MAX_ODD,
	);
	const stayIn = genIn.filter((r) => r.sp >= MIN_ODD && r.sp <= MAX_ODD);
	const wentAbove = genIn.filter((r) => r.sp > MAX_ODD);
	const wentBelow = genIn.filter((r) => r.sp < MIN_ODD);
	console.log(
		`Apostáveis na GERAÇÃO ([${MIN_ODD},${MAX_ODD}]): ${genIn.length}`,
	);
	console.log(
		`  continuam no range no SP:  ${stayIn.length} (${pct(stayIn.length, genIn.length)})`,
	);
	console.log(
		`  saem por CIMA (SP>${MAX_ODD}):    ${wentAbove.length} (${pct(wentAbove.length, genIn.length)}) → cascata pularia na hora`,
	);
	console.log(
		`  saem por BAIXO (SP<${MIN_ODD}):   ${wentBelow.length} (${pct(wentBelow.length, genIn.length)})\n`,
	);

	const genOutHigh = withGen.filter(
		(r) => r.oddGen > MAX_ODD && r.oddGen <= 60,
	);
	const cameIn = genOutHigh.filter((r) => r.sp >= MIN_ODD && r.sp <= MAX_ODD);
	console.log(
		`Fora do range na geração (odd_gen ${MAX_ODD}-60): ${genOutHigh.length}`,
	);
	console.log(
		`  ENTRAM no range no SP: ${cameIn.length} (${pct(cameIn.length, genOutHigh.length)}) → oportunidades descartadas cedo demais\n`,
	);

	// O caso dos picks tipo "odd 81": extremos na geração
	const extreme = withGen.filter((r) => r.oddGen > 40);
	const extremeIn = extreme.filter((r) => r.sp >= MIN_ODD && r.sp <= MAX_ODD);
	console.log(
		`Extremos na geração (odd_gen>40): ${extreme.length} | viram apostáveis no SP: ${extremeIn.length} (${pct(extremeIn.length, extreme.length)})`,
	);

	await mongoose.disconnect();
	console.log("\n✅ Concluído.");
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
