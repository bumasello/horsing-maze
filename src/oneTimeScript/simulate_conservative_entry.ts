// Ticket 8 — a "regra dos 80%" foi estratégia ou sorte? (DEV-ONLY)
//
// Replica a gestão manual do primeiro rollout (banca 150 → 490): olhar o Top 1,
// entrar só se a responsabilidade couber em 80% da banca, cascatear pro Top 2/3,
// e pular a corrida se nenhum passar.
//
// ⚠️ POR QUE UMA TRAJETÓRIA HISTÓRICA NÃO RESPONDE A PERGUNTA: "a banca foi de
// 150 a 490" é UMA realização de um processo estocástico. Com edge medido
// indistinguível de zero, curvas assim aparecem por acaso com frequência alta.
// Rodar a simulação uma vez e ver a banca subir NÃO distingue sorte de
// estratégia — só reproduz a mesma amostra de 1. Por isso o script reamostra
// as corridas (cluster bootstrap) e reporta a DISTRIBUIÇÃO de desfechos:
// P(ruína), P(terminar acima de X), mediana e IC95 da banca final.
//
// ⚠️ A regra dos 80% NÃO é controle de risco: ela AUTORIZA arriscar até 80% da
// banca numa única aposta. Só barra o que passa disso. Está aqui pra ser
// testada, não porque seja segura.
//
// Sem look-ahead: seleção e checagem de responsabilidade pela odd da MANHÃ
// (morningwap, conhecida quando a aposta é feita); liquidação no BSP real.
// Como a odd tende a ALONGAR até a largada (drift), a responsabilidade real no
// BSP pode estourar o limite que passou de manhã — o script mede isso.
//
// Cenários:
//   A) atual — cascata Top1→2→3 na banda de prod [13,20], sem regra de banca
//   B) regra dos 80%, sem filtro de odd
//   C) regra dos 80% + filtro de odd configurável (default [8,16])
//
// Uso: NO_CRON=1 PORT=3987 BSP_DIR=... npx ts-node src/oneTimeScript/simulate_conservative_entry.ts
// Env: GROUPS ("Flat,Jump"), DAYS (250), END (38), BANK0 (150), STAKE_SIM (10),
//      C_MIN_ODD (8), C_MAX_ODD (16), B (2000)

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { supabase } from "..";
import {
	MAX_ODD_THRESHOLD,
	MIN_ODD_THRESHOLD,
	calculateCombinedScore,
	calculateLayValueIndex,
} from "../services/ml/claude-generate-picks";
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

const DAYS = Number(process.env.DAYS || 250);
const END = Number(process.env.END || 38); // CSVs de BSP acabam em 2026-07-12
const BSP_DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";
const BANK0 = Number(process.env.BANK0 || 150);
const STAKE_SIM = Number(process.env.STAKE_SIM || 10);
const C_MIN = Number(process.env.C_MIN_ODD || 8);
const C_MAX = Number(process.env.C_MAX_ODD || 16);
const NBOOT = Number(process.env.B || 2000);
const RULE_FRAC = 0.8;

const ALL = [
	{ name: "Flat", mtype: "flat" as const, types: ["Flat"] },
	{ name: "Jump", mtype: "jump" as const, types: ["Hurdle", "Chase", "NHF"] },
];
const GROUPS = (process.env.GROUPS || "Flat,Jump")
	.split(",")
	.map((g) => ALL.find((x) => x.name === g.trim()))
	.filter((x): x is (typeof ALL)[number] => Boolean(x));

