// DIAGNÓSTICO DECISIVO DEV-ONLY: as features carregam informação ALÉM do preço?
//
// Teste de encompassing (Benter, estágio 2). Ajusta por máxima verossimilhança
// três logits condicionais por corrida:
//
//   M0 (só mercado)  : z_i = β·ln(q_i)
//   M1 (só modelo)   : z_i = α·s_i
//   M2 (ambos)       : z_i = α·s_i + β·ln(q_i)
//
// onde s_i = score cru do modelo FUNDAMENTAL (treinado SEM features de mercado)
// e q_i = probabilidade implícita do preço, normalizada na corrida.
//
// A pergunta não é "quanto vale α" — a magnitude de α depende da escala dos
// logits e não é interpretável isolada. A pergunta é se M2 AJUSTA MELHOR QUE M0:
// se acrescentar o modelo ao preço não melhora nada, o modelo não tem informação
// própria, e nenhuma loss/arquitetura conserta isso.
//
//   • teste da razão de verossimilhança M2 vs M0: 2·N·(CE_M0 − CE_M2) ~ χ²(1)
//   • CE fora da amostra: o juiz final — melhora em janela não usada no fit
//
// ⚠️ O modelo fundamental foi treinado com dados que incluem estas janelas, o
// que INFLA a contribuição dele. Um resultado nulo aqui é conclusivo; um
// resultado positivo é só permissivo.
//
// Uso: nvm use 20 && NO_CRON=1 PORT=3985 npx ts-node \
//      src/oneTimeScript/benter_alpha_probe.ts
// Env: FIT_DAYS (221), FIT_END (360), HELD_DAYS (180), HELD_END (180),
//      FUNDAMENTAL_PATH

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import {
	type HorseRecord,
	loadModelFromPath,
	loadPeriodData,
	predictRaceScores,
} from "../services/ml/eval/harness";

const FIT_DAYS = Number(process.env.FIT_DAYS || 221);
const FIT_END = Number(process.env.FIT_END || 360);
const HELD_DAYS = Number(process.env.HELD_DAYS || 180);
const HELD_END = Number(process.env.HELD_END || 180);
// GROUP=Flat|Jump — escolhe o baseline sem mercado e os race_types correspondentes
const GROUP = (process.env.GROUP || "Flat").trim();
const GROUP_CFG: Record<string, { mtype: "flat" | "jump"; types: string[] }> = {
	Flat: { mtype: "flat", types: ["Flat"] },
	Jump: { mtype: "jump", types: ["Hurdle", "Chase", "NHF"] },
};
const CFG = GROUP_CFG[GROUP];
if (!CFG) throw new Error(`GROUP inválido: ${GROUP} (use Flat ou Jump)`);
const FUNDAMENTAL_PATH = (
	process.env.FUNDAMENTAL_PATH ||
	`horse_probability_model/baselines/no_market_${CFG.mtype}`
).trim();

/** Uma corrida pronta pro logit condicional. */
interface Race {
	s: number[]; // score do modelo fundamental
	lq: number[]; // ln(prob implícita normalizada)
	w: number; // índice do vencedor
}

function buildRaces(
	raceMap: Map<number, HorseRecord[]>,
	fundamental: Awaited<ReturnType<typeof loadModelFromPath>>,
): Race[] {
	const out: Race[] = [];
	for (const [, horses] of raceMap) {
		const scores = predictRaceScores(horses, fundamental);
		const valid: Array<{ s: number; odd: number; won: boolean }> = [];
		for (let i = 0; i < horses.length; i++) {
			const s = scores[i];
			if (s === null || !Number.isFinite(s)) continue;
			if (!(horses[i].market_odd > 1)) continue;
			valid.push({
				s,
				odd: horses[i].market_odd,
				won: horses[i].finish_position === 1,
			});
		}
		if (valid.length < 3) continue;
		const w = valid.findIndex((v) => v.won);
		if (w < 0) continue; // sem vencedor identificável
		const raw = valid.map((v) => 1 / v.odd);
		const sum = raw.reduce((a, b) => a + b, 0);
		out.push({
			s: valid.map((v) => v.s),
			lq: raw.map((r) => Math.log(r / sum)),
			w,
		});
	}
	return out;
}

/** CE média por corrida com os parâmetros dados. */
function crossEntropy(races: Race[], alpha: number, beta: number): number {
	let total = 0;
	for (const r of races) {
		let max = Number.NEGATIVE_INFINITY;
		const z = new Array(r.s.length);
		for (let i = 0; i < r.s.length; i++) {
			z[i] = alpha * r.s[i] + beta * r.lq[i];
			if (z[i] > max) max = z[i];
		}
		let sumExp = 0;
		for (let i = 0; i < z.length; i++) sumExp += Math.exp(z[i] - max);
		total += -(z[r.w] - max - Math.log(sumExp));
	}
	return total / races.length;
}

