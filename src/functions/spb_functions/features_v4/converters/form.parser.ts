// features_v4/converters/form.parser.ts

import { ParsedForm, FormIndicator } from "../types/core.types";

export class FormParser {
  // Form indicators mapping
  private static readonly FORM_INDICATORS: Record<string, FormIndicator> = {
    F: FormIndicator.FELL,
    U: FormIndicator.UNSEATED,
    P: FormIndicator.PULLED_UP,
    R: FormIndicator.REFUSED,
    B: FormIndicator.BROUGHT_DOWN,
    C: FormIndicator.CARRIED_OUT,
    D: FormIndicator.DISQUALIFIED,
  };

  // Additional form symbols
  private static readonly FORM_SYMBOLS: Record<string, string> = {
    "-": "no_run", // Gap in form/no recent runs
    "/": "season_break", // Season or year separator
    "0": "unplaced", // Finished outside places (10th or worse)
    L: "left", // Left at start
    S: "slipped", // Slipped up
    O: "brought_down", // Brought down (alternative)
    T: "tailed_off", // Tailed off
    V: "void", // Void race
    W: "withdrawn", // Withdrawn
  };

  /**
   * Parse complete form string
   */
  static parseForm(form: string | null): ParsedForm {
    const defaultForm: ParsedForm = {
      figures: [],
      indicators: [],
      recent_figures: [],
      avg_position: null,
      consistency_score: 0,
      is_improving: false,
      has_problems: false,
    };

    if (!form || form.length === 0) {
      return defaultForm;
    }

    const upperForm = form.toUpperCase().replace(/\s+/g, "");
    const figures: number[] = [];
    const indicators: string[] = [];
    const allPositions: number[] = [];

    // Parse each character
    let i = 0;
    while (i < upperForm.length) {
      const char = upperForm[i];

      // Check for position (1-9)
      if (/[1-9]/.test(char)) {
        const position = parseInt(char);
        figures.push(position);
        allPositions.push(position);
      }
      // Check for 0 (unplaced - treat as position 10+)
      else if (char === "0") {
        figures.push(10);
        allPositions.push(10);
      }
      // Check for form indicators
      else if (this.FORM_INDICATORS[char]) {
        indicators.push(char);
        // Add a poor position for fell/unseated/etc
        allPositions.push(99);
      }
      // Check for dash (no recent run)
      else if (char === "-") {
        // Skip - represents gap in form
      }
      // Check for slash (season separator)
      else if (char === "/") {
        // Could use to separate seasons if needed
      }

      i++;
    }

    // Get recent figures (most recent first in the string)
    const recent_figures = figures.slice(0, 3);

    // Calculate metrics
    const metrics = this.calculateFormMetrics(allPositions, figures);

    // Check for problems
    const has_problems =
      indicators.length > 0 || allPositions.some((p) => p > 10);

    return {
      figures,
      indicators,
      recent_figures,
      avg_position: metrics.avg_position,
      consistency_score: metrics.consistency_score,
      is_improving: metrics.is_improving,
      has_problems,
    };
  }

  /**
   * Calculate form metrics
   */
  private static calculateFormMetrics(
    allPositions: number[],
    validFigures: number[],
  ): {
    avg_position: number | null;
    consistency_score: number;
    is_improving: boolean;
  } {
    if (allPositions.length === 0) {
      return {
        avg_position: null,
        consistency_score: 0,
        is_improving: false,
      };
    }

    // Calculate average position
    const avg_position =
      allPositions.reduce((a, b) => a + b, 0) / allPositions.length;

    // Calculate consistency (normalized standard deviation)
    let consistency_score = 0;
    if (validFigures.length > 1) {
      const validAvg =
        validFigures.reduce((a, b) => a + b, 0) / validFigures.length;
      const variance =
        validFigures.reduce(
          (acc, val) => acc + Math.pow(val - validAvg, 2),
          0,
        ) / validFigures.length;
      const stdDev = Math.sqrt(variance);

      // Normalize (assume max std dev of 5 for positions 1-10)
      consistency_score = Math.max(0, Math.min(1, 1 - stdDev / 5));
    }

    // Check if improving (compare recent to older)
    let is_improving = false;
    if (validFigures.length >= 4) {
      const recent = validFigures.slice(0, 2);
      const older = validFigures.slice(2, 4);

      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

      is_improving = recentAvg < olderAvg;
    } else if (validFigures.length >= 2) {
      // Simple check: is most recent better than second most recent?
      is_improving = validFigures[0] < validFigures[1];
    }

    return {
      avg_position,
      consistency_score,
      is_improving,
    };
  }

