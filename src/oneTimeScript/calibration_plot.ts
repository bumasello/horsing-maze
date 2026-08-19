// Diagrama de confiabilidade da cauda (DEV-ONLY, não escreve nada). Ticket 5.
//
// Pergunta: quando o modelo diz "98% de chance de perder", o cavalo perde 98%
// das vezes? E o modelo estima isso melhor que o próprio preço?
//
// Por que importa pro LAY: a decisão é tomada na cauda direita de P(perder).
// Um erro de 1pp em 98% dobra a taxa de "red" e quebra a banca — enquanto o
// mesmo erro no meio da distribuição é irrelevante. Métricas agregadas
// (val_top1, CE média) não enxergam isso.
//
// Não precisa de BSP: usa P(perder) do modelo, odd de mercado e desfecho.
//
// Comparação honesta: em cada bin, o modelo é confrontado com o MERCADO como
// estimador da mesma quantidade (P(perder) implícita, de-overrounded na corrida),
// via Brier score. Sem esse contraste, "calibrado" não quer dizer nada.
//
// Uso: NO_CRON=1 PORT=3992 GROUP=Flat npx ts-node src/oneTimeScript/calibration_plot.ts
// Env: GROUP (Flat|Jump), DAYS (180), END (0), BAND (1 = só banda negociável)

import mongoose from "mongoose";
import {
	MAX_ODD_THRESHOLD,
	MIN_ODD_THRESHOLD,
} from "../services/ml/claude-generate-picks";
import {
	type HorseRecord,
	loadModelFromPath,
	loadPeriodData,
	predictRace,
} from "../services/ml/eval/harness";
import { COMMISSION_RATE } from "../services/ml/eval/simulator";
import { modelPath } from "../shared/db-config";

const GROUP = (process.env.GROUP || "Flat").trim();
const CFG: Record<string, { mtype: "flat" | "jump"; types: string[] }> = {
	Flat: { mtype: "flat", types: ["Flat"] },
	Jump: { mtype: "jump", types: ["Hurdle", "Chase", "NHF"] },
};
const G = CFG[GROUP];
if (!G) throw new Error(`GROUP inválido: ${GROUP}`);
const DAYS = Number(process.env.DAYS || 180);
const END = Number(process.env.END || 0);
const BAND = (process.env.BAND || "1").trim() !== "0";

interface Obs {
	pModel: number; // P(perder) do modelo
	pMarket: number; // P(perder) implícita, de-overrounded na corrida
	lost: boolean; // desfecho real: o cavalo NÃO venceu
	odd: number;
}

// break-even de P(perder) pro LAY na odd o, com comissão c:
//   p_be = (o-1) / (o-1 + 1-c)
function breakEven(odd: number, c: number): number {
	return (odd - 1) / (odd - 1 + (1 - c));
}

function brier(obs: Obs[], pick: (o: Obs) => number): number {
	let s = 0;
	for (const o of obs) {
		const y = o.lost ? 1 : 0;
		s += (pick(o) - y) ** 2;
	}
	return s / obs.length;
}

