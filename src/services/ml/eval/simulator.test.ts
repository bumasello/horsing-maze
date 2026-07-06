// Testes das regras de simulação LAY — pegariam os 3 bugs históricos:
// odd média enviesada, PNL hardcoded, e agora a comissão.
import { describe, expect, it } from "vitest";
import {
	COMMISSION_RATE,
	type PickCandidate,
	STAKE,
	simulateRace,
} from "./simulator";

function pick(over: Partial<PickCandidate> = {}): PickCandidate {
	return {
		race_horse_id: 1,
		horse_id: 1,
		predicted_probability: 0.95,
		combined_score: 0.8,
		ivl_score: 0.01,
		market_odd: 15,
		non_runner: false,
		won_race: false,
		finish_position: 5,
		...over,
	};
}

describe("simulateRace — elegibilidade e cascata", () => {
	it("aposta no pick #1 quando elegível", () => {
		const r = simulateRace(1, "2026-07-01", [pick()], 200, 13, 20, true);
		expect(r.pickIndexUsed).toBe(0);
	});

	it("cai pro #2 quando #1 é non_runner", () => {
		const r = simulateRace(
			1,
			"2026-07-01",
			[pick({ non_runner: true }), pick({ race_horse_id: 2, horse_id: 2 })],
			200,
			13,
			20,
			true,
		);
		expect(r.pickIndexUsed).toBe(1);
	});

	it("cai pro #2 quando odd do #1 está fora do range", () => {
		const r = simulateRace(
			1,
			"2026-07-01",
			[pick({ market_odd: 26 }), pick({ race_horse_id: 2, horse_id: 2 })],
			200,
			13,
			20,
			true,
		);
		expect(r.pickIndexUsed).toBe(1);
	});

	it("skip (all_ineligible) quando nenhum pick apostável", () => {
		const r = simulateRace(
			1,
			"2026-07-01",
			[pick({ market_odd: 81 }), pick({ market_odd: 8 })],
			200,
			13,
			20,
			true,
		);
		expect(r.pickIndexUsed).toBeNull();
		expect(r.skipReason).toBe("all_ineligible");
		expect(r.pnl).toBe(0);
	});

	it("odd 0 (sem odd histórica) é inelegível", () => {
		const r = simulateRace(1, "2026-07-01", [pick({ market_odd: 0 })], 200, 13, 20, true);
		expect(r.skipReason).toBe("all_ineligible");
	});
});

describe("simulateRace — P/L com comissão e odd real", () => {
	it("win paga stake líquido de comissão", () => {
		const r = simulateRace(1, "2026-07-01", [pick()], 200, 13, 20, true);
		expect(r.pnl).toBeCloseTo(STAKE * (1 - COMMISSION_RATE), 10);
	});

	it("comissão default é 6,5% (Betfair BR)", () => {
		expect(COMMISSION_RATE).toBeCloseTo(0.065, 10);
	});

	it("loss real = -stake × (odd - 1), sem comissão", () => {
		const r = simulateRace(
			1,
			"2026-07-01",
			[pick({ won_race: true, market_odd: 15 })],
			200,
			13,
			20,
			true,
		);
		expect(r.pnl).toBeCloseTo(-STAKE * 14, 10);
	});

	it("modo legado usa -200 hardcoded na loss", () => {
		const r = simulateRace(
			1,
			"2026-07-01",
			[pick({ won_race: true, market_odd: 15 })],
			200,
			13,
			20,
			false,
		);
		expect(r.pnl).toBe(-200);
	});

	it("comissão 0 desativa (retro-compat)", () => {
		const r = simulateRace(1, "2026-07-01", [pick()], 200, 13, 20, true, 0);
		expect(r.pnl).toBe(STAKE);
	});

	it("banca atualiza e pode ficar negativa", () => {
		const r = simulateRace(
			1,
			"2026-07-01",
			[pick({ won_race: true, market_odd: 20 })],
			100,
			13,
			20,
			true,
		);
		expect(r.bankrollAfter).toBeCloseTo(100 - STAKE * 19, 10);
		expect(r.bankrollAfter).toBeLessThan(0);
	});
});
