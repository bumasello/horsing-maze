// PRÉ-REGISTRO #1 — teste de falsificação em janela cega.
// Executa EXATAMENTE o que está congelado em
// docs/pre_registro_falsificacao_2026-08-18.md. Não alterar parâmetros.
//
// Config congelada:
//   janela        [2026-07-09, 2026-08-18]  (DAYS=40, END=1 a partir de 2026-08-19)
//   modelo        prod dos paths legados claude-ml-model-{flat,jump}
//   schema        DATA_SCHEMA=prd OUTPUT_SCHEMA=prd
//   regra de pick calculateCombinedScore/LayValueIndex intocadas, top-3,
//                 cascata pick1→2→3 pulando non_runner
//   banda         [MIN_ODD_THRESHOLD, MAX_ODD_THRESHOLD] = [13, 20]
//   odd seleção   morningwap (odd da manhã, pré-corrida)
//   odd liquidação BSP real — SEM BSP, A APOSTA É DESCARTADA.
//                 ⚠️ fallback pra sp_decimal é PROIBIDO por este pré-registro:
//                 foi a aproximação que produziu os ROIs inflados de julho.
//   stake         10 | comissão 6,5%
//   grupos        Flat e Jump AGREGADOS = teste primário.
//                 Separados são DESCRITIVOS, declarados secundários no
//                 pré-registro justamente pra não virar seleção disfarçada.
//   métrica       P/L total, cluster bootstrap por corrida, B=2000, IC95 percentil
//
// Veredicto (declarado ANTES de medir):
//   limite superior < 0  → ESTRATÉGIA MORTA
//   IC95 cruza zero      → NÃO DEMONSTRÁVEL (esperado a priori)
//   limite inferior > 0  → SOBREVIVE (promissor, NÃO provado)
//
// Uso: NO_CRON=1 PORT=3984 BSP_DIR=... npx ts-node src/oneTimeScript/run_preregistro_1.ts

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
import { COMMISSION_RATE, STAKE, WIN_PNL } from "../services/ml/eval/simulator";
import { getDataSchema, modelPath } from "../shared/db-config";

const DAYS = Number(process.env.DAYS || 40);
const END = Number(process.env.END || 1);
const B = Number(process.env.B || 2000);
const BSP_DIR = process.env.BSP_DIR || "/home/maze/dev/betfair_sp_data";

const GROUPS = [
	{ name: "Flat", mtype: "flat" as const, types: ["Flat"] },
	{ name: "Jump", mtype: "jump" as const, types: ["Hurdle", "Chase", "NHF"] },
];

