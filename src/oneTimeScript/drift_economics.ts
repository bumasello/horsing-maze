// A economia do trading de drift fecha? (DEV-ONLY, não escreve nada)
//
// PRECEDE o pré-registro #3. A pergunta "o sinal cobre os custos?" pode ser
// respondida na janela JÁ QUEIMADA, porque não há parâmetro a escolher: é
// aritmética de custo sobre um sinal já medido. Gastar a janela cega antes de
// saber se a economia fecha seria desperdiçá-la.
//
// Fórmula correta de fechar um LAY (o ticket #11 errou nos dois):
//   lay em O_ent com stake S, back em O_sai com stake S*O_ent/O_sai
//   → lucro travado P = S * (O_sai - O_ent) / O_sai
//   LAY LUCRA QUANDO A ODD ALONGA (O_sai > O_ent). Lay baixo, back alto.
//   O ticket usava (O_ent - O_sai)*S: sinal invertido E sem o divisor, que
//   em odd 16 superestima o lucro em 16x.
//
// Custo: a Betfair tem tick VARIÁVEL por faixa de preço. Em odd 16 o tick é
// 0,5 — ou seja 3,1% do preço. Cruzar o spread na entrada e na saída custa
// isso duas vezes. É esse número que decide o ticket.
//
// Uso: NO_CRON=1 PORT=3977 GROUP=Flat npx ts-node src/oneTimeScript/drift_economics.ts

import dotenv from "dotenv";
dotenv.config();

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
import { COMMISSION_RATE } from "../services/ml/eval/simulator";
import { getDataSchema, modelPath } from "../shared/db-config";

const GROUP = (process.env.GROUP || "Flat").trim();
const CFG: Record<string, { mtype: "flat" | "jump"; types: string[] }> = {
	Flat: { mtype: "flat", types: ["Flat"] },
	Jump: { mtype: "jump", types: ["Hurdle", "Chase", "NHF"] },
};
const G = CFG[GROUP];
const DAYS = Number(process.env.DAYS || 250);
const END = Number(process.env.END || 38);
const BSP_DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const MODEL_PATH =
	process.env.MODEL_PATH ||
	`horse_probability_model/baselines/no_market_${G.mtype}`;
// filtro de odd do ticket #11
const MIN_ODD = Number(process.env.MIN_ODD || 4);
const MAX_ODD = Number(process.env.MAX_ODD || 20);

/** Escada de ticks da Betfair. O tick é uma fração MAIOR do preço em odds altas. */
function tickSize(odd: number): number {
	if (odd < 2) return 0.01;
	if (odd < 3) return 0.02;
	if (odd < 4) return 0.05;
	if (odd < 6) return 0.1;
	if (odd < 10) return 0.2;
	if (odd < 20) return 0.5;
	if (odd < 30) return 1;
	if (odd < 50) return 2;
	if (odd < 100) return 5;
	return 10;
}

