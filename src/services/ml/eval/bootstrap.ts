// Bootstrap de significância pros evals (backlog: temos decidido em cima de
// diferenças de 0.2-0.4pp de edge que podem ser ruído).
//
// - bootstrapSummary: IC95 de edge/pnl de UMA config (resample de corridas
//   com reposição — cluster bootstrap no nível corrida, que é a unidade
//   independente; apostas dentro da corrida são correlacionadas).
// - pairedBootstrap: comparação PAREADA A vs B nas MESMAS corridas —
//   resample dos DIFFS por corrida. Muito mais poder estatístico que
//   comparar ICs marginais.

import type { SimResult } from "./simulator";

export interface BootstrapCI {
	mean: number;
	lo95: number;
	hi95: number;
}

export interface PairedBootstrapResult {
	pnlDiff: BootstrapCI; // total A − B
	winRateDiffPp: BootstrapCI; // em pontos percentuais
	// fração dos resamples em que A ≤ B (unicaudal; ~p-value de "A melhor")
	pWorseOrEqual: number;
	nRaces: number;
}

function pct(sorted: number[], p: number): number {
	const i = Math.min(
		sorted.length - 1,
		Math.max(0, Math.floor(p * sorted.length)),
	);
	return sorted[i];
}

function ci(samples: number[]): BootstrapCI {
	const s = [...samples].sort((a, b) => a - b);
	return {
		mean: s.reduce((a, b) => a + b, 0) / s.length,
		lo95: pct(s, 0.025),
		hi95: pct(s, 0.975),
	};
}

/** IC95 de pnl total e win rate (pp) via resample de corridas. */
export function bootstrapSummary(
	results: SimResult[],
	B = 2000,
	seedFn: () => number = Math.random,
): { pnl: BootstrapCI; winRatePp: BootstrapCI } {
	const n = results.length;
	const pnls: number[] = [];
	const wrs: number[] = [];
	for (let b = 0; b < B; b++) {
		let pnl = 0;
		let bets = 0;
		let wins = 0;
		for (let k = 0; k < n; k++) {
			const r = results[Math.floor(seedFn() * n)];
			pnl += r.pnl;
			if (r.pickIndexUsed !== null) {
				bets++;
				if (r.chosenWonRace === false) wins++;
			}
		}
		pnls.push(pnl);
		wrs.push(bets > 0 ? (wins / bets) * 100 : 0);
	}
	return { pnl: ci(pnls), winRatePp: ci(wrs) };
}

/**
 * Bootstrap pareado A vs B: resultados das MESMAS corridas (alinhados por
 * raceId). Corridas sem aposta em ambas contribuem diff 0.
 */
export function pairedBootstrap(
	resultsA: SimResult[],
	resultsB: SimResult[],
	B = 2000,
	seedFn: () => number = Math.random,
): PairedBootstrapResult {
	const byRaceB = new Map(resultsB.map((r) => [r.raceId, r]));
	// pares alinhados: [pnlDiff, betA(0/1), winA(0/1), betB, winB]
	const pairs: Array<[number, number, number, number, number]> = [];
	for (const a of resultsA) {
		const b = byRaceB.get(a.raceId);
		if (!b) continue;
		pairs.push([
			a.pnl - b.pnl,
			a.pickIndexUsed !== null ? 1 : 0,
			a.chosenWonRace === false ? 1 : 0,
			b.pickIndexUsed !== null ? 1 : 0,
			b.chosenWonRace === false ? 1 : 0,
		]);
	}
	const n = pairs.length;
	const pnlDiffs: number[] = [];
	const wrDiffs: number[] = [];
	let worse = 0;
	for (let bIdx = 0; bIdx < B; bIdx++) {
		let dPnl = 0;
		let betsA = 0;
		let winsA = 0;
		let betsB = 0;
		let winsB = 0;
		for (let k = 0; k < n; k++) {
			const p = pairs[Math.floor(seedFn() * n)];
			dPnl += p[0];
			betsA += p[1];
			winsA += p[2];
			betsB += p[3];
			winsB += p[4];
		}
		pnlDiffs.push(dPnl);
		const wrA = betsA > 0 ? (winsA / betsA) * 100 : 0;
		const wrB = betsB > 0 ? (winsB / betsB) * 100 : 0;
		wrDiffs.push(wrA - wrB);
		if (dPnl <= 0) worse++;
	}
	return {
		pnlDiff: ci(pnlDiffs),
		winRateDiffPp: ci(wrDiffs),
		pWorseOrEqual: worse / B,
		nRaces: n,
	};
}

