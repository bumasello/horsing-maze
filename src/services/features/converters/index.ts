// features_v4/converters/index.ts

import {
  parseDistanceBeaten,
  parseDistanceToMeters,
} from "./distance.converter";
import { parseForm } from "./form.parser";
import { encodeGoing } from "./going.converter"; // ← fonte única
import { parseSP } from "./odds.converter";
import { parseToKg } from "./weight.converter";

// Re-export everything from each module
export * from "./distance.converter";
export * from "./form.parser";
export * from "./going.converter";
export * from "./odds.converter";
export * from "./run_style.converter";
export * from "./weight.converter";

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
