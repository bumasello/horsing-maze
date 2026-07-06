import { describe, expect, it } from "vitest";
import { applyIsotonic, fitIsotonic } from "./calibration";

describe("isotonic (PAV)", () => {
	it("curva é monótona não-decrescente", () => {
		const pairs = Array.from({ length: 200 }, (_, i) => ({
			p: i / 200,
			y: Math.random() < i / 200 ? 1 : 0,
		}));
		const curve = fitIsotonic(pairs.map(({ p, y }) => ({ x: p, y })));
		for (let i = 1; i < curve.y.length; i++) {
			expect(curve.y[i]).toBeGreaterThanOrEqual(curve.y[i - 1]);
		}
	});

	it("applyIsotonic interpola dentro do range", () => {
		const curve = { x: [0, 0.5, 1], y: [0.1, 0.5, 0.9] };
		expect(applyIsotonic(curve, 0.25)).toBeCloseTo(0.3, 10);
		expect(applyIsotonic(curve, 0.5)).toBeCloseTo(0.5, 10);
	});

	it("applyIsotonic clampa fora do range", () => {
		const curve = { x: [0.2, 0.8], y: [0.3, 0.7] };
		expect(applyIsotonic(curve, 0)).toBeCloseTo(0.3, 10);
		expect(applyIsotonic(curve, 1)).toBeCloseTo(0.7, 10);
	});
});
