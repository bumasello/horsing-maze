// services/features/features/pace.features.ts
//
// Features de pace/run-style derivadas do histórico do rpscrape (hml.rpscrape_results).
//
// Pra cada cavalo: distribuição dos run-styles nas últimas N corridas + flags
// comportamentais + ratings RPR/TS recentes.
// Pra cada corrida: agregados do field (pace pressure, lone speed).
// Interação: pace_match_score = combinação style do cavalo × field state.
//
// Referência (Tier 1 #3 do roadmap): Bolton-Chapman 1986, Benter 1994, Brisnet
// run-style figures, Inform Racing "Run-Style Figures".

import {
  parseRunStyle,
  type RunStyleCode,
} from "../converters/run_style.converter";

// Número de corridas históricas consideradas pra "recent" — sweet spot
// empírico do tier list original (run_style = argmax dos últimos 5).
export const PACE_HISTORY_WINDOW = 5;

/**
 * Entrada por linha histórica do cavalo: o que precisamos do rpscrape_results
 * pra derivar pace features. Já vem JOINado com race_horses_hr_enriched.
 */
export interface PaceHistoryEntry {
  race_date: string; // ISO
  comment: string | null;
  rpr_rating: number | null;
  ts_rating: number | null;
  ovr_btn: number | null;
}

export interface HorsePaceFeatures {
  // Distribuição de styles nos últimos N (sums to ≤1 ; resto é U/missing)
  pace_E_pct_recent: number;
  pace_EP_pct_recent: number;
  pace_P_pct_recent: number;
  pace_S_pct_recent: number;

  // Dominant style: code mais frequente (encoded 1=E, 2=EP, 3=P, 4=S, 0=U/none)
  pace_dominant_style_code: number;
  pace_consistency: number; // % das últimas que tiveram o style dominante

  // Flags comportamentais (% das últimas N)
  pace_made_all_pct: number;
  pace_held_up_pct: number;
  pace_kept_on_pct: number;
  pace_weakened_pct: number;
  pace_hung_pct: number;

  // Ratings recentes (RPR + TS médio dos últimos N)
  pace_rpr_avg_recent: number;
  pace_rpr_max_recent: number;
  pace_ts_avg_recent: number;

  // Margem média e melhor (ovr_btn em lengths)
  pace_ovr_btn_avg_recent: number;
  pace_ovr_btn_min_recent: number; // melhor (menor margem) → ovr_btn=0 se ganhou

  // Quantidade real de data points (0 a N) — modelo aprende a descontar quando 0
  pace_data_count: number;
}

export interface RaceFieldPaceFeatures {
  // Pressure = % do field com style early-side (E + 0.5*EP)
  field_pace_pressure: number;
  // Conta absoluta de pace setters previstos no field
  n_early_runners: number;
  n_pressers: number;
  n_held_up: number;
  // Flag clássico do tier list: somente UM cavalo é dominante E → vantagem grande
  is_lone_speed: 0 | 1;
  // Tamanho efetivo (só conta cavalos com dados de pace; descarta missing)
  pace_field_size: number;
}

const ZERO_HORSE_FEATURES: HorsePaceFeatures = {
  pace_E_pct_recent: 0,
  pace_EP_pct_recent: 0,
  pace_P_pct_recent: 0,
  pace_S_pct_recent: 0,
  pace_dominant_style_code: 0,
  pace_consistency: 0,
  pace_made_all_pct: 0,
  pace_held_up_pct: 0,
  pace_kept_on_pct: 0,
  pace_weakened_pct: 0,
  pace_hung_pct: 0,
  pace_rpr_avg_recent: 0,
  pace_rpr_max_recent: 0,
  pace_ts_avg_recent: 0,
  pace_ovr_btn_avg_recent: 0,
  pace_ovr_btn_min_recent: 0,
  pace_data_count: 0,
};

function styleCodeToNumeric(code: RunStyleCode): number {
  switch (code) {
    case "E":
      return 1;
    case "EP":
      return 2;
    case "P":
      return 3;
    case "S":
      return 4;
    default:
      return 0;
  }
}

/**
 * Extrai features de pace pra UM cavalo a partir do histórico rpscrape.
 *
 * @param history entradas já ordenadas por race_date DESC (mais recentes primeiro).
 *                Vai considerar só as primeiras PACE_HISTORY_WINDOW.
 */