  /**
   * Extract specific form patterns
   */
  static extractPatterns(form: ParsedForm): {
    consecutive_wins: number;
    consecutive_places: number;
    recent_fall: boolean;
    never_won: boolean;
    always_placed: boolean;
  } {
    const figures = form.figures;

    // Count consecutive wins
    let consecutive_wins = 0;
    for (const fig of figures) {
      if (fig === 1) consecutive_wins++;
      else break;
    }

    // Count consecutive places (top 3)
    let consecutive_places = 0;
    for (const fig of figures) {
      if (fig <= 3) consecutive_places++;
      else break;
    }

    // Check for recent fall/unseated
    const recent_fall = form.indicators.some(
      (ind) =>
        ind === FormIndicator.FELL ||
        ind === FormIndicator.UNSEATED ||
        ind === FormIndicator.BROUGHT_DOWN,
    );

    // Check if never won
    const never_won = !figures.includes(1);

    // Check if always placed when finished
    const always_placed = figures.length > 0 && figures.every((f) => f <= 3);

    return {
      consecutive_wins,
      consecutive_places,
      recent_fall,
      never_won,
      always_placed,
    };
  }

  /**
   * Calculate form rating (0-100)
   */
  static calculateFormRating(form: ParsedForm): number {
    if (form.figures.length === 0) return 0;

    let rating = 50; // Base rating

    // Adjust for average position
    if (form.avg_position !== null) {
      // Better positions increase rating
      rating += (10 - Math.min(10, form.avg_position)) * 3;
    }

    // Adjust for consistency
    rating += form.consistency_score * 20;

    // Bonus for improving
    if (form.is_improving) rating += 10;

    // Penalty for problems
    if (form.has_problems) rating -= 15;

    // Bonus for recent good positions
    if (form.recent_figures.length > 0) {
      const recentAvg =
        form.recent_figures.reduce((a, b) => a + b, 0) /
        form.recent_figures.length;
      if (recentAvg <= 3) rating += 10;
      if (recentAvg <= 2) rating += 5;
    }

    return Math.max(0, Math.min(100, rating));
  }

  /**
   * Get last winning distance from form string with metadata
   */
  static parseFormWithMetadata(
    formString: string,
    formMetadata?: string,
  ): {
    form: ParsedForm;
    lastWinDistance?: number;
    lastWinDaysAgo?: number;
    lastWinGoing?: string;
  } {
    const form = this.parseForm(formString);

    // Parse metadata if provided (format varies by data source)
    // This is a placeholder for actual metadata parsing
    return {
      form,
      lastWinDistance: undefined,
      lastWinDaysAgo: undefined,
      lastWinGoing: undefined,
    };
  }

  /**
   * Compare two form strings
   */
  static compareForm(form1: ParsedForm, form2: ParsedForm): number {
    // Returns: positive if form1 is better, negative if form2 is better

    const rating1 = this.calculateFormRating(form1);
    const rating2 = this.calculateFormRating(form2);

    return rating1 - rating2;
  }

  /**
   * Get form trend
   */
  static getFormTrend(
    form: ParsedForm,
  ): "improving" | "declining" | "stable" | "unknown" {
    if (form.figures.length < 3) return "unknown";

    // Calculate moving averages
    const recent = form.figures.slice(0, 2);
    const middle = form.figures.slice(1, 3);
    const older = form.figures.slice(2, 4);

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const middleAvg = middle.reduce((a, b) => a + b, 0) / middle.length;
    const olderAvg =
      older.length > 0
        ? older.reduce((a, b) => a + b, 0) / older.length
        : middleAvg;

    // Check trend
    if (recentAvg < middleAvg && middleAvg < olderAvg) {
      return "improving";
    } else if (recentAvg > middleAvg && middleAvg > olderAvg) {
      return "declining";
    } else {
      return "stable";
    }
  }

  /**
   * Get class of last win
   */
  static getLastWinClass(
    form: ParsedForm,
    raceClasses?: number[],
  ): number | null {
    if (!raceClasses || raceClasses.length !== form.figures.length) {
      return null;
    }

    const winIndex = form.figures.indexOf(1);
    if (winIndex === -1) return null;

    return raceClasses[winIndex];
  }

  /**
   * Calculate days since last run
   */
  static calculateDaysSinceLastRun(
    form: ParsedForm,
    raceDates?: Date[],
  ): number | null {
    if (!raceDates || raceDates.length === 0) return null;

    const today = new Date();
    const lastRaceDate = raceDates[0];
    const diffTime = Math.abs(today.getTime() - lastRaceDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  }

  /**
   * Check if horse is proven at class
   */
  static isProvenAtClass(
    form: ParsedForm,
    currentClass: number,
    historicalClasses: number[],
  ): boolean {
    // Check if horse has won or placed at this class level
    for (
      let i = 0;
      i < form.figures.length && i < historicalClasses.length;
      i++
    ) {
      if (historicalClasses[i] >= currentClass && form.figures[i] <= 3) {
        return true;
      }
    }
    return false;
  }

  /**
   * Format form for display
   */
  static formatForm(form: ParsedForm): string {
    let result = "";

    // Combine figures and indicators in order
    for (let i = 0; i < form.figures.length; i++) {
      if (form.figures[i] === 10) {
        result += "0";
      } else {
        result += form.figures[i].toString();
      }
    }

    // Add indicators at the end
    if (form.indicators.length > 0) {
      result += form.indicators.join("");
    }

    return result || "-";
  }
}
