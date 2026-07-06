import { describe, expect, it } from "vitest";
import { type ModelSummary, summarize } from "./report";
import type { SimResult } from "./simulator";

function bet(pnl: number, won: boolean, odd = 15, date = "2026-07-01"): SimResult {
	return {
		raceId: 1,
		raceDate: date,
		pickIndexUsed: 0,
		skipReason: null,
		chosenHorseId: 1,
		chosenOdd: odd,
		chosenPredictedProbability: 0.95,
		chosenIvlScore: 0.01,
		chosenWonRace: won,
		pnl,
		bankrollBefore: 0,
		bankrollAfter: 0,
	};
}

describe("summarize", () => {
	it("break-even inclui comissão 6,5% na odd 20 (95.31%)", () => {
		const s: ModelSummary = summarize("t", [bet(9.35, false)], 200);
		// 190 / (190 + 10×0.935) = 0.95309...
		expect(s.breakEvenWinRate).toBeCloseTo(190 / 199.35, 6);
	});

	it("win rate conta cavalo que NÃO venceu como win", () => {
		const s = summarize("t", [bet(9.35, false), bet(-140, true)], 200);
		expect(s.winRate).toBeCloseTo(0.5, 10);
		expect(s.betsPlaced).toBe(2);
	});

	it("edge = winRate − breakEven", () => {
		const s = summarize("t", [bet(9.35, false)], 200);
		expect(s.edge).toBeCloseTo(1 - s.breakEvenWinRate, 10);
	});

	it("drawdown máximo pico→vale", () => {
		// +9.35, +9.35, -140: pico 18.7, vale -121.3 → DD 140
		const s = summarize(
			"t",
			[bet(9.35, false), bet(9.35, false), bet(-140, true)],
			200,
		);
		expect(s.maxDrawdown).toBeCloseTo(140, 10);
	});

	it("ruína detectada quando banca cruza zero", () => {
		const s = summarize("t", [bet(-250, true)], 200);
		expect(s.ruinCount).toBe(1);
		expect(s.firstRuinAt).toBe(0);
	});

	it("pnl total e banca final", () => {
		const s = summarize("t", [bet(9.35, false), bet(-140, true)], 200);
		expect(s.totalPnl).toBeCloseTo(-130.65, 10);
		expect(s.bankrollFinal).toBeCloseTo(69.35, 10);
	});
});