export function extractPaceFeatures(
  history: PaceHistoryEntry[],
): HorsePaceFeatures {
  if (history.length === 0) return { ...ZERO_HORSE_FEATURES };

  const recent = history.slice(0, PACE_HISTORY_WINDOW);
  const n = recent.length;

  let countE = 0;
  let countEP = 0;
  let countP = 0;
  let countS = 0;
  let countMadeAll = 0;
  let countHeldUp = 0;
  let countKeptOn = 0;
  let countWeakened = 0;
  let countHung = 0;

  let rprSum = 0;
  let rprCount = 0;
  let rprMax = 0;
  let tsSum = 0;
  let tsCount = 0;

  let btnSum = 0;
  let btnCount = 0;
  let btnMin = Number.POSITIVE_INFINITY;

  for (const entry of recent) {
    const parsed = parseRunStyle(entry.comment);
    switch (parsed.code) {
      case "E":
        countE++;
        break;
      case "EP":
        countEP++;
        break;
      case "P":
        countP++;
        break;
      case "S":
        countS++;
        break;
      default:
        break; // U — não conta na distribuição
    }
    if (parsed.made_all) countMadeAll++;
    if (parsed.held_up) countHeldUp++;
    if (parsed.kept_on) countKeptOn++;
    if (parsed.weakened) countWeakened++;
    if (parsed.hung) countHung++;

    if (entry.rpr_rating !== null && entry.rpr_rating !== undefined) {
      rprSum += entry.rpr_rating;
      rprCount++;
      if (entry.rpr_rating > rprMax) rprMax = entry.rpr_rating;
    }
    if (entry.ts_rating !== null && entry.ts_rating !== undefined) {
      tsSum += entry.ts_rating;
      tsCount++;
    }
    if (entry.ovr_btn !== null && entry.ovr_btn !== undefined) {
      btnSum += entry.ovr_btn;
      btnCount++;
      if (entry.ovr_btn < btnMin) btnMin = entry.ovr_btn;
    }
  }

  // Dominant style
  const styleCounts: Array<[RunStyleCode, number]> = [
    ["E", countE],
    ["EP", countEP],
    ["P", countP],
    ["S", countS],
  ];
  styleCounts.sort((a, b) => b[1] - a[1]);
  const dominant = styleCounts[0];
  const dominantCount = dominant[1];
  const dominantCode = dominantCount > 0 ? dominant[0] : "U";

  return {
    pace_E_pct_recent: countE / n,
    pace_EP_pct_recent: countEP / n,
    pace_P_pct_recent: countP / n,
    pace_S_pct_recent: countS / n,
    pace_dominant_style_code: styleCodeToNumeric(dominantCode),
    pace_consistency: dominantCount > 0 ? dominantCount / n : 0,
    pace_made_all_pct: countMadeAll / n,
    pace_held_up_pct: countHeldUp / n,
    pace_kept_on_pct: countKeptOn / n,
    pace_weakened_pct: countWeakened / n,
    pace_hung_pct: countHung / n,
    pace_rpr_avg_recent: rprCount > 0 ? rprSum / rprCount : 0,
    pace_rpr_max_recent: rprMax,
    pace_ts_avg_recent: tsCount > 0 ? tsSum / tsCount : 0,
    pace_ovr_btn_avg_recent: btnCount > 0 ? btnSum / btnCount : 0,
    pace_ovr_btn_min_recent: btnCount > 0 ? btnMin : 0,
    pace_data_count: n,
  };
}

/**
 * Computa features pace a nível de corrida — dado o array de
 * HorsePaceFeatures já calculados pra cada cavalo do field.
 *
 * Pace pressure: cavalos que tendem a correr E ou EP no field representam
 *   pressão pela ponta. Lone speed = só 1 cavalo dominantemente E.
 */
export function computeFieldPaceFeatures(
  horses: HorsePaceFeatures[],
): RaceFieldPaceFeatures {
  // Considera apenas cavalos COM dados (pace_data_count > 0)
  const withData = horses.filter((h) => h.pace_data_count > 0);
  const n = withData.length;
  if (n === 0) {
    return {
      field_pace_pressure: 0,
      n_early_runners: 0,
      n_pressers: 0,
      n_held_up: 0,
      is_lone_speed: 0,
      pace_field_size: 0,
    };
  }

  let nEarly = 0; // dominant = E
  let nPress = 0; // dominant = EP
  let nHeldUp = 0; // dominant = S (proxy pra "tem closers no field")

  for (const h of withData) {
    if (h.pace_dominant_style_code === 1) nEarly++;
    else if (h.pace_dominant_style_code === 2) nPress++;
    else if (h.pace_dominant_style_code === 4) nHeldUp++;
  }

  return {
    field_pace_pressure: (nEarly + 0.5 * nPress) / n,
    n_early_runners: nEarly,
    n_pressers: nPress,
    n_held_up: nHeldUp,
    is_lone_speed: nEarly === 1 ? 1 : 0,
    pace_field_size: n,
  };
}

/**
 * Interaction feature: avalia "fit" do style do cavalo vs configuração do
 * field. Lógica:
 *   - Cavalo E + lone speed → +1.0  (sem competição na ponta)
 *   - Cavalo E + pressure alta (>0.4) → -1.0 (vai brigar e queimar)
 *   - Cavalo S + pressure alta → +0.7 (closers se beneficiam de field rápido)
 *   - Cavalo S + pressure baixa → -0.3 (corrida lenta, closers ficam sem ritmo)
 *   - Caso contrário: 0 (neutro)
 *
 * Range esperado: [-1, +1].
 */
export function paceMatchScore(
  horse: HorsePaceFeatures,
  field: RaceFieldPaceFeatures,
): number {
  if (horse.pace_data_count === 0 || field.pace_field_size === 0) return 0;

  const style = horse.pace_dominant_style_code;
  const pressure = field.field_pace_pressure;
  const loneSpeed = field.is_lone_speed === 1;

  if (style === 1 /* E */) {
    if (loneSpeed) return 1.0;
    if (pressure > 0.4) return -1.0;
    return 0.2;
  }
  if (style === 4 /* S */) {
    if (pressure > 0.4) return 0.7;
    if (pressure < 0.15) return -0.3;
    return 0.0;
  }
  return 0;
}
