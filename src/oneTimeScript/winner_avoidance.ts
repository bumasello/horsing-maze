// Sonda de EVITAÇÃO DO VENCEDOR (DEV-ONLY, não escreve nada).
//
// Pergunta: o modelo evita o vencedor melhor do que o próprio preço evita?
//
// Motivação: o encompassing test mede informação sobre a distribuição INTEIRA
// (cross-entropy). A estratégia LAY não depende disso — depende da cauda
// direita: manter o vencedor FORA da lista de 3. São perguntas diferentes, e
// o CLAUDE.md já registra que val_top1 é proxy ruim pro trabalho real.
//
// Esta sonda não precisa de BSP: compara ranking contra desfecho, não simula
// aposta. Por isso roda mesmo com os CSVs da Betfair bloqueados.
//
// Comparação primária, SEM parâmetro livre (não há o que tunar, logo não há
// seleção de ruído): winner-inclusion do top-3 do MODELO (combined_score, como
// prod) vs top-3 do MERCADO (as 3 maiores odds = 3 maiores P(perder) implícitas).
//
// Secundário, descritivo: curva do veto "Guarda-Costas" — banir do lay quem
// tiver P(win) do modelo acima de um limiar, e ver quantos "reds" isso evita
// versus quantas corridas custa.
//
// Uso: NO_CRON=1 PORT=3996 GROUP=Flat npx ts-node src/oneTimeScript/winner_avoidance.ts
// Env: GROUP (Flat|Jump), DAYS (180), END (0), B (2000)

import mongoose from "mongoose";
import {
	MAX_ODD_THRESHOLD,
	MIN_ODD_THRESHOLD,
	calculateCombinedScore,
	calculateLayValueIndex,
} from "../services/ml/claude-generate-picks";
import {
	type HorseRecord,
	loadModelFromPath,
	loadPeriodData,
	predictRace,
} from "../services/ml/eval/harness";
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
const B = Number(process.env.B || 2000);
// BAND=1 (default): restringe os dois lados à banda negociável [13,20].
// BAND=0: comparação irrestrita — CONFUNDIDA por nível de odd, só diagnóstica.
const BAND = (process.env.BAND || "1").trim() !== "0";

// Por corrida: o vencedor caiu na lista de 3 do modelo? e na do mercado?
interface RaceOutcome {
	inModel: boolean;
	inMarket: boolean;
	winnerPWin: number | null; // P(win) do modelo pro vencedor real
	modelTop3PWin: number[]; // P(win) dos 3 escolhidos pelo modelo
}

function pct(sorted: number[], p: number): number {
	const i = Math.min(
		sorted.length - 1,
		Math.max(0, Math.floor(p * sorted.length)),
	);
	return sorted[i];
}