// Uma corrida pronta pra simular: candidatos ordenados por combined_score,
// já com odd da manhã (seleção) e BSP (liquidação).
interface RaceCand {
	morning: number;
	bsp: number;
	won: boolean;
}
interface Race {
	date: string;
	cands: RaceCand[]; // ordenados por combined_score desc
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

type Scenario = "A" | "B" | "C";

interface PathResult {
	final: number;
	bets: number;
	skipped: number;
	maxDd: number;
	peak: number; // maior banca atingida em qualquer momento
	ruined: boolean; // banca caiu abaixo de 10% do inicial
	liabilityBlown: number; // passou no check da manhã mas estourou no BSP
}

function runPath(races: Race[], scen: Scenario): PathResult {
	let bank = BANK0;
	let peak = BANK0;
	let maxDd = 0;
	let bets = 0;
	let skipped = 0;
	let ruined = false;
	let liabilityBlown = 0;

	for (const race of races) {
		// Banca zerada = fim do jogo. Sem isso a simulação segue apostando com
		// banca negativa e produz "banca final" impossível (ex: -5514).
		if (bank <= 0) {
			ruined = true;
			bank = 0;
			skipped++;
			continue;
		}
		// filtro de elegibilidade por cenário, sobre a odd da MANHÃ
		const lo = scen === "C" ? C_MIN : MIN_ODD_THRESHOLD;
		const hi = scen === "C" ? C_MAX : MAX_ODD_THRESHOLD;

		let chosen: RaceCand | null = null;
		for (const c of race.cands.slice(0, 3)) {
			if (c.morning < lo || c.morning > hi) continue;
			if (scen !== "A") {
				// regra dos 80%: responsabilidade tem que caber em 80% da banca
				const liability = STAKE_SIM * (c.morning - 1);
				if (liability > RULE_FRAC * bank) continue;
			}
			chosen = c;
			break;
		}
		if (!chosen) {
			skipped++;
			continue;
		}

		bets++;
		if (chosen.won) {
			const realLiab = STAKE_SIM * (chosen.bsp - 1);
			if (scen !== "A" && realLiab > RULE_FRAC * bank) liabilityBlown++;
			bank -= realLiab;
		} else {
			bank += STAKE_SIM * (1 - COMMISSION_RATE);
		}
		if (bank > peak) peak = bank;
		const dd = peak - bank;
		if (dd > maxDd) maxDd = dd;
		if (bank < 0.1 * BANK0) ruined = true;
	}

	return { final: bank, bets, skipped, maxDd, peak, ruined, liabilityBlown };
}

function pctl(sorted: number[], p: number): number {
	const i = Math.min(
		sorted.length - 1,
		Math.max(0, Math.floor(p * sorted.length)),
	);
	return sorted[i];
}

(async () => {
	console.log(
		'\n💰 Ticket 8 — "regra dos 80%": estratégia ou sorte? (DEV-ONLY)\n',
	);
	console.log(
		`📋 banca inicial ${BANK0} | stake ${STAKE_SIM} | comissão ${(COMMISSION_RATE * 100).toFixed(1)}%`,
	);
	console.log(
		`📋 janela [${DAYS + END}, ${END}) dias | seleção pela odd da MANHÃ, liquidação no BSP`,
	);
	console.log(
		`📋 cenários: A=atual [${MIN_ODD_THRESHOLD},${MAX_ODD_THRESHOLD}] | B=80% s/ filtro | C=80% + [${C_MIN},${C_MAX}]\n`,
	);

	const { lookup } = loadBspLookup(BSP_DIR);
	await mongoose.connect(process.env.MONGOOSE as string);

	const races: Race[] = [];
	for (const g of GROUPS) {
		const model = await loadModelFromPath(
			modelPath(`horse_probability_model/claude-ml-model-${g.mtype}`),
			g.mtype,
		);
		const raceMap = await loadPeriodData(g.types, DAYS, END);
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

		let matched = 0;
		let totalH = 0;
		for (const [rid, horses] of raceMap) {
			const date = racesTbl.get(rid)?.date;
			if (!date) continue;
			const pLose = predictRace(horses, model);
			const cands: Array<RaceCand & { score: number }> = [];
			for (let i = 0; i < horses.length; i++) {
				const h = horses[i] as HorseRecord;
				totalH++;
				if (pLose[i] < 0 || h.non_runner) continue;
				const name = horsesTbl.get(h.race_horse_id)?.horse;
				if (!name) continue;
				const found = lookupBsp(lookup, date, normName(name));
				const row = found?.row;
				if (!row || !(row.bsp > 1) || !(row.morningwap > 1)) continue;
				matched++;
				// combined_score calculado sobre a odd da MANHÃ (sem look-ahead)
				const ivl = calculateLayValueIndex(pLose[i], row.morningwap);
				cands.push({
					morning: row.morningwap,
					bsp: row.bsp,
					won: h.finish_position === 1,
					score: calculateCombinedScore(pLose[i], ivl, row.morningwap),
				});
			}
			if (cands.length < 3) continue;
			cands.sort((a, b) => b.score - a.score);
			races.push({ date, cands });
		}
		console.log(
			`  ${g.name}: ${raceMap.size} corridas | BSP casado ${matched}/${totalH} (${((matched / Math.max(totalH, 1)) * 100).toFixed(1)}%)`,
		);
		model.model.dispose();
	}

	races.sort((a, b) => a.date.localeCompare(b.date));
	console.log(`\n🏁 corridas simuláveis: ${races.length}\n`);
	if (races.length < 200) {
		console.log("❌ amostra insuficiente.");
		process.exit(1);
	}

	const scens: Scenario[] = ["A", "B", "C"];
	const label: Record<Scenario, string> = {
		A: `A) atual, cascata [${MIN_ODD_THRESHOLD},${MAX_ODD_THRESHOLD}]`,
		B: "B) regra 80%, sem filtro",
		C: `C) regra 80% + odd [${C_MIN},${C_MAX}]`,
	};

	// ===== 1. trajetória histórica única (o que o rollout manual foi) =====
	console.log(
		"════════════════════════════════════════════════════════════════════════",
	);
	console.log(
		"  1. TRAJETÓRIA HISTÓRICA ÚNICA (amostra de 1 — não conclui nada)",
	);
	console.log(
		"════════════════════════════════════════════════════════════════════════",
	);
	console.log(
		"  cenário                      banca final   apostas  puladas   maxDD  estourou",
	);
	for (const s of scens) {
		const r = runPath(races, s);
		console.log(
			`  ${label[s].padEnd(28)} ${r.final.toFixed(0).padStart(9)}   ${String(r.bets).padStart(6)}   ${String(r.skipped).padStart(6)}  ${r.maxDd.toFixed(0).padStart(6)}  ${String(r.liabilityBlown).padStart(6)}`,
		);
	}
	console.log(
		'\n  "estourou" = passou no teste de 80% pela odd da manhã mas a',
	);
	console.log("  responsabilidade real no BSP excedeu 80% da banca (drift).");

	// ===== 2. distribuição via cluster bootstrap =====
	console.log(
		"\n════════════════════════════════════════════════════════════════════════",
	);
	console.log(`  2. DISTRIBUIÇÃO (cluster bootstrap por corrida, B=${NBOOT})`);
	console.log(
		"════════════════════════════════════════════════════════════════════════",
	);
	console.log(
		"  cenário                      mediana   IC95 banca final    P(ruína)  P(final>490)  P(PICO>490)",
	);
	const n = races.length;
	for (const s of scens) {
		const finals: number[] = [];
		let ruins = 0;
		let above = 0;
		let peaked = 0;
		for (let b = 0; b < NBOOT; b++) {
			const sample: Race[] = new Array(n);
			for (let k = 0; k < n; k++)
				sample[k] = races[Math.floor(Math.random() * n)];
			const r = runPath(sample, s);
			finals.push(r.final);
			if (r.ruined) ruins++;
			if (r.final > 490) above++;
			if (r.peak > 490) peaked++;
		}
		finals.sort((a, b) => a - b);
		console.log(
			`  ${label[s].padEnd(28)} ${pctl(finals, 0.5).toFixed(0).padStart(7)}   [${pctl(finals, 0.025).toFixed(0).padStart(6)}, ${pctl(finals, 0.975).toFixed(0).padStart(6)}]     ${((ruins / NBOOT) * 100).toFixed(1).padStart(5)}%   ${((above / NBOOT) * 100).toFixed(1).padStart(9)}%   ${((peaked / NBOOT) * 100).toFixed(1).padStart(8)}%`,
		);
	}
	console.log(
		"\n  P(ruína) = banca cruzou 10% do inicial. P(final>490) = terminou como o",
	);
	console.log(
		"  rollout. P(PICO>490) = PASSOU por 490 em algum momento — é a diferença",
	);
	console.log(
		"  entre ter um sistema vencedor e ter uma sequência boa que depois volta.",
	);

	console.log("\n✅ Concluído.");
	process.exit(0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