/**
 * Ajuste por Newton-Raphson (2 parâmetros, log-verossimilhança côncava).
 * freeAlpha/freeBeta permitem fixar um dos termos em zero (modelos aninhados).
 */
function fit(
	races: Race[],
	freeAlpha: boolean,
	freeBeta: boolean,
): { alpha: number; beta: number; ce: number } {
	let alpha = freeAlpha ? 0.5 : 0;
	let beta = freeBeta ? 1 : 0;

	for (let iter = 0; iter < 60; iter++) {
		let gA = 0,
			gB = 0,
			hAA = 0,
			hAB = 0,
			hBB = 0;
		for (const r of races) {
			const n = r.s.length;
			let max = Number.NEGATIVE_INFINITY;
			const z = new Array(n);
			for (let i = 0; i < n; i++) {
				z[i] = alpha * r.s[i] + beta * r.lq[i];
				if (z[i] > max) max = z[i];
			}
			let sumExp = 0;
			for (let i = 0; i < n; i++) sumExp += Math.exp(z[i] - max);
			// médias e (co)variâncias sob a distribuição p
			let eS = 0,
				eL = 0,
				eSS = 0,
				eSL = 0,
				eLL = 0;
			for (let i = 0; i < n; i++) {
				const p = Math.exp(z[i] - max) / sumExp;
				eS += p * r.s[i];
				eL += p * r.lq[i];
				eSS += p * r.s[i] * r.s[i];
				eSL += p * r.s[i] * r.lq[i];
				eLL += p * r.lq[i] * r.lq[i];
			}
			// gradiente da CE (negativo do score da log-verossimilhança)
			gA += -(r.s[r.w] - eS);
			gB += -(r.lq[r.w] - eL);
			hAA += eSS - eS * eS;
			hAB += eSL - eS * eL;
			hBB += eLL - eL * eL;
		}
		const N = races.length;
		gA /= N;
		gB /= N;
		hAA /= N;
		hAB /= N;
		hBB /= N;
		if (!freeAlpha) {
			gA = 0;
			hAB = 0;
			hAA = 1;
		}
		if (!freeBeta) {
			gB = 0;
			hAB = 0;
			hBB = 1;
		}
		const det = hAA * hBB - hAB * hAB;
		if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
		const dA = (hBB * gA - hAB * gB) / det;
		const dB = (hAA * gB - hAB * gA) / det;
		if (freeAlpha) alpha -= dA;
		if (freeBeta) beta -= dB;
		if (Math.abs(dA) < 1e-10 && Math.abs(dB) < 1e-10) break;
	}
	return { alpha, beta, ce: crossEntropy(races, alpha, beta) };
}

