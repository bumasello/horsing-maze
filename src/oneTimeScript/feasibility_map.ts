// MAPA DE EXIGÊNCIAS DEV-ONLY: quanto edge cada (lado × banda de odd × banca)
// EXIGIRIA pra bater a meta de novembro?
//
// POR QUE ESTE SCRIPT NÃO É UM SWEEP (importante):
// O sweep de bandas de 2026-08-12 perguntou "qual célula teve o melhor P/L
// histórico" e selecionou ruído — a melhor banda ([1.5,3], +10% ROI in-sample)
// morreu out-of-sample (−0,2% em 888 apostas). Aqui a pergunta é invertida:
// "quanto ROI/aposta cada célula EXIGIRIA pra P(sobreviver E terminar positivo)
// ≥ TARGET_P". Isso é aritmética estrutural — não olha quem ganhou, só a
// distribuição de odds e a frequência de apostas do mercado. Os resultados do
// modelo NÃO entram no cálculo, então não há o que selecionar por ruído.
//
// O output é um mapa de VIABILIDADE, pra ELIMINAR regiões impossíveis. Célula
// que exige 50% de ROI está morta independente do histórico. Célula que exige
// 2% é candidata — e aí sim vira alvo de uma validação pré-registrada única.
//
// Referência de comparação: a medição honesta de 12/08 deu +8,8% de ROI/aposta
// na banda [13,20] (não-significativo, IC95 cruzando zero). Então uma célula que
// exija muito mais que ~9% está pedindo um edge que nunca observamos.
//
// Uso: nvm use 20 && NO_CRON=1 PORT=3988 BSP_DIR=/home/maze/dev/betfair_sp_data \
//      npx ts-node src/oneTimeScript/feasibility_map.ts
// Env: EVAL_DAYS (540), END_DAYS_AGO (41), MONTHS (4000), TARGET_P (0.80),
//      MIN_STAKE (5), BSP_DIR, GROUPS ("Flat,Jump")

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { supabase } from "..";
import {
	loadBspLookup,
	lookupBsp,
	normName,
} from "../services/ml/eval/bsp-lookup";
import { type HorseRecord, loadPeriodData } from "../services/ml/eval/harness";
import { COMMISSION_RATE } from "../services/ml/eval/simulator";
import { getDataSchema } from "../shared/db-config";

const EVAL_DAYS = Number(process.env.EVAL_DAYS || 540);
// features de hml param em 2026-07-08 (DISABLE_PIPELINE_CRON no serviço de teste)
const END_DAYS_AGO = Number(process.env.END_DAYS_AGO || 41);
const MONTHS = Number(process.env.MONTHS || 4000);
const DAYS_IN_MONTH = Number(process.env.DAYS_IN_MONTH || 30);
const TARGET_P = Number(process.env.TARGET_P || 0.8);
const MIN_STAKE = Number(process.env.MIN_STAKE || 5); // mínimo Betfair BRL
const BSP_DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";

const BANDS: Array<[number, number]> = [
	[1.5, 2.5],
	[2, 3],
	[3, 5],
	[4, 7],
	[6, 10],
	[8, 13],
	[13, 20],
	[20, 40],
];
const BANKS = [200, 300, 500, 800, 1200, 2000];
type Side = "lay" | "back";

const ALL_GROUPS = [
	{ name: "Flat", types: ["Flat"] },
	{ name: "Jump", types: ["Hurdle", "Chase", "NHF"] },
];
const GROUPS = (process.env.GROUPS || "Flat,Jump")
	.split(",")
	.map((g) => ALL_GROUPS.find((x) => x.name === g.trim()))
	.filter((x): x is (typeof ALL_GROUPS)[number] => Boolean(x));

interface Odds {
	bsp?: number;
	morningwap?: number;
}
/** Uma oportunidade de aposta: só a odd de liquidação e o dia. Sem resultado —
 *  o desfecho é sorteado a partir do ROI-alvo, não lido do histórico. */
