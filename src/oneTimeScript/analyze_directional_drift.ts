// Drift direcional por divergência ML×mercado (DEV-ONLY, não escreve nada).
// Ticket 9.
//
// TEORIA: se o modelo diz que um cavalo é muito pior do que a odd inicial
// sugere, a odd deve ALONGAR até a largada, e dá pra lucrar com o movimento
// sem depender do desfecho da corrida.
//
// ⚠️ O CRITÉRIO ">55% de acerto direcional" NÃO SERVE, e é o ponto central
// deste script. drift_predictability.ts já mediu que a ODD DA MANHÃ SOZINHA,
// sem modelo nenhum, acerta a direção do drift em 57,55% — porque o drift é
// monótono no nível de odd (favorito encurta, azarão alonga: viés
// favorito-azarão). Um sinal que acerta 55% é PIOR que não ter sinal.
//
// A pergunta certa: a divergência prediz o drift QUE SOBRA depois de remover
// o efeito do nível de odd? Por isso o teste é sobre o RESÍDUO:
//   1. Numa janela FIT, estima o drift médio por decil de odd da manhã.
//   2. Numa janela HELD disjunta, resíduo = drift_real − drift_esperado(decil).
//   3. Testa se a divergência prediz o RESÍDUO.
//
// Drift usado: NORMALIZADO, d = ln(q_bsp / q_manhã) com q = (1/odd)
// renormalizado na corrida. É soma zero dentro da corrida — puro valor
// relativo, que é o que se negocia. O bruto inclui mudança de overround e
// não é negociável.
//
// Uso: NO_CRON=1 PORT=3990 GROUP=Flat BSP_DIR=... npx ts-node src/oneTimeScript/analyze_directional_drift.ts
// Env: GROUP, DAYS (250), END (38 — CSVs de BSP acabam em 2026-07-12), SPLIT_FRAC (0.5)

import mongoose from "mongoose";
import { supabase } from "..";
import {
	loadBspLookup,
	lookupBsp,
	normName,
} from "../services/ml/eval/bsp-lookup";
import {
	type HorseRecord,
	loadModelFromPath,
	loadPeriodData,
	predictRace,
} from "../services/ml/eval/harness";
import { getDataSchema, modelPath } from "../shared/db-config";

const GROUP = (process.env.GROUP || "Flat").trim();
const CFG: Record<string, { mtype: "flat" | "jump"; types: string[] }> = {
	Flat: { mtype: "flat", types: ["Flat"] },
	Jump: { mtype: "jump", types: ["Hurdle", "Chase", "NHF"] },
};
const G = CFG[GROUP];
if (!G) throw new Error(`GROUP inválido: ${GROUP}`);
const DAYS = Number(process.env.DAYS || 250);
const END = Number(process.env.END || 38);
const BSP_DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const NBINS = 10;
// ⚠️ TESTE DECISIVO: o modelo de prod usa sp_decimal/sp_implied_prob/sp_rank
// como FEATURES — ou seja, ele viu o preço de FECHAMENTO. Prever o movimento
// manhã→fechamento com um modelo que viu o fechamento é circular. Rodar com
// MODEL_PATH=horse_probability_model/baselines/no_market_flat (67 features,
// sem mercado) separa sinal real de vazamento.
const MODEL_PATH =
	process.env.MODEL_PATH ||
	`horse_probability_model/claude-ml-model-${G.mtype}`;

interface Row {
	date: string;
	oddMorning: number;
	drift: number; // normalizado: ln(q_bsp / q_manhã)
	divergence: number; // P_ML(win) − P_mercado(win), ambos de-overrounded
}

async function fetchMap<T extends { id: number }>(
	table: string,
	ids: number[],
	cols: string,
): Promise<Map<number, T>> {
	const out = new Map<number, T>();
	for (let i = 0; i < ids.length; i += 500) {
		const { data, error } = await supabase
			.schema(getDataSchema())
			.from(table)
			.select(cols)
			.in("id", ids.slice(i, i + 500));
		if (error) throw error;
		for (const r of (data ?? []) as unknown as T[]) out.set(r.id, r);
	}
	return out;
}

