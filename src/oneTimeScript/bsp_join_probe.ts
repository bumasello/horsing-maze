// PROBE DEV-ONLY: mede a taxa de match do join BSP (CSV Betfair ↔ nossas corridas)
// ANTES de wire no simulador. Normalização de nome/course decide tudo — este
// script mostra a taxa e amostras de miss pra iterar.
//
// Uso: nvm use 20 && PORT=3998 BSP_DIR=/home/mazedev/betfair_sp_data \
//      npx ts-node src/oneTimeScript/bsp_join_probe.ts
// Env: EVAL_DAYS (30), BSP_DIR (default /home/mazedev/betfair_sp_data)

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { supabase } from "..";
import { getDataSchema } from "../shared/db-config";
import {
	loadBspLookup,
	lookupBsp,
	normName,
} from "../services/ml/eval/bsp-lookup";
import { loadPeriodData } from "../services/ml/eval/harness";

const EVAL_DAYS = Number(process.env.EVAL_DAYS || 30);
const BSP_DIR = process.env.BSP_DIR || "/home/mazedev/betfair_sp_data";

async function fetchMap<T extends { id: number }>(
	table: string,
	ids: number[],
	cols: string,
): Promise<Map<number, T>> {
	const out = new Map<number, T>();
	const CHUNK = 500;
	for (let i = 0; i < ids.length; i += CHUNK) {
		const chunk = ids.slice(i, i + CHUNK);
		const { data, error } = await supabase
			.schema(getDataSchema())
			.from(table)
			.select(cols)
			.in("id", chunk);
		if (error) throw error;
		for (const row of (data ?? []) as unknown as T[]) out.set(row.id, row);
	}
	return out;
}

async function main(): Promise<void> {
	console.log("🔎 BSP join probe (DEV-ONLY)\n");
	console.log(`📋 janela=${EVAL_DAYS}d | BSP_DIR=${BSP_DIR}`);
	await mongoose.connect(process.env.MONGOOSE as string);

	console.log("📂 carregando CSVs de BSP...");
	const { lookup, files, rows, ambiguous } = loadBspLookup(BSP_DIR);
	console.log(
		`   ${files} arquivos, ${rows} linhas com bsp>0, ${lookup.size} chaves (data,cavalo), ${ambiguous} ambíguas descartadas`,
	);

	console.log("🏁 carregando nossas corridas (Flat+Jump)...");
	const raceMap = await loadPeriodData(["Flat", "Jump"], EVAL_DAYS, 0);
	const raceIds = Array.from(raceMap.keys());
	const rhIds: number[] = [];
	for (const horses of raceMap.values())
		for (const h of horses) rhIds.push(h.race_horse_id);
	console.log(`   ${raceIds.length} corridas, ${rhIds.length} cavalos`);

	// course/date por corrida; nome por cavalo
	const races = await fetchMap<{ id: number; course: string; date: string }>(
		"racecards_hr_enriched",
		raceIds,
		"id, course, date",
	);
	const horses = await fetchMap<{
		id: number;
		horse: string;
		sp_decimal: number | null;
	}>("race_horses_hr_enriched", rhIds, "id, horse, sp_decimal");

	let matched = 0;
	let total = 0;
	let tolMatches = 0; // matches que precisaram de ±1 dia
	const misses: string[] = [];
	const cmp: Array<{ sp: number; bsp: number }> = [];
	const courseHits = new Map<string, { hit: number; miss: number }>();

	for (const [raceId, group] of raceMap) {
		const race = races.get(raceId);
		if (!race) continue;
		const course = normName(race.course);
		for (const h of group) {
			const rh = horses.get(h.race_horse_id);
			if (!rh?.horse) continue;
			total++;
			const found = lookupBsp(lookup, race.date, normName(rh.horse));
			const b = found?.row;
			const cs = courseHits.get(course) ?? { hit: 0, miss: 0 };
			if (b) {
				matched++;
				if (found.offset !== 0) tolMatches++;
				cs.hit++;
				if (rh.sp_decimal && rh.sp_decimal > 0)
					cmp.push({ sp: Number(rh.sp_decimal), bsp: b.bsp });
			} else {
				cs.miss++;
				if (misses.length < 15)
					misses.push(
						`${race.date} | ${race.course} (${course}) | ${rh.horse} (${normName(rh.horse)})`,
					);
			}
			courseHits.set(course, cs);
		}
	}

	console.log(
		`\n📊 MATCH: ${matched}/${total} = ${((matched / total) * 100).toFixed(1)}%  (${tolMatches} via ±1 dia)`,
	);

	if (cmp.length > 0) {
		const avgSp = cmp.reduce((a, x) => a + x.sp, 0) / cmp.length;
		const avgBsp = cmp.reduce((a, x) => a + x.bsp, 0) / cmp.length;
		const bspHigher = cmp.filter((x) => x.bsp > x.sp).length;
		console.log(`\n💰 sp_decimal vs BSP (${cmp.length} pares):`);
		console.log(
			`   avg sp=${avgSp.toFixed(2)}  avg bsp=${avgBsp.toFixed(2)}  (BSP ${avgBsp > avgSp ? "MAIOR" : "menor"})`,
		);
		console.log(
			`   BSP > SP em ${((bspHigher / cmp.length) * 100).toFixed(1)}% dos casos`,
		);
		// amostra na faixa de aposta [13,20]
		const band = cmp.filter((x) => x.sp >= 13 && x.sp <= 20);
		if (band.length > 0) {
			const bAvgSp = band.reduce((a, x) => a + x.sp, 0) / band.length;
			const bAvgBsp = band.reduce((a, x) => a + x.bsp, 0) / band.length;
			console.log(
				`   FAIXA [13,20] (${band.length}): avg sp=${bAvgSp.toFixed(2)} avg bsp=${bAvgBsp.toFixed(2)}`,
			);
		}
	}

	// piores courses (mais miss) — ajuda a achar aliases de nome de pista
	const worst = Array.from(courseHits.entries())
		.map(([c, v]) => ({ c, ...v, rate: v.hit / (v.hit + v.miss) }))
		.filter((x) => x.hit + x.miss >= 5)
		.sort((a, b) => a.rate - b.rate)
		.slice(0, 10);
	console.log("\n🚧 courses com pior match (≥5 cavalos):");
	for (const w of worst)
		console.log(
			`   ${w.c}: ${w.hit}/${w.hit + w.miss} = ${(w.rate * 100).toFixed(0)}%`,
		);

	console.log("\n❌ amostra de misses:");
	for (const m of misses) console.log(`   ${m}`);

	await mongoose.disconnect();
	console.log("\n✅ Concluído.");
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