interface Slot {
	date: string;
	odd: number;
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

/**
 * Probabilidade de ACERTO NOSSO que entrega ROI/aposta = r.
 *   LAY : ganho = +stake(1−c) se o cavalo perde; perda = −stake(odd−1)
 *   BACK: ganho = +stake(odd−1)(1−c) se o cavalo vence; perda = −stake
 * Com r = 0 devolve o break-even (odd 20 lay, c=6,5% → 95,31%, confere com o
 * número documentado no CLAUDE.md).
 */
function winProbForRoi(side: Side, odd: number, r: number): number {
	const c = COMMISSION_RATE;
	if (side === "lay") return (r + odd - 1) / (odd - 1 + 1 - c);
	return (r + 1) / ((odd - 1) * (1 - c) + 1);
}

/** P(nunca quebrar E terminar acima da banca inicial), com desfechos sorteados
 *  a partir do ROI-alvo. Devolve também o lucro mediano. */
function simulate(
	byDay: Slot[][],
	side: Side,
	bank0: number,
	roi: number,
	lo: number,
	hi: number,
): { pGoal: number; medianProfit: number; betsPerMonth: number } {
	const minLiab = side === "lay" ? MIN_STAKE * (lo - 1) : MIN_STAKE;
	const finals: number[] = [];
	let good = 0;
	let totalBets = 0;
	for (let m = 0; m < MONTHS; m++) {
		let bank = bank0;
		let busted = false;
		let n = 0;
		for (let d = 0; d < DAYS_IN_MONTH && !busted; d++) {
			const day = byDay[Math.floor(Math.random() * byDay.length)];
			for (const s of day) {
				const liability = side === "lay" ? MIN_STAKE * (s.odd - 1) : MIN_STAKE;
				if (liability > bank) continue; // não cobre a responsabilidade: pula
				n++;
				const pWin = winProbForRoi(side, s.odd, roi);
				const weWin = Math.random() < pWin;
				if (side === "lay")
					bank += weWin ? MIN_STAKE * (1 - COMMISSION_RATE) : -liability;
				else
					bank += weWin
						? MIN_STAKE * (s.odd - 1) * (1 - COMMISSION_RATE)
						: -MIN_STAKE;
				if (bank < minLiab) {
					busted = true;
					break;
				}
			}
		}
		totalBets += n;
		if (!busted && bank > bank0) good++;
		finals.push(bank - bank0);
	}
	finals.sort((a, b) => a - b);
	return {
		pGoal: good / MONTHS,
		medianProfit: finals[Math.floor(finals.length / 2)],
		betsPerMonth: totalBets / MONTHS,
	};
}

/** Menor ROI/aposta que atinge TARGET_P. Busca binária; null se nem 100% basta. */
function requiredRoi(
	byDay: Slot[][],
	side: Side,
	bank0: number,
	lo: number,
	hi: number,
): { roi: number | null; medianProfit: number; betsPerMonth: number } {
	const top = simulate(byDay, side, bank0, 1.0, lo, hi);
	if (top.pGoal < TARGET_P)
		return {
			roi: null,
			medianProfit: top.medianProfit,
			betsPerMonth: top.betsPerMonth,
		};
	let loR = 0;
	let hiR = 1.0;
	if (simulate(byDay, side, bank0, 0, lo, hi).pGoal >= TARGET_P) hiR = 0;
	else
		for (let i = 0; i < 12; i++) {
			const mid = (loR + hiR) / 2;
			if (simulate(byDay, side, bank0, mid, lo, hi).pGoal >= TARGET_P)
				hiR = mid;
			else loR = mid;
		}
	const fin = simulate(byDay, side, bank0, hiR, lo, hi);
	return {
		roi: hiR,
		medianProfit: fin.medianProfit,
		betsPerMonth: fin.betsPerMonth,
	};
}

async function main(): Promise<void> {
	console.log("🗺️  Mapa de exigências — lado × banda × banca (DEV-ONLY)\n");
	console.log(
		`📋 janela ${EVAL_DAYS}d terminando ${END_DAYS_AGO}d atrás | ${MONTHS} meses de ${DAYS_IN_MONTH}d`,
	);
	console.log(
		`📋 meta: P(nunca quebrar E terminar positivo) ≥ ${(TARGET_P * 100).toFixed(0)}% | stake fixo R$${MIN_STAKE} | comissão ${(COMMISSION_RATE * 100).toFixed(1)}%`,
	);
	console.log(
		"📋 referência: a medição honesta de 12/08 deu +8,8% ROI/aposta em [13,20] (não-significativo)\n",
	);
	await mongoose.connect(process.env.MONGOOSE as string);

	const { lookup, files } = loadBspLookup(BSP_DIR);
	console.log(`📂 BSP: ${files} arquivos, ${lookup.size} chaves`);

	// Coleta as odds de liquidação (BSP) de todos os cavalos, sem tocar em
	// resultado. A seleção por banda é neutra: o cavalo cuja odd da manhã está
	// mais perto do centro da banda. Nenhum modelo envolvido.
	const all: Array<{
		date: string;
		raceId: number;
		morning: number;
		bsp: number;
	}> = [];
	for (const g of GROUPS) {
		const raceMap = await loadPeriodData(g.types, EVAL_DAYS, END_DAYS_AGO);
		const raceIds = Array.from(raceMap.keys());
		const rhIds: number[] = [];
		for (const hs of raceMap.values())
			for (const h of hs) rhIds.push(h.race_horse_id);
		const races = await fetchMap<{ id: number; date: string }>(
			"racecards_hr_enriched",
			raceIds,
			"id, date",
		);
		const horsesTbl = await fetchMap<{ id: number; horse: string }>(
			"race_horses_hr_enriched",
			rhIds,
			"id, horse",
		);
		let matched = 0;
		for (const [raceId, hs] of raceMap) {
			for (const h of hs as HorseRecord[]) {
				if (h.non_runner) continue;
				const race = races.get(h.race_id);
				const rh = horsesTbl.get(h.race_horse_id);
				if (!race || !rh?.horse) continue;
				const found = lookupBsp(lookup, race.date, normName(rh.horse));
				const o = found?.row as Odds | undefined;
				if (!o?.bsp || !Number.isFinite(o.bsp)) continue;
				const morning = o.morningwap ?? h.market_odd;
				if (!morning || morning <= 0) continue;
				all.push({ date: race.date, raceId, morning, bsp: o.bsp });
				matched++;
			}
		}
		console.log(
			`🏁 ${g.name}: ${raceIds.length} corridas, ${matched} cavalos com BSP`,
		);
	}
	console.log(`\n📊 ${all.length} oportunidades no total\n`);

	for (const side of ["lay", "back"] as Side[]) {
		console.log(`\n${"═".repeat(78)}`);
		console.log(
			`  ${side.toUpperCase()}  —  responsabilidade por aposta = ${side === "lay" ? "R$5 × (odd−1)" : "R$5 fixo"}`,
		);
		console.log("═".repeat(78));

		for (const [lo, hi] of BANDS) {
			// 1 aposta por corrida: a odd da manhã mais perto do centro da banda
			const center = Math.sqrt(lo * hi);
			const best = new Map<number, { date: string; odd: number; d: number }>();
			for (const r of all) {
				if (r.morning < lo || r.morning > hi) continue;
				if (r.bsp < lo || r.bsp > hi) continue; // ordem com limite: só casa dentro da banda
				const d = Math.abs(Math.log(r.morning / center));
				const cur = best.get(r.raceId);
				if (!cur || d < cur.d)
					best.set(r.raceId, { date: r.date, odd: r.bsp, d });
			}
			const slots: Slot[] = Array.from(best.values()).map((b) => ({
				date: b.date,
				odd: b.odd,
			}));
			if (slots.length < 100) {
				console.log(
					`\n  banda [${lo},${hi}]: só ${slots.length} oportunidades — amostra insuficiente, pulando`,
				);
				continue;
			}
			const byDayMap = new Map<string, Slot[]>();
			for (const s of slots) {
				if (!byDayMap.has(s.date)) byDayMap.set(s.date, []);
				byDayMap.get(s.date)!.push(s);
			}
			const byDay = Array.from(byDayMap.values());
			const avgOdd = slots.reduce((a, s) => a + s.odd, 0) / slots.length;
			const liab = side === "lay" ? MIN_STAKE * (avgOdd - 1) : MIN_STAKE;
			const be = winProbForRoi(side, avgOdd, 0) * 100;

			console.log(
				`\n  banda [${lo},${hi}] — odd média ${avgOdd.toFixed(1)}, responsabilidade R$${liab.toFixed(0)}/aposta, break-even ${be.toFixed(2)}%`,
			);
			console.log(
				`  ${"banca".padStart(7)} ${"resp/banca".padStart(11)} ${"apostas/mês".padStart(12)} ${"ROI exigido".padStart(12)} ${"lucro mediano".padStart(14)}`,
			);
			for (const bank of BANKS) {
				const { roi, medianProfit, betsPerMonth } = requiredRoi(
					byDay,
					side,
					bank,
					lo,
					hi,
				);
				const pct = ((liab / bank) * 100).toFixed(1);
				const roiTxt =
					roi === null ? "impossível" : `${(roi * 100).toFixed(1)}%`;
				const profTxt = roi === null ? "—" : `R$${medianProfit.toFixed(0)}`;
				console.log(
					`  ${String(bank).padStart(7)} ${(`${pct}%`).padStart(11)} ${betsPerMonth.toFixed(0).padStart(12)} ${roiTxt.padStart(12)} ${profTxt.padStart(14)}`,
				);
			}
		}
	}

	await mongoose.disconnect();
	console.log("\n✅ Concluído.");
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
