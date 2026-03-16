// features_v4/converters/form.parser.ts

import type { ParsedForm } from "../types/core.types";
import { FormIndicator } from "../types/core.types";

const FORM_INDICATORS: Record<string, FormIndicator> = {
  F: FormIndicator.FELL,
  U: FormIndicator.UNSEATED,
  P: FormIndicator.PULLED_UP,
  R: FormIndicator.REFUSED,
  B: FormIndicator.BROUGHT_DOWN,
  C: FormIndicator.CARRIED_OUT,
  D: FormIndicator.DISQUALIFIED,
};

const FORM_SYMBOLS: Record<string, string> = {
  "-": "no_run",
  "/": "season_break",
  "0": "unplaced",
  L: "left",
  S: "slipped",
  O: "brought_down",
  T: "tailed_off",
  V: "void",
  W: "withdrawn",
};

export function parseForm(form: string | null): ParsedForm {
  const defaultForm: ParsedForm = {
    figures: [],
    indicators: [],
    recent_figures: [],
    avg_position: null,
    consistency_score: 0,
    is_improving: false,
    has_problems: false,
  };

  if (!form || form.length === 0) return defaultForm;

  const upperForm = form.toUpperCase().replace(/\s+/g, "");
  const figures: number[] = [];
  const indicators: string[] = [];
  const allPositions: number[] = [];
  const allFiguresInOrder: number[] = [];

  let i = 0;
  while (i < upperForm.length) {
    const char = upperForm[i];

    if (/[1-9]/.test(char)) {
      const position = Number.parseInt(char);
      figures.push(position);
      allPositions.push(position);
      allFiguresInOrder.push(position);
    } else if (char === "0") {
      figures.push(10);
      allPositions.push(10);
      allFiguresInOrder.push(10);
    } else if (FORM_INDICATORS[char]) {
      indicators.push(char);
      allPositions.push(99);
      allFiguresInOrder.push(99);
    } else if (FORM_SYMBOLS[char]) {
      const symbolMeaning = FORM_SYMBOLS[char];
      switch (symbolMeaning) {
        case "no_run":
        case "season_break":
          break;
        case "left":
        case "slipped":
        case "tailed_off":
        case "void":
        case "withdrawn":
          indicators.push(char);
          allPositions.push(99);
          allFiguresInOrder.push(99);
          break;
      }
    }
    i++;
  }

  const recent_figures = allFiguresInOrder.slice(-3);
  const metrics = calculateFormMetrics(allPositions, figures);
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

function calculateFormMetrics(
  allPositions: number[],
  validFigures: number[],
): {
  avg_position: number | null;
  consistency_score: number;
  is_improving: boolean;
} {
  if (allPositions.length === 0) {
    return { avg_position: null, consistency_score: 0, is_improving: false };
  }

  const avg_position =
    allPositions.reduce((a, b) => a + b, 0) / allPositions.length;

  let consistency_score = 0;
  if (validFigures.length > 1) {
    const validAvg =
      validFigures.reduce((a, b) => a + b, 0) / validFigures.length;
    const variance =
      validFigures.reduce((acc, val) => acc + Math.pow(val - validAvg, 2), 0) /
      validFigures.length;
    const stdDev = Math.sqrt(variance);
    consistency_score = Math.max(0, Math.min(1, 1 - stdDev / 5));
  }

  // FIX 1: comparar do mais recente para o mais antigo
  let is_improving = false;
  if (validFigures.length >= 4) {
    const recent = validFigures.slice(-2);
    const older = validFigures.slice(-4, -2);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    is_improving = recentAvg < olderAvg;
  } else if (validFigures.length >= 2) {
    const last = validFigures[validFigures.length - 1];
    const second = validFigures[validFigures.length - 2];
    is_improving = last < second;
  }

  return { avg_position, consistency_score, is_improving };
}

export function extractPatterns(form: ParsedForm): {
  consecutive_wins: number;
  consecutive_places: number;
  recent_fall: boolean;
  never_won: boolean;
  always_placed: boolean;
} {
  // FIX 2: iterar do mais recente para o mais antigo
  const reversed = [...form.figures].reverse();

  let consecutive_wins = 0;
  for (const fig of reversed) {
    if (fig === 1) consecutive_wins++;
    else break;
  }

  let consecutive_places = 0;
  for (const fig of reversed) {
    if (fig <= 3) consecutive_places++;
    else break;
  }

  const recent_fall = form.indicators.some(
    (ind) =>
      ind === FormIndicator.FELL ||
      ind === FormIndicator.UNSEATED ||
      ind === FormIndicator.BROUGHT_DOWN,
  );

  const never_won = !form.figures.includes(1);
  const always_placed =
    form.figures.length > 0 && form.figures.every((f) => f <= 3);

  return {
    consecutive_wins,
    consecutive_places,
    recent_fall,
    never_won,
    always_placed,
  };
}

export function calculateFormRating(form: ParsedForm): number {
  if (form.figures.length === 0) return 0;

  let rating = 50;

  if (form.avg_position !== null) {
    rating += (10 - Math.min(10, form.avg_position)) * 3;
  }

  rating += form.consistency_score * 20;

  if (form.is_improving) rating += 10;
  if (form.has_problems) rating -= 15;

  if (form.recent_figures.length > 0) {
    const recentAvg =
      form.recent_figures.reduce((a, b) => a + b, 0) /
      form.recent_figures.length;
    if (recentAvg <= 3) rating += 10;
    if (recentAvg <= 2) rating += 5;
  }

  return Math.max(0, Math.min(100, rating));
}

export function parseFormWithMetadata(
  formString: string,
  formMetadata?: string,
): {
  form: ParsedForm;
  lastWinDistance?: number;
  lastWinDaysAgo?: number;
  lastWinGoing?: string;
} {
  const form = parseForm(formString);

  let lastWinDistance: number | undefined;
  let lastWinDaysAgo: number | undefined;
  let lastWinGoing: string | undefined;

  if (formMetadata) {
    // FIX 4: lastIndexOf para pegar a vitória mais recente
    const winIndex = form.figures.lastIndexOf(1);
    if (winIndex !== -1) {
      const metadataParts = formMetadata.split(",");
      if (metadataParts[winIndex]) {
        const parts = metadataParts[winIndex].split("-");
        if (parts.length >= 4) {
          lastWinDistance = Number.parseInt(parts[1]);
          lastWinDaysAgo = Number.parseInt(parts[2]);
          lastWinGoing = parts[3];
        }
      }
    }
  }

  return { form, lastWinDistance, lastWinDaysAgo, lastWinGoing };
}

export function compareForm(form1: ParsedForm, form2: ParsedForm): number {
  return calculateFormRating(form1) - calculateFormRating(form2);
}

export function getFormTrend(
  form: ParsedForm,
): "improving" | "declining" | "stable" | "unknown" {
  if (form.figures.length < 3) return "unknown";

  // FIX 3: janelas a partir do mais recente
  const recent = form.figures.slice(-2);
  const middle = form.figures.slice(-3, -1);
  const older = form.figures.slice(-4, -2);

  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const middleAvg = middle.reduce((a, b) => a + b, 0) / middle.length;
  const olderAvg =
    older.length > 0
      ? older.reduce((a, b) => a + b, 0) / older.length
      : middleAvg;

  if (recentAvg < middleAvg && middleAvg < olderAvg) return "improving";
  if (recentAvg > middleAvg && middleAvg > olderAvg) return "declining";
  return "stable";
}

export function getLastWinClass(
  form: ParsedForm,
  raceClasses?: number[],
): number | null {
  if (!raceClasses || raceClasses.length !== form.figures.length) return null;
  const winIndex = form.figures.lastIndexOf(1); // consistência com FIX 4
  if (winIndex === -1) return null;
  return raceClasses[winIndex];
}

export function calculateDaysSinceLastRun(
  form: ParsedForm,
  raceDates?: Date[],
  referenceDate: Date = new Date(), // ← aceita data de referência, default hoje
): number | null {
  if (!raceDates || raceDates.length === 0) return null;
  if (form.figures.length === 0) return null;

  const lastRaceDate = raceDates[raceDates.length - 1]; // mais recente = último
  const diffTime = Math.abs(referenceDate.getTime() - lastRaceDate.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function isProvenAtClass(
  form: ParsedForm,
  currentClass: number,
  historicalClasses: number[],
): boolean {
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

export function formatForm(form: ParsedForm): string {
  let result = "";
  for (let i = 0; i < form.figures.length; i++) {
    result += form.figures[i] === 10 ? "0" : form.figures[i].toString();
  }
  if (form.indicators.length > 0) {
    result += form.indicators.join("");
  }
  return result || "-";
}

export const FormParser = {
  parseForm,
  extractPatterns,
  calculateFormRating,
  parseFormWithMetadata,
  compareForm,
  getFormTrend,
  getLastWinClass,
  calculateDaysSinceLastRun,
  isProvenAtClass,
  formatForm,
};