interface Row {
	morning: number;
	bsp: number;
	div: number; // P_model(lose) - P_market(lose), positivo = modelo acha PIOR
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

const mean = (x: number[]) =>
	x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0;

(async () => {
	console.log("\n💱 A economia do trading de drift fecha? (DEV-ONLY)\n");
	console.log(`📋 grupo ${GROUP} | modelo ${MODEL_PATH}`);
	console.log(`📋 janela [${DAYS + END}, ${END}) — JÁ QUEIMADA, de propósito`);
	console.log(
		`📋 filtro de odd de entrada [${MIN_ODD}, ${MAX_ODD}] (ticket #11)\n`,
	);

	const { lookup } = loadBspLookup(BSP_DIR);
	await mongoose.connect(process.env.MONGOOSE as string);
	const model = await loadModelFromPath(modelPath(MODEL_PATH), G.mtype);
	const raceMap = await loadPeriodData(G.types, DAYS, END);
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
	for (const [rid, horses] of raceMap) {
		const date = racesTbl.get(rid)?.date;
		if (!date) continue;
		const pLose = predictRace(horses, model);
		const rec: Array<{ i: number; m: number; b: number }> = [];
		for (let i = 0; i < horses.length; i++) {
			const h = horses[i] as HorseRecord;
			if (pLose[i] < 0) continue;
			const name = horsesTbl.get(h.race_horse_id)?.horse;
			if (!name) continue;
			const r = lookupBsp(lookup, date, normName(name))?.row;
			if (!r || !(r.bsp > 1) || !(r.morningwap > 1)) continue;
			rec.push({ i, m: r.morningwap, b: r.bsp });
		}
		if (rec.length < 4) continue;
		const sumM = rec.reduce((a, r) => a + 1 / r.m, 0);
		const sumMl = rec.reduce((a, r) => a + (1 - pLose[r.i]), 0);
		if (sumM <= 0 || sumMl <= 0) continue;
		for (const r of rec) {
			const qM = 1 / r.m / sumM;
			const pMlWin = (1 - pLose[r.i]) / sumMl;
			// divergência em P(lose): positivo = modelo acha o cavalo PIOR
			rows.push({ morning: r.m, bsp: r.b, div: 1 - pMlWin - (1 - qM) });
		}
	}
	model.model.dispose();

	const elig = rows.filter((r) => r.morning >= MIN_ODD && r.morning <= MAX_ODD);
	console.log(
		`🐎 cavalos: ${rows.length} | dentro do filtro de odd: ${elig.length}\n`,
	);

	// quintis por divergência; Q5 = modelo acha PIOR = candidato a LAY
	const byDiv = [...elig].sort((a, b) => a.div - b.div);
	const q = Math.floor(byDiv.length / 5);

	console.log(
		"════════════════════════════════════════════════════════════════════════",
	);
	console.log("  RETORNO BRUTO DO TRADE vs CUSTO, por quintil de divergência");
	console.log(
		"════════════════════════════════════════════════════════════════════════",
	);
	console.log(
		"  quintil        n    odd ent.   odd saída   BRUTO%   spread%   comiss%    LÍQUIDO%",
	);
	for (let k = 0; k < 5; k++) {
		const sl = byDiv.slice(k * q, k === 4 ? byDiv.length : (k + 1) * q);
		// lucro travado do LAY: (O_sai - O_ent)/O_sai, em fração do stake
		const gross = sl.map((r) => (r.bsp - r.morning) / r.bsp);
		// custo: cruzar o spread 1 tick na entrada e 1 na saída, cada um
		// proporcional ao preço da respectiva ponta
		const spread = sl.map(
			(r) => tickSize(r.morning) / r.morning + tickSize(r.bsp) / r.bsp,
		);
		const g = mean(gross);
		const s = mean(spread);
		// comissão incide só sobre lucro líquido positivo
		const netBefore = g - s;
		const comm = netBefore > 0 ? netBefore * COMMISSION_RATE : 0;
		const net = netBefore - comm;
		const tag = k === 4 ? " (LAY)" : k === 0 ? " (BACK)" : "      ";
		console.log(
			`  Q${k + 1}${tag} ${String(sl.length).padStart(6)}    ${mean(
				sl.map((r) => r.morning),
			)
				.toFixed(2)
				.padStart(6)}     ${mean(sl.map((r) => r.bsp))
				.toFixed(2)
				.padStart(
					6,
				)}   ${(g * 100 >= 0 ? "+" : "") + (g * 100).toFixed(2).padStart(5)}%   ${(s * 100).toFixed(2).padStart(5)}%   ${(comm * 100).toFixed(2).padStart(5)}%   ${(net * 100 >= 0 ? "+" : "") + (net * 100).toFixed(2).padStart(6)}%`,
		);
	}

	console.log(
		"\n  BRUTO   = (odd_saída − odd_entrada)/odd_saída — lucro travado do LAY",
	);
	console.log(
		"  spread  = 1 tick na entrada + 1 tick na saída (conservador; o",
	);
	console.log(
		"            ticket #11 sugeria 2 ticks, que seria o dobro disto)",
	);
	console.log("  Q5 = modelo acha o cavalo PIOR que o mercado → tese de LAY");

	// quanto do bruto o custo come — o kill switch nº 3 do ticket
	const q5 = byDiv.slice(4 * q);
	const g5 = mean(q5.map((r) => (r.bsp - r.morning) / r.bsp));
	const s5 = mean(
		q5.map((r) => tickSize(r.morning) / r.morning + tickSize(r.bsp) / r.bsp),
	);
	console.log(
		"\n════════════════════════════════════════════════════════════════════════",
	);
	console.log("  KILL SWITCH #3 do ticket: custo consome >80% do bruto?");
	console.log(
		"════════════════════════════════════════════════════════════════════════",
	);
	if (g5 <= 0) {
		console.log(
			`  Bruto do Q5 já é NEGATIVO (${(g5 * 100).toFixed(2)}%) — não há lucro pra consumir.`,
		);
	} else {
		const frac = (s5 / g5) * 100;
		console.log(
			`  bruto Q5 ${(g5 * 100).toFixed(2)}% | custo ${(s5 * 100).toFixed(2)}% | consome ${frac.toFixed(0)}%`,
		);
		console.log(
			frac > 80
				? "  ❌ REFUTADO pelo kill switch #3."
				: "  ✅ passa o kill switch #3.",
		);
	}

	// ===== O TESTE QUE DECIDE: excesso sobre pares de MESMA ODD =====
	// O bruto é positivo em TODOS os quintis, o que denuncia um componente
	// comum: de manhã o livro tem overround maior, então as odds "alongam"
	// em bloco até o BSP. Isso NÃO é negociável — se desse pra lucrar laying
	// qualquer cavalo, seria arbitrado. O que se negocia é o excesso RELATIVO
	// a cavalos do mesmo nível de preço.
	console.log(
		"\n════════════════════════════════════════════════════════════════════════",
	);
	console.log(
		"  EXCESSO sobre pares de MESMA FAIXA DE ODD (o que é negociável)",
	);
	console.log(
		"════════════════════════════════════════════════════════════════════════",
	);
	// baseline: bruto médio por decil de odd de entrada
	const byOdd = [...elig].sort((a, b) => a.morning - b.morning);
	const dq = Math.floor(byOdd.length / 10);
	const cuts: number[] = [];
	for (let k = 1; k < 10; k++) cuts.push(byOdd[k * dq].morning);
	const decOf = (o: number) => {
		let d = 0;
		while (d < cuts.length && o >= cuts[d]) d++;
		return d;
	};
	const base: number[] = [];
	for (let d = 0; d < 10; d++) {
		const sl = elig.filter((r) => decOf(r.morning) === d);
		base.push(mean(sl.map((r) => (r.bsp - r.morning) / r.bsp)));
	}
	console.log(
		"  quintil        n   EXCESSO%   LÍQ.otimista   LÍQ.base   LÍQ.pessimista",
	);
	for (let k = 0; k < 5; k++) {
		const sl = byDiv.slice(k * q, k === 4 ? byDiv.length : (k + 1) * q);
		const g = mean(sl.map((r) => (r.bsp - r.morning) / r.bsp));
		const b = mean(sl.map((r) => base[decOf(r.morning)]));
		const exc = g - b;
		// Três modelos de execução. A diferença entre eles é MAIOR que o sinal
		// — é o ponto central: a decisão depende de execução, não de previsão.
		//   otimista  = 1 tick na entrada, SAÍDA GRÁTIS. Uma ordem "at BSP" casa
		//               no BSP por construção, sem cruzar spread. É o mais
		//               realista pro desenho manhã→BSP.
		//   base      = 1 tick em cada ponta.
		//   pessimista= 2 ticks em cada ponta (sugestão do ticket #11).
		const cOpt = mean(sl.map((r) => tickSize(r.morning) / r.morning));
		const cBase = mean(
			sl.map((r) => tickSize(r.morning) / r.morning + tickSize(r.bsp) / r.bsp),
		);
		const netOf = (c: number) => {
			const nb = exc - c;
			return nb - (nb > 0 ? nb * COMMISSION_RATE : 0);
		};
		const fm = (x: number) =>
			(x * 100 >= 0 ? "+" : "") + (x * 100).toFixed(2).padStart(6) + "%";
		const tag = k === 4 ? " (LAY)" : "      ";
		console.log(
			`  Q${k + 1}${tag} ${String(sl.length).padStart(6)}   ${(exc * 100 >= 0 ? "+" : "") + (exc * 100).toFixed(2).padStart(6)}%     ${fm(netOf(cOpt))}    ${fm(netOf(cBase))}     ${fm(netOf(cBase * 2))}`,
		);
	}
	console.log(
		"\n  baseline = bruto médio de cavalos no MESMO decil de odd de entrada.",
	);
	console.log(
		"  EXCESSO = o que a divergência do modelo acrescenta ao movimento que",
	);
	console.log(
		"  já aconteceria por nível de preço. É o único componente negociável.",
	);

	// tamanho do tick por faixa — o motivo estrutural
	console.log("\n  tick da Betfair como % do preço:");
	for (const o of [4, 6, 10, 16, 20]) {
		console.log(
			`    odd ${String(o).padStart(2)} → tick ${tickSize(o)} = ${((tickSize(o) / o) * 100).toFixed(2)}% do preço`,
		);
	}

	console.log("\n✅ Concluído.");
	process.exit(0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