/** p-valor da cauda superior de uma qui-quadrado com 1 grau de liberdade. */
function chi2SfDf1(x: number): number {
	if (x <= 0) return 1;
	// P(χ²₁ > x) = erfc(sqrt(x/2))
	const z = Math.sqrt(x / 2);
	// Abramowitz & Stegun 7.1.26 para erfc
	const t = 1 / (1 + 0.3275911 * z);
	const y =
		t *
		(0.254829592 +
			t *
				(-0.284496736 +
					t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
	return y * Math.exp(-z * z);
}

async function main(): Promise<void> {
	console.log(
		"🔬 Sonda de encompassing — o modelo acrescenta algo ao preço? (DEV-ONLY)\n",
	);
	console.log(
		`📋 grupo: ${GROUP} (${CFG.types.join("+")}) | fundamental: ${FUNDAMENTAL_PATH}`,
	);
	console.log(
		`📋 fit: [${FIT_DAYS + FIT_END}, ${FIT_END}) dias | held-out: [${HELD_DAYS + HELD_END}, ${HELD_END}) dias`,
	);
	console.log(
		"📋 ⚠️  janelas dentro do treino do fundamental → INFLAM a contribuição dele\n",
	);
	await mongoose.connect(process.env.MONGOOSE as string);

	const fundamental = await loadModelFromPath(FUNDAMENTAL_PATH, CFG.mtype);

	const fitRaces = buildRaces(
		await loadPeriodData(CFG.types, FIT_DAYS, FIT_END),
		fundamental,
	);
	const heldRaces = buildRaces(
		await loadPeriodData(CFG.types, HELD_DAYS, HELD_END),
		fundamental,
	);
	console.log(
		`🏁 corridas utilizáveis — fit: ${fitRaces.length} | held-out: ${heldRaces.length}\n`,
	);
	if (fitRaces.length < 200) throw new Error("amostra de fit insuficiente");

	const m0 = fit(fitRaces, false, true); // só mercado
	const m1 = fit(fitRaces, true, false); // só modelo
	const m2 = fit(fitRaces, true, true); // ambos

	console.log("═".repeat(72));
	console.log("  AJUSTE (CE média por corrida — menor é melhor)");
	console.log("═".repeat(72));
	console.log(
		`  ${"modelo".padEnd(22)} ${"alpha".padStart(9)} ${"beta".padStart(9)} ${"CE fit".padStart(9)} ${"CE held".padStart(9)}`,
	);
	for (const [name, m] of [
		["M0  só mercado", m0],
		["M1  só modelo", m1],
		["M2  ambos", m2],
	] as Array<[string, typeof m0]>) {
		const held = crossEntropy(heldRaces, m.alpha, m.beta);
		console.log(
			`  ${name.padEnd(22)} ${m.alpha.toFixed(4).padStart(9)} ${m.beta.toFixed(4).padStart(9)} ${m.ce.toFixed(4).padStart(9)} ${held.toFixed(4).padStart(9)}`,
		);
	}

	// Razão de verossimilhança M2 vs M0 (aninhados, 1 grau de liberdade)
	const lr = 2 * fitRaces.length * (m0.ce - m2.ce);
	const p = chi2SfDf1(lr);
	const heldM0 = crossEntropy(heldRaces, m0.alpha, m0.beta);
	const heldM2 = crossEntropy(heldRaces, m2.alpha, m2.beta);

	// IC95 do ganho FORA da amostra por bootstrap sobre corridas. É o número que
	// decide: o LR in-sample já se mostrou enganoso no Flat (p=0.0175 com ganho
	// out-of-sample negativo).
	const gains: number[] = [];
	for (let k = 0; k < 2000; k++) {
		const sample: Race[] = new Array(heldRaces.length);
		for (let i = 0; i < heldRaces.length; i++)
			sample[i] = heldRaces[(Math.random() * heldRaces.length) | 0];
		gains.push(
			crossEntropy(sample, m0.alpha, m0.beta) -
				crossEntropy(sample, m2.alpha, m2.beta),
		);
	}
	gains.sort((a, b) => a - b);
	const gLo = gains[Math.floor(0.025 * gains.length)];
	const gHi = gains[Math.floor(0.975 * gains.length)];

	console.log(`\n${"═".repeat(72)}`);
	console.log("  VEREDICTO");
	console.log("═".repeat(72));
	console.log(
		`  ganho de CE no fit (M0→M2): ${(m0.ce - m2.ce).toFixed(5)} nats/corrida`,
	);
	console.log(
		`  razão de verossimilhança: LR=${lr.toFixed(2)}  p=${p < 1e-6 ? "<1e-6" : p.toExponential(2)}`,
	);
	console.log(
		`  ganho de CE FORA da amostra: ${(heldM0 - heldM2).toFixed(5)} nats/corrida`,
	);
	console.log(
		`  IC95 do ganho fora da amostra: [${gLo.toFixed(5)}, ${gHi.toFixed(5)}]`,
	);
	// Referência de escala: quanto o próprio mercado contribui sobre o uniforme
	const avgField =
		heldRaces.reduce((a, r) => a + r.s.length, 0) / heldRaces.length;
	const marketGain = Math.log(avgField) - heldM0;
	console.log(
		`  (mercado contribui ${marketGain.toFixed(4)} nats sobre o uniforme, campo médio ${avgField.toFixed(1)})`,
	);
	console.log("");
	if (heldM0 - heldM2 <= 0)
		console.log(
			"  ❌ O modelo NÃO melhora a previsão fora da amostra. Sem informação além do preço.",
		);
	else if (gLo <= 0)
		console.log(
			"  ⚠️  Ganho fora da amostra POSITIVO mas com IC95 cruzando zero — não é distinguível de ruído.",
		);
	else
		console.log(
			`  ✅ Ganho fora da amostra significativo — mas é ${(((heldM0 - heldM2) / marketGain) * 100).toFixed(2)}% do que o mercado entrega.`,
		);

	fundamental.model.dispose();
	await mongoose.disconnect();
	console.log("\n✅ Concluído.");
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("❌ Falha:", e);
		process.exit(1);
	});
