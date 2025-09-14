// features_v4/converters/index.ts

export { DistanceConverter, DistanceUtils } from "./distance.converter";
export { FormParser } from "./form.parser";
export { OddsConverter } from "./odds.converter";
export { WeightConverter } from "./weight.converter";

// Re-export commonly used functions for convenience
export {
  DistanceConverter as Distance,
  FormParser as Form,
  OddsConverter as Odds,
  WeightConverter as Weight,
};

// Aggregate converter class for convenience
export class Converters {
  static readonly Distance = DistanceConverter;
  static readonly Odds = OddsConverter;
  static readonly Weight = WeightConverter;
  static readonly Form = FormParser;

  /**
   * Convert all race data at once
   */
  static convertRaceData(data: {
    distance?: string;
    going?: string;
    prize?: string;
  }) {
    return {
      distance_meters: data.distance
        ? DistanceConverter.parseToMeters(data.distance)
        : null,
      going_encoded: data.going ? this.encodeGoing(data.going) : null,
      prize_numeric: data.prize ? this.parsePrize(data.prize) : null,
    };
  }

  /**
   * Convert all horse data at once
   */
  static convertHorseData(data: {
    weight?: string | null;
    sp?: string | null;
    form?: string | null;
    distance_beaten?: string | null;
  }) {
    return {
      weight_kg: data.weight ? WeightConverter.parseToKg(data.weight) : null,
      sp_decimal: data.sp ? OddsConverter.parseSP(data.sp) : null,
      form_parsed: data.form ? FormParser.parseForm(data.form) : null,
      beaten_lengths: data.distance_beaten
        ? DistanceConverter.parseDistanceBeaten(data.distance_beaten)
        : 0,
    };
  }

  /**
   * Helper to encode going conditions
   */
  private static encodeGoing(going: string): number {
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
  private static parsePrize(prize: string): number {
    const clean = prize.replace(/[£$€,]/g, "").trim();
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  }
}
