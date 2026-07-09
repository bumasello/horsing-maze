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
