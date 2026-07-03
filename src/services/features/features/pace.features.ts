// Features de pace / run-style derivadas dos dados do rpscrape.
//
// Tier 1 #3 do roadmap val_top1. Combina:
//   - HISTORICAL (cavalo): run_style_recent, ovr_btn médio, secs/furlong, rpr médio
//   - FIELD-LEVEL (corrida): pace_pressure, is_lone_speed, pace_match_score
//
// Não substitui as features existentes (form_*, recent_avg_position, etc) —
// adiciona um layer NOVO. Cavalos sem rpscrape data caem em defaults neutros
// (run_style=0, etc) — pipeline Node continua funcionando sem cobertura completa.

import {
  parseRunStyle,
  runStyleToInt,
  type RunStyleCode,
} from "../converters/comment.converter";

/**
 * Linha do rpscrape_results pra um cavalo em uma corrida histórica.
 * Carregada via JOIN no orchestrator.
 */
export interface RpscrapeHistoricalRecord {
  race_horse_id: number;
  race_date: string; // YYYY-MM-DD
  comment: string | null;
  ovr_btn: number | null;
  secs: number | null;
  rpr_rating: number | null;
  ts_rating: number | null;
  dist_f: number | null;
}

/**
 * Features de pace / velocidade derivadas do HISTÓRICO do cavalo
 * (últimas N corridas no rpscrape_results).
 *
 * Defaults pensados pra serem "neutros": cavalo sem dado → trata como "average".
 */
export interface PaceFeatures {
  /** Mode do run_style nos últimos 5 starts. 0=unknown, 1=S, 2=P, 3=EP, 4=E. */
  run_style_mode_recent_5: number;
  /** % de starts com run_style E ou EP nos últimos 5 (0..1) */
  run_style_pct_early_recent_5: number;
  /** Média de overall btn (lengths atrás do vencedor) nos últimos 5 */
  avg_ovr_btn_recent_5: number;
  /** RPR máximo nos últimos 5 starts (mede peak ability recente) */
  rpr_max_recent_5: number;
  /** Topspeed médio nos últimos 5 starts */
  ts_avg_recent_5: number;
  /** Velocidade (secs por furlong) média nos últimos 5 — proxy de velocidade absoluta */
  secs_per_furlong_avg_recent_5: number;
  /** Cobertura: quantos dos últimos 5 starts tinham dados do rpscrape (0..5) */
  rpscrape_coverage_recent_5: number;
}

const DEFAULT_PACE: PaceFeatures = {
  run_style_mode_recent_5: 0, // unknown
  run_style_pct_early_recent_5: 0,
  avg_ovr_btn_recent_5: 10, // neutro: 10 lengths atrás
  rpr_max_recent_5: 70, // baseline competitivo
  ts_avg_recent_5: 50, // baseline
  secs_per_furlong_avg_recent_5: 13, // ~13s/furlong é média grosseira
  rpscrape_coverage_recent_5: 0,
};

/**
 * Calcula a moda (valor mais frequente) de uma lista. Ties resolvidos pelo MAIOR
 * (favorece estilo mais agressivo em caso de empate — match com a literatura).
 */
function mode(values: number[]): number {
  if (values.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let bestVal = values[0];
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && v > bestVal)) {
      bestVal = v;
      bestCount = c;
    }
  }
  return bestVal;
}

/**
 * Extrai pace features a partir do histórico rpscrape (passado já ordenado
 * por data DESC = mais recente primeiro).
 *
 * `recordsDescOrdered` deve ter no máximo 5 entradas (ou mais — a função pega
 * só as 5 primeiras). Tudo ANTES da `currentRaceDate`.
 */