function main() {
	return (async () => {
		console.log(
			"\n🎯 Sonda de evitação do vencedor — modelo vs preço (DEV-ONLY)\n",
		);
		console.log(
			`📋 grupo: ${GROUP} | janela: [${DAYS + END}, ${END}) dias | B=${B}`,
		);
		console.log(
			BAND
				? `📋 universo: banda [${MIN_ODD_THRESHOLD}, ${MAX_ODD_THRESHOLD}] pros DOIS lados (comparação justa)`
				: "📋 universo: IRRESTRITO — ⚠️ confundido por nível de odd, só diagnóstico",
		);
		console.log(
			"📋 sem BSP: compara ranking contra desfecho, não simula aposta\n",
		);

		await mongoose.connect(process.env.MONGOOSE as string);
		const model = await loadModelFromPath(
			modelPath(`horse_probability_model/claude-ml-model-${G.mtype}`),
			G.mtype,
		);
		const raceMap = await loadPeriodData(G.types, DAYS, END);
		console.log(`🏁 corridas carregadas: ${raceMap.size}\n`);

		const outcomes: RaceOutcome[] = [];

		for (const [, horses] of raceMap) {
			if (horses.length < 4) continue; // top-3 de 3 cavalos é a corrida toda
			const winnerIdx = horses.findIndex(
				(h: HorseRecord) => h.finish_position === 1,
			);
			if (winnerIdx < 0) continue;

			const pLose = predictRace(horses, model);
			if (pLose[winnerIdx] < 0) continue;

			// --- lista do MODELO: combined_score, idêntico a prod ---
			let modelRanked = horses
				.map((h: HorseRecord, i: number) => {
					if (pLose[i] < 0) return null;
					const ivl = calculateLayValueIndex(pLose[i], h.market_odd);
					return {
						i,
						score: calculateCombinedScore(pLose[i], ivl, h.market_odd),
						pWin: 1 - pLose[i],
					};
				})
				.filter((x): x is { i: number; score: number; pWin: number } => !!x)
				.sort((a, b) => b.score - a.score);

			// --- lista do MERCADO ---
			// ⚠️ Sem restrição de banda a comparação é CONFUNDIDA: "3 maiores
			// odds" pega azarão de odd 40-80 (que quase nunca vence), enquanto
			// o combined_score puxa pra [13,20] via odd_range_score. O mercado
			// ganharia por nível de odd, não por skill de ranking.
			// BAND=1 (default) restringe OS DOIS LADOS ao universo negociável,
			// isolando a pergunta: dentro da banda, o modelo rankeia melhor
			// que o preço?
			const inBand = (odd: number) =>
				odd >= MIN_ODD_THRESHOLD && odd <= MAX_ODD_THRESHOLD;
			const pool = horses
				.map((h: HorseRecord, i: number) => ({ i, odd: h.market_odd }))
				.filter((x) => x.odd > 1 && (!BAND || inBand(x.odd)));
			const marketRanked = [...pool].sort((a, b) => b.odd - a.odd).slice(0, 3);

			if (BAND) {
				// modelo também só pode escolher dentro da banda
				const allowed = new Set(pool.map((x) => x.i));
				modelRanked = modelRanked.filter((x) => allowed.has(x.i));
			}

			modelRanked = modelRanked.slice(0, 3);
			if (modelRanked.length < 3 || marketRanked.length < 3) continue;

			outcomes.push({
				inModel: modelRanked.some((x) => x.i === winnerIdx),
				inMarket: marketRanked.some((x) => x.i === winnerIdx),
				winnerPWin: 1 - pLose[winnerIdx],
				modelTop3PWin: modelRanked.map((x) => x.pWin),
			});
		}

		const n = outcomes.length;
		if (n === 0) {
			console.log("❌ nenhuma corrida utilizável.");
			process.exit(1);
		}

		const modelHits = outcomes.filter((o) => o.inModel).length;
		const marketHits = outcomes.filter((o) => o.inMarket).length;

		console.log(
			"════════════════════════════════════════════════════════════════",
		);
		console.log("  PRIMÁRIO — o vencedor caiu na lista de 3? (menor é melhor)");
		console.log(
			"════════════════════════════════════════════════════════════════",
		);
		console.log(`  corridas avaliadas: ${n}`);
		console.log(
			`  MODELO  (combined_score): ${modelHits} (${((modelHits / n) * 100).toFixed(2)}%)`,
		);
		console.log(
			`  MERCADO (maiores odds no universo): ${marketHits} (${((marketHits / n) * 100).toFixed(2)}%)`,
		);
		const diffPp = ((modelHits - marketHits) / n) * 100;
		console.log(
			`  diferença (modelo − mercado): ${diffPp >= 0 ? "+" : ""}${diffPp.toFixed(2)}pp  (negativo = modelo evita melhor)`,
		);

		// bootstrap pareado por corrida da diferença
		const diffs: number[] = [];
		for (let b = 0; b < B; b++) {
			let dm = 0;
			for (let k = 0; k < n; k++) {
				const o = outcomes[Math.floor(Math.random() * n)];
				dm += (o.inModel ? 1 : 0) - (o.inMarket ? 1 : 0);
			}
			diffs.push((dm / n) * 100);
		}
		diffs.sort((a, b) => a - b);
		const lo = pct(diffs, 0.025);
		const hi = pct(diffs, 0.975);
		console.log(
			`  IC95 da diferença (bootstrap pareado, B=${B}): [${lo.toFixed(2)}pp, ${hi.toFixed(2)}pp]`,
		);
		if (hi < 0) {
			console.log(
				"\n  ✅ o modelo evita o vencedor MELHOR que o preço, com significância.",
			);
		} else if (lo > 0) {
			console.log(
				"\n  ❌ o modelo evita o vencedor PIOR que o preço, com significância.",
			);
		} else {
			console.log("\n  ⚠️  indistinguível do preço — o IC95 cruza zero.");
		}

		// --- SECUNDÁRIO: curva do veto "Guarda-Costas" (descritivo) ---
		console.log(
			"\n════════════════════════════════════════════════════════════════",
		);
		console.log(
			'  SECUNDÁRIO — veto "Guarda-Costas" (DESCRITIVO, não decisório)',
		);
		console.log(
			"════════════════════════════════════════════════════════════════",
		);
		console.log(
			"  Banir do lay quem tem P(win) do modelo > limiar. Um veto que",
		);
		console.log(
			"  derruba a lista abaixo de 3 cavalos inviabiliza a corrida.\n",
		);
		console.log("  limiar   reds evitados   corridas perdidas   red restante");
		for (const th of [0.05, 0.1, 0.15, 0.2, 0.25, 0.3]) {
			let stillRed = 0;
			let lostRace = 0;
			let avoided = 0;
			for (const o of outcomes) {
				const survivors = o.modelTop3PWin.filter((p) => p <= th).length;
				const raceDead = survivors < 3;
				if (raceDead) lostRace++;
				if (o.inModel) {
					// o vencedor estava na lista; o veto o remove se P(win) > limiar
					if ((o.winnerPWin ?? 0) > th || raceDead) avoided++;
					else stillRed++;
				}
			}
			console.log(
				`  ${th.toFixed(2)}     ${String(avoided).padStart(6)} (${((avoided / Math.max(modelHits, 1)) * 100).toFixed(0)}%)      ${String(lostRace).padStart(6)} (${((lostRace / n) * 100).toFixed(0)}%)        ${String(stillRed).padStart(6)}`,
			);
		}
		console.log(
			"\n  ⚠️  Escolher limiar OLHANDO esta tabela é seleção de ruído — foi",
		);
		console.log(
			"     o que produziu os falsos positivos do histórico. A tabela serve",
		);
		console.log("     pra ver o TRADE-OFF, não pra escolher um valor.");

		model.model.dispose();
		console.log("\n✅ Concluído.");
		process.exit(0);
	})();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
