// Fase 6 debug: simulação pura de LAY por corrida.
// Regras (validadas com usuário 2026-06-27):
//   - Stake fixo 10, odd hipotética constante 20
//   - Cascata pick #1 → #2 → #3, aposta no primeiro elegível
//   - Elegível: non_runner=false E odd média histórica ∈ [MIN_ELIGIBLE_ODD, MAX_ELIGIBLE_ODD]
//   - Se nenhum elegível → skip corrida
//   - Vitória do cavalo apostado (position=1) → -200; senão → +10
//   - Banca pode ficar negativa (setup A=iii do plano)

export const STAKE = 10;
export const ASSUMED_ODD = 20;
export const WIN_PNL = 10; // ganho quando o cavalo NÃO vence (fixed stake)
// Perda LEGADA (hardcoded odd 20). Mantida como fallback pra retro-compat.
export const LOSS_PNL_HARDCODED = -200;
// Perda REAL Betfair LAY = -stake × (odd_real - 1).
// USE_REAL_ODD_PNL=1 no env ativa cálculo dinâmico usando chosen.market_odd.
export const USE_REAL_ODD_PNL =
  (process.env.USE_REAL_ODD_PNL || "").trim() === "1";
// Defaults; sobrescritos via arg em simulateRace pra experimentação.
export const DEFAULT_MIN_ELIGIBLE_ODD = 4.0;
export const DEFAULT_MAX_ELIGIBLE_ODD = 20;

export interface PickCandidate {
  race_horse_id: number;
  horse_id: number;
  horse_name?: string;
  predicted_probability: number; // P(lose)
  combined_score: number;
  ivl_score: number;
  market_odd: number; // média histórica; 0 se indisponível
  non_runner: boolean;
  won_race: boolean; // = position === 1
  finish_position: number; // debug
}

export type SkipReason = "all_ineligible" | "no_picks" | "gap_filter";

export interface SimResult {
  raceId: number;
  raceDate: string;
  pickIndexUsed: number | null; // 0/1/2 ou null se skip
  skipReason: SkipReason | null;
  chosenHorseId: number | null;
  chosenOdd: number | null;
  chosenPredictedProbability: number | null; // P(lose) do escolhido
  chosenIvlScore: number | null;
  chosenWonRace: boolean | null; // true se cavalo apostado venceu (tomamos loss)
  pnl: number;
  bankrollBefore: number;
  bankrollAfter: number;
}

export function simulateRace(
  raceId: number,
  raceDate: string,
  top3: PickCandidate[],
  bankrollBefore: number,
  minEligibleOdd: number = DEFAULT_MIN_ELIGIBLE_ODD,
  maxEligibleOdd: number = DEFAULT_MAX_ELIGIBLE_ODD,
): SimResult {
  const emptyResult = (skipReason: SkipReason): SimResult => ({
    raceId,
    raceDate,
    pickIndexUsed: null,
    skipReason,
    chosenHorseId: null,
    chosenOdd: null,
    chosenPredictedProbability: null,
    chosenIvlScore: null,
    chosenWonRace: null,
    pnl: 0,
    bankrollBefore,
    bankrollAfter: bankrollBefore,
  });

  if (top3.length === 0) return emptyResult("no_picks");

  let chosen: PickCandidate | null = null;
  let pickIndex = -1;

  for (let i = 0; i < top3.length; i++) {
    const c = top3[i];
    if (c.non_runner) continue;
    if (c.market_odd <= 0) continue; // sem odd histórica → inelegível
    if (c.market_odd < minEligibleOdd) continue;
    if (c.market_odd > maxEligibleOdd) continue;
    chosen = c;
    pickIndex = i;
    break;
  }

  if (!chosen) return emptyResult("all_ineligible");

  // P/L:
  //   - Win (cavalo NÃO vence): +stake (fixo R$10)
  //   - Loss (cavalo vence):
  //       modo REAL: -stake × (odd_real - 1) — Betfair math correta
  //       modo LEGADO: -200 (odd 20 hardcoded, retrocompat)
  let pnl: number;
  if (chosen.won_race) {
    pnl = USE_REAL_ODD_PNL
      ? -STAKE * (chosen.market_odd - 1)
      : LOSS_PNL_HARDCODED;
  } else {
    pnl = WIN_PNL;
  }

  return {
    raceId,
    raceDate,
    pickIndexUsed: pickIndex,
    skipReason: null,
    chosenHorseId: chosen.horse_id,
    chosenOdd: chosen.market_odd,
    chosenPredictedProbability: chosen.predicted_probability,
    chosenIvlScore: chosen.ivl_score,
    chosenWonRace: chosen.won_race,
    pnl,
    bankrollBefore,
    bankrollAfter: bankrollBefore + pnl,
  };
}
