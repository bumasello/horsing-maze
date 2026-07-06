import { describe, expect, it } from "vitest";
import {
	calculateOverround,
	decimalToImpliedProbability,
	fractionalToDecimal,
} from "./odds.converter";

describe("fractionalToDecimal", () => {
	it("frações padrão", () => {
		expect(fractionalToDecimal("5/1")).toBe(6);
		expect(fractionalToDecimal("7/2")).toBe(4.5);
		expect(fractionalToDecimal("13/8")).toBeCloseTo(2.625, 10);
	});

	it("evens e odds-on", () => {
		expect(fractionalToDecimal("EVS")).toBe(2);
		expect(fractionalToDecimal("2/1 ON")).toBe(1.5);
	});

	it("casos inválidos → null", () => {
		expect(fractionalToDecimal(null)).toBeNull();
		expect(fractionalToDecimal("FAV")).toBeNull();
		expect(fractionalToDecimal("abc")).toBeNull();
	});
});

describe("probabilidade implícita e overround", () => {
	it("odd 20 → 5%", () => {
		expect(decimalToImpliedProbability(20)).toBeCloseTo(0.05, 10);
	});

	it("overround = margem sobre 1 (mercado justo → 0)", () => {
		expect(calculateOverround([2, 2])).toBeCloseTo(0, 10);
		expect(calculateOverround([1.8, 1.8])).toBeCloseTo(2 / 1.8 - 1, 10);
	});
});