// ============================================================================
// ROI E DRAWDOWN — adicionados 2026-08-19 pro staging gate (Ticket 4)
// ============================================================================

/**
 * ROI por aposta de um conjunto de corridas simuladas.
 * ROI = pnl_total / (nº apostas × stake). Corridas sem aposta não entram no
 * denominador. Retorna 0 se não houve aposta (neutro, não lucrativo).
 */
export function roiOf(results: SimResult[], stake: number): number {
	let pnl = 0;
	let bets = 0;
	for (const r of results) {
		pnl += r.pnl;
		if (r.pickIndexUsed !== null) bets++;
	}
	return bets > 0 ? pnl / (bets * stake) : 0;
}

/**
 * Max drawdown de uma sequência de corridas, em unidades de banca.
 * Percorre na ordem dada acumulando pnl e medindo a maior queda desde o pico.
 */
export function maxDrawdownOf(results: SimResult[]): number {
	let acc = 0;
	let peak = 0;
	let maxDd = 0;
	for (const r of results) {
		acc += r.pnl;
		if (acc > peak) peak = acc;
		const dd = peak - acc;
		if (dd > maxDd) maxDd = dd;
	}
	return maxDd;
}

export interface RiskBootstrapResult {
	roi: BootstrapCI; // ROI por aposta (fração, não %)
	maxDrawdown: BootstrapCI; // em unidades de banca
	nRaces: number;
}

/**
 * IC95 de ROI e de max drawdown de UMA config, via cluster bootstrap por
 * corrida. O drawdown é medido sobre a sequência reamostrada — reflete a
 * distribuição de trajetórias plausíveis, não só a que aconteceu.
 */
export function bootstrapRisk(
	results: SimResult[],
	stake: number,
	B = 2000,
	seedFn: () => number = Math.random,
): RiskBootstrapResult {
	const n = results.length;
	const rois: number[] = [];
	const dds: number[] = [];
	if (n === 0) {
		const zero: BootstrapCI = { mean: 0, lo95: 0, hi95: 0 };
		return { roi: zero, maxDrawdown: zero, nRaces: 0 };
	}
	for (let b = 0; b < B; b++) {
		const sample: SimResult[] = new Array(n);
		for (let k = 0; k < n; k++) {
			sample[k] = results[Math.floor(seedFn() * n)];
		}
		rois.push(roiOf(sample, stake));
		dds.push(maxDrawdownOf(sample));
	}
	return { roi: ci(rois), maxDrawdown: ci(dds), nRaces: n };
}

/**
 * Diferença PAREADA de ROI entre A e B nas mesmas corridas.
 * Complementa pairedBootstrap (que devolve pnl e win rate) com a métrica que
 * o gate usa pra decidir. Corridas ausentes em B são ignoradas.
 */
export function pairedRoiBootstrap(
	resultsA: SimResult[],
	resultsB: SimResult[],
	stake: number,
	B = 2000,
	seedFn: () => number = Math.random,
): { roiDiff: BootstrapCI; nRaces: number } {
	const byRaceB = new Map(resultsB.map((r) => [r.raceId, r]));
	const pairs: Array<[SimResult, SimResult]> = [];
	for (const a of resultsA) {
		const b = byRaceB.get(a.raceId);
		if (b) pairs.push([a, b]);
	}
	const n = pairs.length;
	if (n === 0) return { roiDiff: { mean: 0, lo95: 0, hi95: 0 }, nRaces: 0 };
	const diffs: number[] = [];
	for (let bIdx = 0; bIdx < B; bIdx++) {
		const sampleA: SimResult[] = new Array(n);
		const sampleB: SimResult[] = new Array(n);
		for (let k = 0; k < n; k++) {
			const p = pairs[Math.floor(seedFn() * n)];
			sampleA[k] = p[0];
			sampleB[k] = p[1];
		}
		diffs.push(roiOf(sampleA, stake) - roiOf(sampleB, stake));
	}
	return { roiDiff: ci(diffs), nRaces: n };
}