export function extractPaceFeatures(
  recordsDescOrdered: RpscrapeHistoricalRecord[],
  currentRaceDate: Date,
): PaceFeatures {
  // Filtra só os anteriores à corrida atual e pega os 5 mais recentes
  const cutoff = currentRaceDate.getTime();
  const recent = recordsDescOrdered
    .filter((r) => new Date(r.race_date).getTime() < cutoff)
    .slice(0, 5);

  if (recent.length === 0) return DEFAULT_PACE;

  // Run style nos últimos 5
  const styles: RunStyleCode[] = recent.map((r) => parseRunStyle(r.comment));
  const styleInts = styles.map(runStyleToInt);
  const knownStyles = styleInts.filter((s) => s > 0);
  const runStyleMode = knownStyles.length > 0 ? mode(knownStyles) : 0;

  const earlyCount = styles.filter((s) => s === "E" || s === "EP").length;
  const runStylePctEarly = earlyCount / recent.length;

  // Métricas numéricas (sobre só os que TÊM o campo)
  const ovrBtns = recent
    .map((r) => r.ovr_btn)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const avgOvrBtn = ovrBtns.length > 0
    ? ovrBtns.reduce((s, v) => s + v, 0) / ovrBtns.length
    : DEFAULT_PACE.avg_ovr_btn_recent_5;

  const rprs = recent
    .map((r) => r.rpr_rating)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const rprMax = rprs.length > 0 ? Math.max(...rprs) : DEFAULT_PACE.rpr_max_recent_5;

  const tss = recent
    .map((r) => r.ts_rating)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const tsAvg = tss.length > 0
    ? tss.reduce((s, v) => s + v, 0) / tss.length
    : DEFAULT_PACE.ts_avg_recent_5;

  // Velocidade: secs / dist_f por corrida
  const secsPerFurlong = recent
    .map((r) =>
      r.secs != null && r.dist_f != null && r.dist_f > 0 ? r.secs / r.dist_f : null,
    )
    .filter((v): v is number => v != null && Number.isFinite(v));
  const secsPerFurlongAvg = secsPerFurlong.length > 0
    ? secsPerFurlong.reduce((s, v) => s + v, 0) / secsPerFurlong.length
    : DEFAULT_PACE.secs_per_furlong_avg_recent_5;

  // Cobertura: quantos dos 5 últimos tem comment não-null + dist_f válido
  const coverage = recent.filter(
    (r) => r.comment != null && r.comment.length > 5,
  ).length;

  return {
    run_style_mode_recent_5: runStyleMode,
    run_style_pct_early_recent_5: runStylePctEarly,
    avg_ovr_btn_recent_5: avgOvrBtn,
    rpr_max_recent_5: rprMax,
    ts_avg_recent_5: tsAvg,
    secs_per_furlong_avg_recent_5: secsPerFurlongAvg,
    rpscrape_coverage_recent_5: coverage,
  };
}

/**
 * Features RACE-LEVEL: olham todos os cavalos da corrida atual juntos.
 * Calculados DEPOIS de extractPaceFeatures de cada cavalo.
 *
 * `horsesStyles`: array de run_style_mode dos cavalos da corrida (mesmo array
 * usado pra calcular as features individuais).
 */
export interface FieldPaceFeatures {
  /** Fração de cavalos com run_style E ou EP (0..1) — quanto mais alto, mais pressão de pace */
  field_pace_pressure: number;
  /** 1 se EXATAMENTE 1 cavalo tem run_style E (favorece lone front-runner) */
  is_lone_speed: number;
  /** Quantos cavalos de cada estilo na corrida (numérico — pode virar embedding) */
  field_count_E: number;
  field_count_EP: number;
  field_count_P: number;
  field_count_S: number;
}

export function extractFieldPaceFeatures(
  horseStyles: number[],
): FieldPaceFeatures {
  let countE = 0;
  let countEP = 0;
  let countP = 0;
  let countS = 0;
  for (const s of horseStyles) {
    if (s === 4) countE++;
    else if (s === 3) countEP++;
    else if (s === 2) countP++;
    else if (s === 1) countS++;
  }
  const fieldSize = horseStyles.length;
  const pressure = fieldSize > 0 ? (countE + countEP) / fieldSize : 0;
  const isLoneSpeed = countE === 1 ? 1 : 0;
  return {
    field_pace_pressure: pressure,
    is_lone_speed: isLoneSpeed,
    field_count_E: countE,
    field_count_EP: countEP,
    field_count_P: countP,
    field_count_S: countS,
  };
}

/**
 * Interação cavalo × campo: quanto o estilo desse cavalo "encaixa" no contexto.
 *
 * Cavalo E (front-runner) numa corrida com is_lone_speed=1 → bom encaixe
 * Cavalo E numa corrida cheia de E (pressão alta) → mal encaixe (canibalização)
 * Cavalo S numa corrida cheia de E → bom encaixe (vai aproveitar collapse do pace)
 *
 * Score: -1 (ruim) a +1 (ótimo). Heurística baseada em "Lightspeed Stats" do tier list.
 */
export function paceMatchScore(
  horseStyle: number,
  field: FieldPaceFeatures,
): number {
  // Cavalo desconhecido → score neutro
  if (horseStyle === 0) return 0;

  // Lone front-runner = jackpot
  if (horseStyle === 4 && field.is_lone_speed === 1) return 1;

  // E + outros E na corrida = canibalização
  if (horseStyle === 4 && field.field_count_E > 1) return -0.5;

  // S + muito early pace = oportunidade de closer
  if (horseStyle === 1 && field.field_pace_pressure > 0.5) return 0.5;

  // S + pouco early pace = corrida vai ser de pace lento, ruim pra closer
  if (horseStyle === 1 && field.field_pace_pressure < 0.2) return -0.3;

  return 0;
}
