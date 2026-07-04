// Experimento DEV-ONLY: blend Benter de 2 estágios (Flat).
// NÃO promove nada pra prod — só treina o estágio 2 e compara ROI simulado
// contra o prod atual (v68/mt_b05) no MESMO harness do staging gate.
//
// Estágio 1 (fundamental): baseline `no_market` (67 feat SEM mercado),
//   já treinado na Fase 1 do debug plan (baselines/no_market_flat).
// Estágio 2 (blend): conditional logit de 2 parâmetros por corrida:
//   score_i = alpha * s_i + beta * ln(q_i)
//   onde s_i = logit cru do modelo fundamental e q_i = prob implícita de
//   mercado normalizada na corrida (1/odd, sem overround).
//   alpha/beta ajustados por MLE (CE do vencedor) na janela FIT [180d, 90d),
//   avaliação na janela EVAL [90d, hoje) — janelas disjuntas, sem leak do fit.
//
// Referências: Benter (1994); estudo 2-step +17,53% vs +0,96% OOS — ver
// docs/pesquisa_mercado_lay_2026-07-04.md §2.
//
// Uso: nvm use 20 && PORT=3999 npx ts-node src/oneTimeScript/benter_blend_flat.ts
// Env: FIT_DAYS (90), EVAL_DAYS (90), FUNDAMENTAL_PATH (baselines/no_market_flat)

import dotenv from "dotenv";
dotenv.config();

import * as tf from "@tensorflow/tfjs-node";
import mongoose from "mongoose";
import {
	BANKROLL_INITIAL,
	type HorseRecord,
	type LoadedModel,
	evaluateModel,
	evaluateWithPredictor,
	loadModelFromPath,
	loadPeriodData,
	predictRaceScores,
	scoresToPLose,
} from "../services/ml/eval/harness";
import { printConsoleTable } from "../services/ml/eval/report";
import { COMMISSION_RATE } from "../services/ml/eval/simulator";

const FIT_DAYS = Number(process.env.FIT_DAYS || 90);
const EVAL_DAYS = Number(process.env.EVAL_DAYS || 90);
const FUNDAMENTAL_PATH = (
	process.env.FUNDAMENTAL_PATH ||
	"horse_probability_model/baselines/no_market_flat"
).trim();
const PROD_PATH = "horse_probability_model/claude-ml-model-flat";

// ============================================================================
// PREPARO DOS DADOS DO BLEND
// ============================================================================

interface BlendRace {
	// arrays alinhados, só cavalos válidos (score fundamental + odd > 1)
	fundamentalScores: number[];
	logMarketProbs: number[]; // ln(q_i) com q normalizado na corrida
	winnerIdx: number; // índice do vencedor dentro dos válidos; -1 se inválido
}

function buildBlendRace(
	horses: HorseRecord[],
	fundamental: LoadedModel,
): BlendRace | null {
	const scores = predictRaceScores(horses, fundamental);
	const valid: { s: number; odd: number; won: boolean }[] = [];
	for (let i = 0; i < horses.length; i++) {
		const s = scores[i];
		if (s === null) continue;
		if (horses[i].market_odd <= 1) continue; // sem odd → fora do blend
		valid.push({
			s,
			odd: horses[i].market_odd,
			won: horses[i].finish_position === 1,
		});
	}
	if (valid.length < 3) return null;

	// Prob implícita normalizada na corrida (remove overround)
	const raw = valid.map((v) => 1 / v.odd);
	const sum = raw.reduce((a, b) => a + b, 0);
	const q = raw.map((r) => r / sum);

	return {
		fundamentalScores: valid.map((v) => v.s),
		logMarketProbs: q.map((p) => Math.log(p)),
		winnerIdx: valid.findIndex((v) => v.won),
	};
}

// ============================================================================
// FIT DO ESTÁGIO 2 (conditional logit MLE, 2 parâmetros)
// ============================================================================

function fitBlend(races: BlendRace[]): { alpha: number; beta: number } {
	const usable = races.filter((r) => r.winnerIdx >= 0);
	console.log(
		`  🔧 Fit em ${usable.length} corridas (${races.length - usable.length} sem vencedor válido descartadas)`,
	);

	const alpha = tf.variable(tf.scalar(1.0));
	const beta = tf.variable(tf.scalar(1.0));
	const optimizer = tf.train.adam(0.05);

	// Tensores por corrida (campos ragged — mantém simples, N pequeno)
	const tensors = usable.map((r) => ({
		s: tf.tensor1d(r.fundamentalScores),
		lq: tf.tensor1d(r.logMarketProbs),
		w: r.winnerIdx,
	}));

	const lossFn = (): tf.Scalar =>
		tf.tidy(() => {
			let total = tf.scalar(0);
			for (const t of tensors) {
				const scores = t.s.mul(alpha).add(t.lq.mul(beta));
				const logProbs = tf.logSoftmax(scores) as tf.Tensor1D;
				const winnerLogProb = logProbs.slice(t.w, 1).squeeze();
				total = total.add(winnerLogProb.neg()) as tf.Scalar;
			}
			return total.div(tensors.length) as tf.Scalar;
		});

	let lastLoss = Number.NaN;
	for (let step = 0; step < 300; step++) {
		optimizer.minimize(lossFn, false, [alpha, beta]);
		if (step % 50 === 0 || step === 299) {
			lastLoss = lossFn().dataSync()[0];
			console.log(
				`  step ${step.toString().padStart(3)}: CE=${lastLoss.toFixed(4)} alpha=${alpha.dataSync()[0].toFixed(4)} beta=${beta.dataSync()[0].toFixed(4)}`,
			);
		}
	}

	const result = {
		alpha: alpha.dataSync()[0],
		beta: beta.dataSync()[0],
	};
	for (const t of tensors) {
		t.s.dispose();
		t.lq.dispose();
	}
	alpha.dispose();
	beta.dispose();
	return result;
}

