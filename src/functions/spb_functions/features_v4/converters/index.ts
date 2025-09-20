// features_v4/converters/index.ts

// Import specific functions we need
import {
  parseDistanceBeaten,
  parseDistanceToMeters,
} from "./distance.converter";
import { parseForm } from "./form.parser";
import { parseSP } from "./odds.converter";
import { parseToKg } from "./weight.converter";

// Re-export everything from each module
export * from "./distance.converter";
export * from "./form.parser";
export * from "./odds.converter";
export * from "./weight.converter";

/**
 * Helper to encode going conditions
 */
export function encodeGoing(going: string | null): number {
  if (!going) return 4; // Default to 'good'

  const goingMap: Record<string, number> = {
    hard: 1,
    fast: 2,
    firm: 3,
    good: 4,
    "good to firm": 5,
    "good to yielding": 6,
    "yielding to soft": 7,
    yielding: 8,
    "good to soft": 9,
    "standard to slow": 10,
    standard: 11,
    "soft heavy": 12,
    heavy: 13,
    soft: 14,
  };

  const normalized = going.toLowerCase().trim();
  return goingMap[normalized] || 4; // Default to 'good'
}

/**
 * Helper to parse prize money
 */
export function parsePrize(prize: string | null): number {
  if (!prize) return 0;
  const clean = prize.replace(/[£$€,]/g, "").trim();
  const num = Number.parseFloat(clean);
  return Number.isNaN(num) ? 0 : num;
}

/**
 * Convert all race data at once
 */
export function convertRaceData(data: {
  distance?: string;
  going?: string;
  prize?: string;
}) {
  return {
    distance_meters: data.distance
      ? parseDistanceToMeters(data.distance)
      : null,
    going_encoded: data.going ? encodeGoing(data.going) : null,
    prize_numeric: data.prize ? parsePrize(data.prize) : null,
  };
}

/**
 * Convert all horse data at once
 */
export function convertHorseData(data: {
  weight?: string | null;
  sp?: string | null;
  form?: string | null;
  distance_beaten?: string | null;
}) {
  return {
    weight_kg: data.weight ? parseToKg(data.weight) : null,
    sp_decimal: data.sp ? parseSP(data.sp) : null,
    form_parsed: data.form ? parseForm(data.form) : null,
    beaten_lengths: data.distance_beaten
      ? parseDistanceBeaten(data.distance_beaten)
      : 0,
  };
}