(async () => {
	console.log("\n📐 Diagrama de confiabilidade da cauda — modelo vs preço\n");
	console.log(
		`📋 grupo: ${GROUP} | janela: [${DAYS + END}, ${END}) dias | banda: ${
			BAND ? `[${MIN_ODD_THRESHOLD}, ${MAX_ODD_THRESHOLD}]` : "irrestrita"
		}`,
	);

	await mongoose.connect(process.env.MONGOOSE as string);
	const model = await loadModelFromPath(
		modelPath(`horse_probability_model/claude-ml-model-${G.mtype}`),
		G.mtype,
	);
	const raceMap = await loadPeriodData(G.types, DAYS, END);

	const obs: Obs[] = [];
	for (const [, horses] of raceMap) {
		if (horses.length < 4) continue;
		const pLose = predictRace(horses, model);

		// de-overround: normaliza 1/odd pra somar 1 na corrida
		let sumQ = 0;
		for (const h of horses as HorseRecord[]) {
			if (h.market_odd > 1) sumQ += 1 / h.market_odd;
		}
		if (sumQ <= 0) continue;

		for (let i = 0; i < horses.length; i++) {
			const h = horses[i] as HorseRecord;
			if (pLose[i] < 0 || h.market_odd <= 1) continue;
			if (h.finish_position == null) continue;
			if (
				BAND &&
				(h.market_odd < MIN_ODD_THRESHOLD || h.market_odd > MAX_ODD_THRESHOLD)
			)
				continue;
			const qWin = 1 / h.market_odd / sumQ;
			obs.push({
				pModel: pLose[i],
				pMarket: 1 - qWin,
				lost: h.finish_position !== 1,
				odd: h.market_odd,
			});
		}
	}

	if (obs.length === 0) {
		console.log("❌ nenhuma observação.");
		process.exit(1);
	}
	console.log(`🐎 observações (cavalo-corrida): ${obs.length}\n`);

	const edges = [0.9, 0.92, 0.94, 0.96, 0.98, 1.0001];
	console.log(
		"════════════════════════════════════════════════════════════════════════",
	);
	console.log("  BIN por P(perder) do MODELO");
	console.log(
		"════════════════════════════════════════════════════════════════════════",
	);
	console.log(
		"  bin            n    prev.modelo   REAL    erro   prev.mercado   odd méd   break-even",
	);
	for (let b = 0; b < edges.length - 1; b++) {
		const lo = edges[b];
		const hi = edges[b + 1];
		const inBin = obs.filter((o) => o.pModel >= lo && o.pModel < hi);
		if (inBin.length === 0) continue;
		const mean = (f: (o: Obs) => number) =>
			inBin.reduce((a, o) => a + f(o), 0) / inBin.length;
		const predM = mean((o) => o.pModel);
		const real = inBin.filter((o) => o.lost).length / inBin.length;
		const predMk = mean((o) => o.pMarket);
		const oddAvg = mean((o) => o.odd);
		const be = breakEven(oddAvg, COMMISSION_RATE);
		const err = (real - predM) * 100;
		console.log(
			`  ${lo.toFixed(2)}-${hi > 1 ? "1.00" : hi.toFixed(2)}  ${String(inBin.length).padStart(6)}      ${(predM * 100).toFixed(2)}%  ${(real * 100).toFixed(2)}%  ${err >= 0 ? "+" : ""}${err.toFixed(2)}pp       ${(predMk * 100).toFixed(2)}%    ${oddAvg.toFixed(1)}      ${(be * 100).toFixed(2)}%${real >= be ? "  ✅" : "  ❌"}`,
		);
	}
	console.log(
		"\n  erro = REAL − previsto. Negativo = modelo OTIMISTA (diz que perde mais",
	);
	console.log(
		"  do que perde) — é o erro caro no LAY. ✅/❌ = a taxa real bate o break-even.",
	);

	// Brier: quem estima melhor P(perder)?
	const bModel = brier(obs, (o) => o.pModel);
	const bMarket = brier(obs, (o) => o.pMarket);
	console.log(
		"\n════════════════════════════════════════════════════════════════════════",
	);
	console.log("  QUEM ESTIMA MELHOR P(perder)?  (Brier, menor é melhor)");
	console.log(
		"════════════════════════════════════════════════════════════════════════",
	);
	console.log(`  modelo:  ${bModel.toFixed(6)}`);
	console.log(`  mercado: ${bMarket.toFixed(6)}`);
	const d = bModel - bMarket;
	console.log(
		`  diferença (modelo − mercado): ${d >= 0 ? "+" : ""}${d.toFixed(6)}  ${d < 0 ? "→ modelo melhor" : "→ MERCADO melhor"}`,
	);

	model.model.dispose();
	console.log("\n✅ Concluído.");
	process.exit(0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