// ============================================================================
// PREDIÇÃO BLENDADA (pro harness de simulação)
// ============================================================================

function makeBlendPredictor(
	fundamental: LoadedModel,
	alpha: number,
	beta: number,
): (horses: HorseRecord[]) => number[] {
	return (horses: HorseRecord[]): number[] => {
		const scores = predictRaceScores(horses, fundamental);

		// Recompõe q_i (normalizado) só sobre cavalos com score E odd válidos
		const validIdx: number[] = [];
		for (let i = 0; i < horses.length; i++) {
			if (scores[i] !== null && horses[i].market_odd > 1) validIdx.push(i);
		}
		const blended: (number | null)[] = new Array(horses.length).fill(null);
		if (validIdx.length === 0) return scoresToPLose(blended, 1);

		const raw = validIdx.map((i) => 1 / horses[i].market_odd);
		const sum = raw.reduce((a, b) => a + b, 0);
		for (let k = 0; k < validIdx.length; k++) {
			const i = validIdx[k];
			const s = scores[i];
			if (s === null) continue;
			blended[i] = alpha * s + beta * Math.log(raw[k] / sum);
		}
		// Temperatura 1: o alpha/beta já calibram a escala dos logits
		return scoresToPLose(blended, 1);
	};
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
	console.log("🧪 Blend Benter 2 estágios — Flat (DEV-ONLY, não toca prod)\n");
	console.log(
		`📋 FIT=[${FIT_DAYS + EVAL_DAYS}d,${EVAL_DAYS}d) EVAL=[${EVAL_DAYS}d,0) | fundamental=${FUNDAMENTAL_PATH} | comissão=${(COMMISSION_RATE * 100).toFixed(1)}%\n`,
	);

	console.log("🔌 Conectando MongoDB...");
	await mongoose.connect(process.env.MONGOOSE as string);

	console.log("📥 Carregando modelos...");
	const fundamental = await loadModelFromPath(FUNDAMENTAL_PATH, "flat");
	console.log(
		`  ✅ fundamental: v${fundamental.config.version}, ${fundamental.config.features.length} feat`,
	);
	const prod = await loadModelFromPath(PROD_PATH, "flat");
	console.log(
		`  ✅ prod: v${prod.config.version}, ${prod.config.features.length} feat`,
	);

	console.log(
		`\n📥 Janela FIT [hoje-${FIT_DAYS + EVAL_DAYS}d, hoje-${EVAL_DAYS}d)...`,
	);
	const fitMap = await loadPeriodData(["Flat"], FIT_DAYS, EVAL_DAYS);
	console.log(`  🏁 ${fitMap.size} corridas de fit`);

	console.log("\n🔧 Ajustando estágio 2 (alpha·s + beta·ln(q))...");
	const blendRaces: ReturnType<typeof buildBlendRace>[] = [];
	for (const horses of fitMap.values()) {
		blendRaces.push(buildBlendRace(horses, fundamental));
	}
	const validBlendRaces = blendRaces.filter(
		(r): r is NonNullable<typeof r> => r !== null,
	);
	const { alpha, beta } = fitBlend(validBlendRaces);
	console.log(
		`\n  🎯 Blend fitado: alpha=${alpha.toFixed(4)} beta=${beta.toFixed(4)}`,
	);
	console.log(
		"     (beta >> alpha·spread indica dominância do mercado; alpha significativo = fundamental agrega)",
	);

	console.log(`\n📥 Janela EVAL [hoje-${EVAL_DAYS}d, hoje)...`);
	const evalMap = await loadPeriodData(["Flat"], EVAL_DAYS, 0);
	console.log(`  🏁 ${evalMap.size} corridas de eval`);

	console.log("\n📊 Simulando na janela EVAL (regras de prod + comissão):");

	console.log("  1/3 benter_blend...");
	const blendSummary = evaluateWithPredictor(
		"benter_blend",
		evalMap,
		makeBlendPredictor(fundamental, alpha, beta),
	);
	console.log("  2/3 no_market puro (estágio 1 sozinho)...");
	const fundamentalSummary = evaluateModel("no_market", fundamental, evalMap);
	console.log("  3/3 prod v68 (mt_b05)...");
	const prodSummary = evaluateModel("prod_v68", prod, evalMap);

	printConsoleTable([blendSummary, fundamentalSummary, prodSummary]);

	console.log("\n📌 Leitura:");
	const diff = (blendSummary.edge - prodSummary.edge) * 100;
	console.log(
		`   edge blend − edge prod = ${diff >= 0 ? "+" : ""}${diff.toFixed(2)}pp na janela EVAL`,
	);
	console.log(
		"   ⚠️ Janela EVAL é ~in-sample pro prod (mt_b05 treinado até ~07-03) e",
	);
	console.log(
		"   OOS pro blend (fit em janela anterior disjunta) — comparação CONSERVADORA pro blend.",
	);

	fundamental.model.dispose();
	prod.model.dispose();
	await mongoose.disconnect();
	console.log("\n✅ Concluído.");
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