interface Bet {
	raceId: number;
	group: string;
	pnl: number;
	won: boolean;
	odd: number;
}
// Uma entrada por CORRIDA (a unidade independente do bootstrap). Corrida sem
// aposta entra com pnl 0 — pular corridas enviesaria a reamostragem.
interface RaceOut {
	raceId: number;
	group: string;
	pnl: number;
	bet: Bet | null;
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

function pctl(sorted: number[], p: number): number {
	const i = Math.min(
		sorted.length - 1,
		Math.max(0, Math.floor(p * sorted.length)),
	);
	return sorted[i];
}

function report(label: string, races: RaceOut[], primary: boolean): void {
	const bets = races.filter((r) => r.bet).map((r) => r.bet as Bet);
	const n = races.length;
	const pnl = races.reduce((a, r) => a + r.pnl, 0);
	if (bets.length === 0) {
		console.log(`\n  ${label}: 0 apostas em ${n} corridas.`);
		return;
	}
	const reds = bets.filter((b) => b.won).length;
	const wr = (bets.length - reds) / bets.length;
	const avgOdd = bets.reduce((a, b) => a + b.odd, 0) / bets.length;
	// break-even do LAY na odd média, com comissão: (o-1)/(o-1+1-c)
	const be = (avgOdd - 1) / (avgOdd - 1 + (1 - COMMISSION_RATE));
	const roi = pnl / (bets.length * STAKE);

	const boots: number[] = [];
	for (let b = 0; b < B; b++) {
		let s = 0;
		for (let k = 0; k < n; k++) s += races[Math.floor(Math.random() * n)].pnl;
		boots.push(s);
	}
	boots.sort((a, b) => a - b);
	const lo = pctl(boots, 0.025);
	const hi = pctl(boots, 0.975);

	console.log(`\n  ${label}`);
	console.log(
		`    corridas ${n} | apostas ${bets.length} | reds ${reds} | odd média ${avgOdd.toFixed(2)}`,
	);
	console.log(
		`    WR ${(wr * 100).toFixed(2)}% | break-even ${(be * 100).toFixed(2)}% | margem ${((wr - be) * 100 >= 0 ? "+" : "") + ((wr - be) * 100).toFixed(2)}pp`,
	);
	console.log(
		`    P/L ${pnl.toFixed(0)} | ROI/aposta ${(roi * 100).toFixed(2)}%`,
	);
	console.log(
		`    IC95 do P/L (cluster bootstrap, B=${B}): [${lo.toFixed(0)}, ${hi.toFixed(0)}]`,
	);

	if (primary) {
		console.log("\n  ┌──────────────────── VEREDICTO ────────────────────┐");
		if (hi < 0) {
			console.log("  │  ❌ ESTRATÉGIA MORTA — limite superior < 0        │");
			console.log("  │     Não apostar em novembro. Encerrado.           │");
		} else if (lo > 0) {
			console.log("  │  🟢 SOBREVIVE — limite inferior > 0               │");
			console.log("  │     Promissor, NÃO provado. Potência baixa        │");
			console.log("  │     demais pra confirmar. Não autoriza apostar.   │");
		} else {
			console.log("  │  ⚠️  NÃO DEMONSTRÁVEL — o IC95 cruza zero          │");
			console.log("  │     Resposta default: não apostar R$200 nessa     │");
			console.log("  │     estratégia. Era o resultado esperado a priori.│");
			console.log("  │     A cláusula anti-viés do pré-registro proíbe   │");
			console.log("  │     procurar um corte que passe.                  │");
		}
		console.log("  └───────────────────────────────────────────────────┘");
	}
}

(async () => {
	console.log("\n🔬 PRÉ-REGISTRO #1 — falsificação em janela cega\n");
	console.log(
		`📋 janela [${DAYS + END}, ${END}) dias = [2026-07-09, 2026-08-18]`,
	);
	console.log(
		`📋 banda [${MIN_ODD_THRESHOLD},${MAX_ODD_THRESHOLD}] | stake ${STAKE} | comissão ${(COMMISSION_RATE * 100).toFixed(1)}% | schema ${getDataSchema()}`,
	);
	console.log("📋 seleção: morningwap | liquidação: BSP real (SEM fallback)\n");

	const { lookup } = loadBspLookup(BSP_DIR);
	await mongoose.connect(process.env.MONGOOSE as string);

	const all: RaceOut[] = [];
	let noBsp = 0;

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

		for (const [raceId, horses] of raceMap) {
			const date = racesTbl.get(raceId)?.date;
			const out: RaceOut = { raceId, group: g.name, pnl: 0, bet: null };
			if (!date || horses.length < 3) {
				all.push(out);
				continue;
			}
			const pLose = predictRace(horses, model);
			const oddsOf = (rhId: number) => {
				const name = horsesTbl.get(rhId)?.horse;
				if (!name) return undefined;
				return lookupBsp(lookup, date, normName(name))?.row;
			};

			const cands: Array<{ h: HorseRecord; combined: number }> = [];
			for (let i = 0; i < horses.length; i++) {
				if (pLose[i] < 0) continue;
				const od = oddsOf(horses[i].race_horse_id);
				// SEM fallback: sem morningwap, o cavalo não é candidato.
				if (!od || !(od.morningwap > 1)) continue;
				const ivl = calculateLayValueIndex(pLose[i], od.morningwap);
				cands.push({
					h: horses[i],
					combined: calculateCombinedScore(pLose[i], ivl, od.morningwap),
				});
			}
			cands.sort((a, b) => b.combined - a.combined);

			for (const c of cands.slice(0, 3)) {
				if (c.h.non_runner) continue;
				const od = oddsOf(c.h.race_horse_id);
				// SEM BSP → aposta DESCARTADA (proibido usar sp_decimal)
				if (!od || !(od.bsp > 1)) {
					noBsp++;
					continue;
				}
				if (od.bsp < MIN_ODD_THRESHOLD || od.bsp > MAX_ODD_THRESHOLD) continue;
				const won = c.h.finish_position === 1;
				const pnl = won
					? -STAKE * (od.bsp - 1)
					: WIN_PNL * (1 - COMMISSION_RATE);
				out.pnl = pnl;
				out.bet = { raceId, group: g.name, pnl, won, odd: od.bsp };
				break;
			}
			all.push(out);
		}
		model.model.dispose();
	}

	console.log(
		`🏁 corridas na janela: ${all.length} | descartes por falta de BSP: ${noBsp}`,
	);

	console.log(
		"\n════════════════════════════════════════════════════════════════",
	);
	console.log("  TESTE PRIMÁRIO — Flat + Jump AGREGADOS");
	console.log(
		"════════════════════════════════════════════════════════════════",
	);
	report("agregado", all, true);

	console.log(
		"\n════════════════════════════════════════════════════════════════",
	);
	console.log(
		"  SECUNDÁRIO — DESCRITIVO, não decisório (assim declarado antes)",
	);
	console.log(
		"════════════════════════════════════════════════════════════════",
	);
	for (const g of GROUPS) {
		report(
			g.name,
			all.filter((r) => r.group === g.name),
			false,
		);
	}

	console.log("\n✅ Concluído.");
	process.exit(0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
