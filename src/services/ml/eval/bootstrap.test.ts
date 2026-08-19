// Testes do bootstrap usado pelo staging gate (Ticket 4).
// O ponto central: distinguir "IC95 cruza zero" de "IC95 exclui zero" —
// é a diferença entre promover por ruído e promover por evidência.
import { describe, expect, it } from "vitest";
import {
	bootstrapRisk,
	maxDrawdownOf,
	pairedRoiBootstrap,
	roiOf,
} from "./bootstrap";
import type { SimResult } from "./simulator";

// RNG determinístico (mulberry32) pra teste não ficar flaky.
function seeded(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function race(raceId: number, pnl: number, bet = true): SimResult {
	return {
		raceId,
		raceDate: "2026-01-01",
		pickIndexUsed: bet ? 0 : null,
		skipReason: bet ? null : "no_eligible_pick",
		chosenHorseId: bet ? raceId : null,
		chosenOdd: bet ? 15 : null,
		chosenPredictedProbability: bet ? 0.95 : null,
		chosenIvlScore: bet ? 0.01 : null,
		chosenWonRace: bet ? pnl < 0 : null,
		pnl,
		bankrollBefore: 200,
		bankrollAfter: 200 + pnl,
	} as SimResult;
}

const STAKE = 10;

describe("roiOf", () => {
	it("divide pnl pelo nº de apostas × stake, ignorando corridas sem aposta", () => {
		const r = [race(1, 10), race(2, 10), race(3, 0, false)];
		// 20 de pnl / (2 apostas * 10) = 1.0
		expect(roiOf(r, STAKE)).toBeCloseTo(1.0, 10);
	});

	it("retorna 0 quando não houve aposta", () => {
		expect(roiOf([race(1, 0, false)], STAKE)).toBe(0);
	});
});

describe("maxDrawdownOf", () => {
	it("mede a maior queda desde o pico, não a perda final", () => {
		// acc: 10, 20, -170, -160 → pico 20, vale -170 → dd 190
		const r = [race(1, 10), race(2, 10), race(3, -190), race(4, 10)];
		expect(maxDrawdownOf(r)).toBe(190);
	});

	it("é zero numa sequência monotonicamente crescente", () => {
		expect(maxDrawdownOf([race(1, 10), race(2, 10)])).toBe(0);
	});
});

describe("bootstrapRisk", () => {
	it("IC95 do ROI EXCLUI zero quando todas as corridas ganham", () => {
		const r = Array.from({ length: 200 }, (_, i) => race(i, 10));
		const out = bootstrapRisk(r, STAKE, 500, seeded(1));
		expect(out.roi.lo95).toBeGreaterThan(0);
		expect(out.nRaces).toBe(200);
	});

	it("IC95 do ROI CRUZA zero numa amostra ruidosa de média ~0", () => {
		// 19 ganhos de +10 pra cada perda de -190 → EV exatamente 0
		const r = Array.from({ length: 200 }, (_, i) =>
			race(i, i % 20 === 0 ? -190 : 10),
		);
		const out = bootstrapRisk(r, STAKE, 500, seeded(2));
		expect(out.roi.lo95).toBeLessThan(0);
		expect(out.roi.hi95).toBeGreaterThan(0);
	});

	it("drawdown do IC é ≥ 0 e cresce com perdas", () => {
		const flat = bootstrapRisk(
			Array.from({ length: 100 }, (_, i) => race(i, 10)),
			STAKE,
			200,
			seeded(3),
		);
		const noisy = bootstrapRisk(
			Array.from({ length: 100 }, (_, i) => race(i, i % 20 === 0 ? -190 : 10)),
			STAKE,
			200,
			seeded(3),
		);
		expect(flat.maxDrawdown.mean).toBe(0);
		expect(noisy.maxDrawdown.mean).toBeGreaterThan(0);
	});

	it("não quebra com lista vazia", () => {
		const out = bootstrapRisk([], STAKE, 100, seeded(4));
		expect(out.nRaces).toBe(0);
		expect(out.roi.lo95).toBe(0);
	});
});

describe("pairedRoiBootstrap", () => {
	it("IC95 do diff EXCLUI zero quando A ganha em toda corrida pareada", () => {
		const a = Array.from({ length: 200 }, (_, i) => race(i, 10));
		const b = Array.from({ length: 200 }, (_, i) => race(i, -190));
		const out = pairedRoiBootstrap(a, b, STAKE, 500, seeded(5));
		expect(out.roiDiff.lo95).toBeGreaterThan(0);
		expect(out.nRaces).toBe(200);
	});

	it("IC95 do diff CRUZA zero quando A e B são estatisticamente iguais", () => {
		// mesmas corridas, resultados alternando quem ganha — diff médio 0
		const a = Array.from({ length: 200 }, (_, i) =>
			race(i, i % 2 === 0 ? 10 : -190),
		);
		const b = Array.from({ length: 200 }, (_, i) =>
			race(i, i % 2 === 0 ? -190 : 10),
		);
		const out = pairedRoiBootstrap(a, b, STAKE, 500, seeded(6));
		expect(out.roiDiff.lo95).toBeLessThan(0);
		expect(out.roiDiff.hi95).toBeGreaterThan(0);
	});

	it("pareia só corridas presentes nos dois lados", () => {
		const a = [race(1, 10), race(2, 10), race(3, 10)];
		const b = [race(1, 10), race(2, 10)];
		const out = pairedRoiBootstrap(a, b, STAKE, 50, seeded(7));
		expect(out.nRaces).toBe(2);
	});

	it("diff é exatamente zero quando A e B são idênticos", () => {
		const a = Array.from({ length: 50 }, (_, i) =>
			race(i, i % 3 === 0 ? -190 : 10),
		);
		const out = pairedRoiBootstrap(a, a, STAKE, 100, seeded(8));
		expect(out.roiDiff.lo95).toBe(0);
		expect(out.roiDiff.hi95).toBe(0);
	});
});