function mean(xs: number[]): number {
	return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

(async () => {
	console.log("\n🌊 Drift direcional por divergência ML×mercado (DEV-ONLY)\n");
	console.log(`📋 grupo: ${GROUP} | janela: [${DAYS + END}, ${END}) dias`);
	console.log(
		"📋 alvo: drift NORMALIZADO (soma zero na corrida). Teste sobre o RESÍDUO",
	);
	console.log("   após remover o efeito do nível de odd.\n");

	const { lookup } = loadBspLookup(BSP_DIR);
	await mongoose.connect(process.env.MONGOOSE as string);
	console.log(`📋 modelo: ${MODEL_PATH}\n`);
	const model = await loadModelFromPath(modelPath(MODEL_PATH), G.mtype);
	const raceMap = await loadPeriodData(G.types, DAYS, END);

	// nomes e datas vêm do Supabase — HorseRecord não carrega horse_name
	const raceIds = Array.from(raceMap.keys());
	const rhIds: number[] = [];
	for (const hs of raceMap.values())
		for (const h of hs) rhIds.push(h.race_horse_id);
	const racesTbl = await fetchMap<{ id: number; date: string }>(
		"racecards_hr_enriched",
		raceIds,
		"id, date",
	);
	const horsesTbl = await fetchMap<{ id: number; horse: string }>(
		"race_horses_hr_enriched",
		rhIds,
		"id, horse",
	);

	const rows: Row[] = [];
	let matched = 0;
	let total = 0;

	for (const [, horses] of raceMap) {
		if (horses.length < 4) continue;
		const pLose = predictRace(horses, model);
		const date =
			racesTbl.get((horses[0] as HorseRecord).race_id)?.date ??
			(horses[0] as HorseRecord).race_date;

		// coleta morning/bsp por cavalo
		const rec: Array<{ i: number; morning: number; bsp: number }> = [];
		for (let i = 0; i < horses.length; i++) {
			const h = horses[i] as HorseRecord;
			total++;
			if (pLose[i] < 0) continue;
			const name = horsesTbl.get(h.race_horse_id)?.horse;
			if (!name) continue;
			const found = lookupBsp(lookup, date, normName(name));
			const b = found?.row;
			if (!b || !(b.bsp > 1) || !(b.morningwap > 1)) continue;
			matched++;
			rec.push({ i, morning: b.morningwap, bsp: b.bsp });
		}
		if (rec.length < 4) continue;

		// de-overround na corrida, manhã e bsp
		const sumM = rec.reduce((a, r) => a + 1 / r.morning, 0);
		const sumB = rec.reduce((a, r) => a + 1 / r.bsp, 0);
		if (sumM <= 0 || sumB <= 0) continue;

		// prob de mercado (manhã) e do modelo, ambas normalizadas no subconjunto
		const sumMl = rec.reduce((a, r) => a + (1 - pLose[r.i]), 0);
		if (sumMl <= 0) continue;

		for (const r of rec) {
			const qM = 1 / r.morning / sumM;
			const qB = 1 / r.bsp / sumB;
			const pMl = (1 - pLose[r.i]) / sumMl;
			rows.push({
				date,
				oddMorning: r.morning,
				drift: Math.log(qB / qM),
				divergence: pMl - qM,
			});
		}
	}

	console.log(
		`🐎 cavalos com BSP casado: ${matched}/${total} (${((matched / Math.max(total, 1)) * 100).toFixed(1)}%)`,
	);
	if (rows.length < 2000) {
		console.log(`❌ amostra insuficiente (${rows.length}).`);
		process.exit(1);
	}

	// split temporal FIT / HELD
	const dates = [...new Set(rows.map((r) => r.date))].sort();
	const splitDate = dates[Math.floor(dates.length / 2)];
	const fit = rows.filter((r) => r.date < splitDate);
	const held = rows.filter((r) => r.date >= splitDate);
	console.log(
		`📅 FIT (< ${splitDate}): ${fit.length} cavalos | HELD: ${held.length}\n`,
	);

	// baseline: drift médio por decil de odd da manhã, estimado no FIT
	const sortedOdds = [...fit].sort((a, b) => a.oddMorning - b.oddMorning);
	const cuts: number[] = [];
	for (let k = 1; k < NBINS; k++) {
		cuts.push(
			sortedOdds[Math.floor((k / NBINS) * sortedOdds.length)].oddMorning,
		);
	}
	const decileOf = (odd: number) => {
		let d = 0;
		while (d < cuts.length && odd >= cuts[d]) d++;
		return d;
	};
	const baseline: number[] = [];
	for (let d = 0; d < NBINS; d++) {
		baseline.push(
			mean(fit.filter((r) => decileOf(r.oddMorning) === d).map((r) => r.drift)),
		);
	}

	// ===== resultado bruto (sem remover nível de odd) =====
	const dirRaw =
		held.filter((r) => Math.sign(r.divergence) === Math.sign(r.drift)).length /
		held.length;
	console.log(
		"════════════════════════════════════════════════════════════════════════",
	);
	console.log("  A) BRUTO — divergência prediz a direção do drift?");
	console.log(
		"════════════════════════════════════════════════════════════════════════",
	);
	console.log(
		`  acerto direcional: ${(dirRaw * 100).toFixed(2)}%   (baseline só-odd = 57,55%)`,
	);
	console.log(
		"  ⚠️  comparar com 50% é o erro do critério: a odd sozinha já dá 57,55%.",
	);

	// ===== resultado no resíduo =====
	console.log(
		"\n════════════════════════════════════════════════════════════════════════",
	);
	console.log("  B) RESÍDUO — sobra sinal depois de remover o nível de odd?");
	console.log(
		"════════════════════════════════════════════════════════════════════════",
	);
	const resid = held.map((r) => ({
		div: r.divergence,
		res: r.drift - baseline[decileOf(r.oddMorning)],
	}));
	const dirRes =
		resid.filter((r) => Math.sign(r.div) === Math.sign(r.res)).length /
		resid.length;
	console.log(`  acerto direcional no resíduo: ${(dirRes * 100).toFixed(2)}%`);
	console.log(
		"  (moeda justa = 50%; o efeito do nível de odd já foi removido)\n",
	);

	// quintis de divergência
	const byDiv = [...resid].sort((a, b) => a.div - b.div);
	const q = Math.floor(byDiv.length / 5);
	console.log("  quintil de divergência     div. média   resíduo médio   n");
	for (let k = 0; k < 5; k++) {
		const slice = byDiv.slice(k * q, k === 4 ? byDiv.length : (k + 1) * q);
		console.log(
			`  ${k + 1} ${k === 0 ? "(ML acha PIOR)    " : k === 4 ? "(ML acha MELHOR)  " : "                  "}    ${mean(slice.map((s) => s.div)).toFixed(4)}      ${mean(slice.map((s) => s.res)).toFixed(4)}   ${slice.length}`,
		);
	}
	console.log(
		"\n  drift POSITIVO = q subiu = odd ENCURTOU. Teoria prevê: quintil 5",
	);
	console.log(
		"  (ML acha melhor) → resíduo POSITIVO; quintil 1 (ML acha pior) → NEGATIVO.",
	);

	// spread entre extremos + bootstrap
	const q1 = byDiv.slice(0, q).map((s) => s.res);
	const q5 = byDiv.slice(4 * q).map((s) => s.res);
	const spread = mean(q5) - mean(q1);
	const B = 2000;
	const boots: number[] = [];
	for (let b = 0; b < B; b++) {
		const s1: number[] = [];
		const s5: number[] = [];
		for (let k = 0; k < q1.length; k++)
			s1.push(q1[Math.floor(Math.random() * q1.length)]);
		for (let k = 0; k < q5.length; k++)
			s5.push(q5[Math.floor(Math.random() * q5.length)]);
		boots.push(mean(s5) - mean(s1));
	}
	boots.sort((a, b) => a - b);
	const lo = boots[Math.floor(0.025 * B)];
	const hi = boots[Math.floor(0.975 * B)];
	console.log(
		`\n  spread Q5−Q1 do resíduo (teoria prevê > 0): ${spread.toFixed(4)}  IC95 [${lo.toFixed(4)}, ${hi.toFixed(4)}]`,
	);
	if (lo > 0) {
		console.log(
			"  ✅ divergência prediz drift ALÉM do nível de odd (direção da teoria).",
		);
	} else if (hi < 0) {
		console.log("  ❌ sinal INVERTIDO em relação à teoria.");
	} else {
		console.log("  ⚠️  IC95 cruza zero — sem sinal além do nível de odd.");
	}

	model.model.dispose();
	console.log("\n✅ Concluído.");
	process.exit(0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
