// features_v4/ml/generate_picks.ts

import { supabase } from "../..";

// Configurações
const MIN_IVL_THRESHOLD = 1.1;
const MIN_ODD_THRESHOLD = 4.0;
const MAX_ODD_THRESHOLD = 34.0;

interface PredictionData {
  racecard_id: number;
  race_id: number;
  race_horse_id: number;
  horse_id: number;
  predicted_probability: number;
  lay_recommendation: string;
  model_version: string;
  course?: string;
  race_date?: Date;
  off_time_br?: string;
  title?: string;
  horse?: string;
  number?: number;
}

interface EnrichedPick extends PredictionData {
  market_odd: number;
  ivl_score: number;
  combined_score: number;
  pick_type: "VALUE" | "PROBABILITY" | "HYBRID";
  confidence_score: number;
  selection_reason: string;
}

// ============================================================================
// PIPELINE PRINCIPAL
// ============================================================================

export async function generateLayBettingPicks(): Promise<void> {
  console.log("\n" + "=".repeat(50));
  console.log("🎯 GERAÇÃO DE PICKS PARA LAY BETTING");
  console.log("=".repeat(50));

  try {
    // Buscar todas as corridas com predições PENDING (flat ou jump)
    const upcomingRaces = await getUpcomingRacesWithPredictions();

    if (upcomingRaces.length === 0) {
      console.log("i Nenhuma corrida com predições para processar");
      return;
    }

    console.log(`\n📊 ${upcomingRaces.length} corridas para processar`);

    let successCount = 0;
    let errorCount = 0;

    for (const raceId of upcomingRaces) {
      try {
        await processRaceForPicks(raceId);
        successCount++;
      } catch (error) {
        console.error(`❌ Erro ao processar corrida ${raceId}:`, error);
        errorCount++;
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log("📊 RESUMO DA GERAÇÃO DE PICKS");
    console.log("-".repeat(50));
    console.log(`✅ Corridas processadas com sucesso: ${successCount}`);
    console.log(`❌ Corridas com erro: ${errorCount}`);
    console.log("=".repeat(50));

    await showPickStatistics();
  } catch (error) {
    console.error("❌ Erro no pipeline de geração de picks:", error);
    throw error;
  }
}

// ============================================================================
// BUSCAR CORRIDAS COM PREDIÇÕES
// ============================================================================

async function getUpcomingRacesWithPredictions(): Promise<number[]> {
  // Buscar todas as predições PENDING de modelos flat ou jump
  const { data, error } = await supabase
    .schema("hml")
    .from("prediction_enriched_horse_features")
    .select("race_id, model_version")
    .eq("prediction_status", "PENDING")
    .like("model_version", "v%-flat")
    .or("model_version.like.v%-jump");

  if (error) {
    // Fallback: se o filtro OR não funcionar, buscar todos os PENDING
    const { data: fallbackData, error: fallbackError } = await supabase
      .schema("hml")
      .from("prediction_enriched_horse_features")
      .select("race_id")
      .eq("prediction_status", "PENDING");

    if (fallbackError) throw fallbackError;
    return [...new Set(fallbackData?.map((d) => d.race_id) || [])];
  }

  return [...new Set(data?.map((d) => d.race_id) || [])];
}

// ============================================================================
// PROCESSAR CORRIDA
// ============================================================================

async function processRaceForPicks(raceId: number): Promise<void> {
  console.log(`\n🏇 Processando corrida ${raceId}...`);

  const predictions = await getPredictionsForRace(raceId);

  if (predictions.length === 0) {
    console.log(`  ! Sem predições para corrida ${raceId}`);
    return;
  }

  // Extrair model_version das predições (todas do mesmo tipo para uma corrida)
  const modelVersion = predictions[0].model_version;
  console.log(
    `  📊 ${predictions.length} cavalos com predições (${modelVersion})`,
  );

  const enrichedPicks = await enrichPredictionsWithMarketData(predictions);
  const rankedPicks = rankPicks(enrichedPicks);

  const mainPick = selectMainPick(rankedPicks);

  if (!mainPick) {
    console.log(`  ! Nenhum pick adequado encontrado para corrida ${raceId}`);
    return;
  }

  await insertMainPick(mainPick, raceId, modelVersion);

  const top3 = rankedPicks.slice(0, 3);
  await insertTopPicks(top3, raceId, modelVersion);

  console.log(`  ✅ Pick principal: ${mainPick.horse} (#${mainPick.number})`);
  console.log(`     - Tipo: ${mainPick.pick_type}`);
  console.log(
    `     - Probabilidade: ${(mainPick.predicted_probability * 100).toFixed(1)}%`,
  );
  if (mainPick.ivl_score) {
    console.log(`     - IVL: ${mainPick.ivl_score.toFixed(2)}`);
  }
  console.log(
    `     - Confiança: ${(mainPick.confidence_score * 100).toFixed(0)}%`,
  );
}

async function getPredictionsForRace(
  raceId: number,
): Promise<PredictionData[]> {
  const { data: predictions, error: predError } = await supabase
    .schema("hml")
    .from("prediction_enriched_horse_features")
    .select("*")
    .eq("race_id", raceId)
    .eq("prediction_status", "PENDING");

  if (predError) throw predError;
  if (!predictions || predictions.length === 0) return [];

  const raceHorseIds = predictions.map((p) => p.race_horse_id);

  const { data: raceData, error: raceError } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .select("id, course, date, off_time_br, title")
    .eq("id", raceId)
    .single();

  if (raceError) throw raceError;

  const { data: horsesData, error: horsesError } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select("id, horse, number")
    .in("id", raceHorseIds);

  if (horsesError) throw horsesError;

  return predictions.map((pred) => {
    const horse = horsesData?.find((h) => h.id === pred.race_horse_id);
    return {
      racecard_id: raceId,
      race_id: pred.race_id,
      race_horse_id: pred.race_horse_id,
      horse_id: pred.horse_id,
      predicted_probability: pred.predicted_probability,
      lay_recommendation: pred.lay_recommendation,
      model_version: pred.model_version,
      course: raceData?.course,
      race_date: raceData?.date,
      off_time_br: raceData?.off_time_br,
      title: raceData?.title,
      horse: horse?.horse,
      number: horse?.number,
    };
  });
}

// ============================================================================
// ENRICHMENT COM DADOS DE MERCADO
// ============================================================================

async function enrichPredictionsWithMarketData(
  predictions: PredictionData[],
): Promise<EnrichedPick[]> {
  const enrichedPicks: EnrichedPick[] = [];

  for (const pred of predictions) {
    const marketOdd = await getAverageOdd(pred.race_horse_id);

    let ivlScore = 0;
    if (marketOdd && marketOdd > 0) {
      ivlScore = calculateLayValueIndex(pred.predicted_probability, marketOdd);
    }

    const combinedScore = calculateCombinedScore(
      pred.predicted_probability,
      ivlScore,
      marketOdd || 0,
    );
    const pickType = determinePickType(ivlScore, marketOdd || 0);
    const confidenceScore = calculateConfidenceScore(
      pred.predicted_probability,
      ivlScore,
      marketOdd || 0,
      pred.lay_recommendation,
    );
    const selectionReason = generateSelectionReason(
      pickType,
      pred.predicted_probability,
      ivlScore,
      marketOdd || 0,
    );

    enrichedPicks.push({
      ...pred,
      market_odd: marketOdd || 0,
      ivl_score: ivlScore,
      combined_score: combinedScore,
      pick_type: pickType,
      confidence_score: confidenceScore,
      selection_reason: selectionReason,
    });
  }

  return enrichedPicks;
}

async function getAverageOdd(raceHorseId: number): Promise<number | null> {
  const { data, error } = await supabase
    .schema("hml")
    .from("odds_enriched")
    .select("odd")
    .eq("race_horse_id", raceHorseId);

  if (error || !data || data.length === 0) return null;

  return data.reduce((sum, r) => sum + Number(r.odd), 0) / data.length;
}

// ============================================================================
// CÁLCULOS
// ============================================================================

function calculateLayValueIndex(
  probability: number,
  marketOdd: number,
): number {
  if (marketOdd <= 1) return 0;
  const impliedProbWin = 1 / marketOdd;
  const impliedProbLose = 1 - impliedProbWin;
  return probability - impliedProbLose;
}

function calculateCombinedScore(
  probability: number,
  ivl: number,
  marketOdd: number,
): number {
  const WEIGHT_PROB = 0.4;
  const WEIGHT_IVL = 0.4;
  const WEIGHT_ODD_RANGE = 0.2;

  const probScore = probability;
  const ivlScore = Math.min(ivl / 2, 1);

  let oddScore = 0;
  if (marketOdd >= MIN_ODD_THRESHOLD && marketOdd <= MAX_ODD_THRESHOLD) {
    if (marketOdd >= 6 && marketOdd <= 15) {
      oddScore = 1;
    } else if (marketOdd < 6) {
      oddScore = (marketOdd - MIN_ODD_THRESHOLD) / (6 - MIN_ODD_THRESHOLD);
    } else {
      oddScore = 1 - (marketOdd - 15) / (MAX_ODD_THRESHOLD - 15);
    }
  }

  return (
    probScore * WEIGHT_PROB +
    ivlScore * WEIGHT_IVL +
    oddScore * WEIGHT_ODD_RANGE
  );
}

function determinePickType(
  ivl: number,
  marketOdd: number,
): "VALUE" | "PROBABILITY" | "HYBRID" {
  const hasGoodValue =
    ivl > MIN_IVL_THRESHOLD &&
    marketOdd >= MIN_ODD_THRESHOLD &&
    marketOdd <= MAX_ODD_THRESHOLD;

  if (hasGoodValue && ivl > 1.5) return "VALUE";
  if (
    !marketOdd ||
    marketOdd < MIN_ODD_THRESHOLD ||
    marketOdd > MAX_ODD_THRESHOLD
  )
    return "PROBABILITY";
  return "HYBRID";
}

function calculateConfidenceScore(
  probability: number,
  ivl: number,
  marketOdd: number,
  layRecommendation: string,
): number {
  let confidence = 0;

  switch (layRecommendation) {
    case "STRONG_LAY":
      confidence = 0.9;
      break;
    case "LAY":
      confidence = 0.7;
      break;
    case "NEUTRAL":
      confidence = 0.5;
      break;
    default:
      confidence = 0.3;
  }

  if (probability > 0.9) confidence = Math.min(confidence + 0.15, 1);
  else if (probability > 0.85) confidence = Math.min(confidence + 0.1, 1);
  else if (probability > 0.8) confidence = Math.min(confidence + 0.05, 1);
  else if (probability < 0.6) confidence *= 0.9;

  if (ivl > 1.5) confidence = Math.min(confidence + 0.1, 1);
  else if (ivl > MIN_IVL_THRESHOLD) confidence = Math.min(confidence + 0.05, 1);

  if (
    marketOdd &&
    (marketOdd < MIN_ODD_THRESHOLD || marketOdd > MAX_ODD_THRESHOLD)
  ) {
    confidence *= 0.8;
  }

  return confidence;
}

function generateSelectionReason(
  pickType: string,
  probability: number,
  ivl: number,
  marketOdd: number,
): string {
  const reasons: string[] = [];

  if (probability > 0.85) {
    reasons.push(
      `Alta probabilidade de não vencer (${(probability * 100).toFixed(1)}%)`,
    );
  }
  if (ivl > 1.5) {
    reasons.push(`Excelente valor de lay (IVL: ${ivl.toFixed(2)})`);
  } else if (ivl > MIN_IVL_THRESHOLD) {
    reasons.push(`Bom valor de lay (IVL: ${ivl.toFixed(2)})`);
  }
  if (marketOdd >= 6 && marketOdd <= 15) {
    reasons.push(`Odd ideal para lay (${marketOdd.toFixed(2)})`);
  }
  if (pickType === "VALUE") reasons.push("Pick baseado em valor de mercado");
  else if (pickType === "PROBABILITY")
    reasons.push("Pick baseado em probabilidade do modelo");
  else reasons.push("Pick híbrido (valor + probabilidade)");

  return reasons.join("; ");
}

// ============================================================================
// RANKING E SELEÇÃO
// ============================================================================

function rankPicks(picks: EnrichedPick[]): EnrichedPick[] {
  return picks.sort((a, b) => b.combined_score - a.combined_score);
}

function selectMainPick(rankedPicks: EnrichedPick[]): EnrichedPick | null {
  const eligiblePicks = rankedPicks.filter(
    (p) => p.lay_recommendation !== "AVOID",
  );

  const valuePicks = eligiblePicks.filter(
    (p) =>
      p.pick_type === "VALUE" &&
      p.ivl_score > MIN_IVL_THRESHOLD &&
      p.market_odd >= MIN_ODD_THRESHOLD &&
      p.market_odd <= MAX_ODD_THRESHOLD,
  );
  if (valuePicks.length > 0) return valuePicks[0];

  const probPicks = eligiblePicks.filter((p) => p.predicted_probability > 0.65);
  if (probPicks.length > 0) return probPicks[0];

  return eligiblePicks.length > 0 ? eligiblePicks[0] : null;
}

// ============================================================================
// INSERÇÃO NO BANCO
// ============================================================================

async function insertMainPick(
  pick: EnrichedPick,
  raceId: number,
  modelVersion: string,
): Promise<void> {
  const record = {
    racecard_id: raceId,
    race_id: pick.race_id,
    race_horse_id: pick.race_horse_id,
    horse_id: pick.horse_id,
    course: pick.course || "",
    race_date: pick.race_date,
    off_time_br: pick.off_time_br || "",
    race_title: pick.title || "",
    horse_name: pick.horse || "",
    horse_number: pick.number,
    predicted_probability: pick.predicted_probability,
    market_odd: pick.market_odd > 0 ? pick.market_odd : null,
    ivl_score: pick.ivl_score !== null ? pick.ivl_score : null,
    pick_type: pick.pick_type,
    lay_recommendation: pick.lay_recommendation,
    confidence_score: pick.confidence_score,
    model_version: modelVersion,
    generated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .schema("hml")
    .from("lay_betting_picks")
    .upsert(record, { onConflict: "racecard_id,model_version" });

  if (error) throw error;
}

async function insertTopPicks(
  picks: EnrichedPick[],
  raceId: number,
  modelVersion: string,
): Promise<void> {
  const records = picks.map((pick, index) => ({
    racecard_id: raceId,
    race_id: pick.race_id,
    race_horse_id: pick.race_horse_id,
    horse_id: pick.horse_id,
    pick_rank: index + 1,
    horse_name: pick.horse || "",
    horse_number: pick.number,
    predicted_probability: pick.predicted_probability,
    market_odd: pick.market_odd > 0 ? pick.market_odd : null,
    ivl_score: pick.ivl_score !== null ? pick.ivl_score : null,
    combined_score: pick.combined_score,
    pick_type: pick.pick_type,
    lay_recommendation: pick.lay_recommendation,
    selection_reason: pick.selection_reason,
    model_version: modelVersion,
    generated_at: new Date().toISOString(),
    score_diff_to_first:
      index === 0
        ? 0
        : (picks[0].combined_score - pick.combined_score) /
          picks[0].combined_score,
  }));

  const { error } = await supabase
    .schema("hml")
    .from("lay_betting_top_picks")
    .upsert(records, { onConflict: "racecard_id,pick_rank,model_version" });

  if (error) throw error;
}

// ============================================================================
// ESTATÍSTICAS
// ============================================================================

async function showPickStatistics(): Promise<void> {
  console.log("\n📊 ESTATÍSTICAS DOS PICKS GERADOS");
  console.log("-".repeat(40));

  const { data: mainPicks, error: mainError } = await supabase
    .schema("hml")
    .from("lay_betting_picks")
    .select("pick_type, lay_recommendation, confidence_score, model_version")
    .gte(
      "generated_at",
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    );

  if (!mainError && mainPicks && mainPicks.length > 0) {
    const flatPicks = mainPicks.filter((p) =>
      p.model_version?.includes("flat"),
    );
    const jumpPicks = mainPicks.filter((p) =>
      p.model_version?.includes("jump"),
    );

    console.log(
      `\n🏇 Flat: ${flatPicks.length} picks | Jump: ${jumpPicks.length} picks`,
    );

    const byType = {
      VALUE: mainPicks.filter((p) => p.pick_type === "VALUE").length,
      PROBABILITY: mainPicks.filter((p) => p.pick_type === "PROBABILITY")
        .length,
      HYBRID: mainPicks.filter((p) => p.pick_type === "HYBRID").length,
    };

    console.log("\n🎯 Picks Principais (últimas 24h):");
    console.log(`  - VALUE: ${byType.VALUE}`);
    console.log(`  - PROBABILITY: ${byType.PROBABILITY}`);
    console.log(`  - HYBRID: ${byType.HYBRID}`);

    const avgConfidence =
      mainPicks.reduce((sum, p) => sum + p.confidence_score, 0) /
      mainPicks.length;
    console.log(`  - Confiança média: ${(avgConfidence * 100).toFixed(1)}%`);

    const byRec = {
      STRONG_LAY: mainPicks.filter((p) => p.lay_recommendation === "STRONG_LAY")
        .length,
      LAY: mainPicks.filter((p) => p.lay_recommendation === "LAY").length,
      NEUTRAL: mainPicks.filter((p) => p.lay_recommendation === "NEUTRAL")
        .length,
      AVOID: mainPicks.filter((p) => p.lay_recommendation === "AVOID").length,
    };

    console.log("\n📈 Por Recomendação:");
    console.log(`  - STRONG_LAY: ${byRec.STRONG_LAY}`);
    console.log(`  - LAY: ${byRec.LAY}`);
    console.log(`  - NEUTRAL: ${byRec.NEUTRAL}`);
    console.log(`  - AVOID: ${byRec.AVOID}`);
  }

  const { data: topPicks, error: topError } = await supabase
    .schema("hml")
    .from("lay_betting_top_picks")
    .select("pick_rank, horse_name, combined_score, model_version")
    .eq("pick_rank", 1)
    .gte(
      "generated_at",
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    )
    .order("combined_score", { ascending: false })
    .limit(5);

  if (!topError && topPicks && topPicks.length > 0) {
    console.log("\n🏆 Top 5 Melhores Scores (Rank #1):");
    topPicks.forEach((pick, idx) => {
      const type = pick.model_version?.includes("flat") ? "F" : "J";
      console.log(
        `  ${idx + 1}. [${type}] ${pick.horse_name} - Score: ${pick.combined_score.toFixed(3)}`,
      );
    });
  }

  console.log("-".repeat(40));
}

// ============================================================================
// VALIDAÇÃO E ANÁLISE (sem mudanças de lógica, removido filtro model_version fixo)
// ============================================================================

export async function validatePreviousPicks(): Promise<void> {
  console.log("\n🔍 Validando resultados de picks anteriores...");

  const { data: pendingPicks, error: pendingError } = await supabase
    .schema("hml")
    .from("lay_betting_picks")
    .select("id, racecard_id, race_horse_id, bet_odd")
    .eq("result", "PENDING");

  if (pendingError || !pendingPicks) {
    console.error("Erro ao buscar picks pendentes:", pendingError);
    return;
  }

  console.log(`📊 ${pendingPicks.length} picks pendentes para validar`);

  let validated = 0;
  let won = 0;
  let lost = 0;

  for (const pick of pendingPicks) {
    const { data: raceResult, error: raceError } = await supabase
      .schema("hml")
      .from("race_horses_hr_enriched")
      .select("position")
      .eq("id", pick.race_horse_id)
      .single();

    if (raceError || !raceResult) continue;

    const { data: raceData, error: raceDataError } = await supabase
      .schema("hml")
      .from("racecards_hr_enriched")
      .select("finished")
      .eq("id", pick.racecard_id)
      .single();

    if (raceDataError || !raceData || !raceData.finished) continue;

    const result = raceResult.position === 1 ? "LOST" : "WON";
    const stake = 100;
    let profitLoss = 0;

    if (result === "WON") {
      profitLoss = stake;
      won++;
    } else {
      profitLoss = -stake * (pick.bet_odd - 1);
      lost++;
    }

    const { error: updateError } = await supabase
      .schema("hml")
      .from("lay_betting_picks")
      .update({ result, profit_loss: profitLoss })
      .eq("id", pick.id);

    if (!updateError) validated++;
  }

  console.log(`✅ ${validated} picks validados`);
  console.log(`  - Ganhos: ${won}`);
  console.log(`  - Perdidos: ${lost}`);

  if (validated > 0) {
    console.log(`  - Taxa de acerto: ${((won / validated) * 100).toFixed(1)}%`);
  }
}

export async function analyzeHistoricalPerformance(days = 30): Promise<void> {
  console.log(`\n📊 ANÁLISE DE PERFORMANCE (últimos ${days} dias)`);
  console.log("=".repeat(50));

  const startDate = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: picks, error } = await supabase
    .schema("hml")
    .from("lay_betting_picks")
    .select("*")
    .gte("race_date", startDate)
    .in("result", ["WON", "LOST"]);

  if (error || !picks || picks.length === 0) {
    console.log("Sem dados suficientes para análise");
    return;
  }

  // Análise por modelo (flat vs jump)
  const flatPicks = picks.filter((p) => p.model_version?.includes("flat"));
  const jumpPicks = picks.filter((p) => p.model_version?.includes("jump"));

  console.log(
    `\n🏇 Flat: ${flatPicks.length} picks | Jump: ${jumpPicks.length} picks`,
  );

  const analysisByType = {
    VALUE: { total: 0, won: 0, profit: 0 },
    PROBABILITY: { total: 0, won: 0, profit: 0 },
    HYBRID: { total: 0, won: 0, profit: 0 },
  };

  const analysisByConfidence = {
    high: { total: 0, won: 0, profit: 0 },
    medium: { total: 0, won: 0, profit: 0 },
    low: { total: 0, won: 0, profit: 0 },
  };

  for (const pick of picks) {
    const type = pick.pick_type as keyof typeof analysisByType;
    if (analysisByType[type]) {
      analysisByType[type].total++;
      if (pick.result === "WON") analysisByType[type].won++;
      analysisByType[type].profit += pick.profit_loss || 0;
    }

    const confKey =
      pick.confidence_score > 0.8
        ? "high"
        : pick.confidence_score > 0.6
          ? "medium"
          : "low";

    analysisByConfidence[confKey].total++;
    if (pick.result === "WON") analysisByConfidence[confKey].won++;
    analysisByConfidence[confKey].profit += pick.profit_loss || 0;
  }

  console.log("\n📈 PERFORMANCE POR TIPO DE PICK:");
  for (const [type, stats] of Object.entries(analysisByType)) {
    if (stats.total > 0) {
      const winRate = ((stats.won / stats.total) * 100).toFixed(1);
      const roi = ((stats.profit / (stats.total * 100)) * 100).toFixed(1);
      console.log(`\n${type}:`);
      console.log(`  - Total: ${stats.total} picks`);
      console.log(`  - Taxa de acerto: ${winRate}%`);
      console.log(`  - Lucro/Prejuízo: ${stats.profit.toFixed(2)}`);
      console.log(`  - ROI: ${roi}%`);
    }
  }

  console.log("\n📊 PERFORMANCE POR NÍVEL DE CONFIANÇA:");
  for (const [level, stats] of Object.entries(analysisByConfidence)) {
    if (stats.total > 0) {
      const winRate = ((stats.won / stats.total) * 100).toFixed(1);
      const roi = ((stats.profit / (stats.total * 100)) * 100).toFixed(1);
      console.log(
        `\n${level.toUpperCase()} (${level === "high" ? ">80%" : level === "medium" ? "60-80%" : "<60%"}):`,
      );
      console.log(`  - Total: ${stats.total} picks`);
      console.log(`  - Taxa de acerto: ${winRate}%`);
      console.log(`  - Lucro/Prejuízo: ${stats.profit.toFixed(2)}`);
      console.log(`  - ROI: ${roi}%`);
    }
  }

  const totalPicks = picks.length;
  const totalWon = picks.filter((p) => p.result === "WON").length;
  const totalProfit = picks.reduce((sum, p) => sum + (p.profit_loss || 0), 0);

  console.log(`\n ${"=".repeat(50)}`);
  console.log("📊 RESUMO GERAL:");
  console.log(`  - Total de picks: ${totalPicks}`);
  console.log(
    `  - Taxa de acerto geral: ${((totalWon / totalPicks) * 100).toFixed(1)}%`,
  );
  console.log(`  - Lucro/Prejuízo total: ${totalProfit.toFixed(2)}`);
  console.log(
    `  - ROI geral: ${((totalProfit / (totalPicks * 100)) * 100).toFixed(1)}%`,
  );
  console.log("=".repeat(50));
}

export async function markFinishedPredictions(): Promise<void> {
  const { data: finishedRaces, error } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .select("id")
    .eq("finished", 1)
    .eq("canceled", 0);

  if (error) {
    console.error("Erro ao buscar corridas finalizadas:", error);
    return;
  }

  if (!finishedRaces || finishedRaces.length === 0) return;

  const finishedRaceIds = finishedRaces.map((r) => r.id);

  const { error: updateError } = await supabase
    .schema("hml")
    .from("prediction_enriched_horse_features")
    .update({ prediction_status: "FINISHED" })
    .in("race_id", finishedRaceIds)
    .eq("prediction_status", "PENDING");

  if (updateError) {
    console.error("Erro ao marcar previsões como finalizadas:", updateError);
    return;
  }

  console.log(
    `Previsões marcadas como FINISHED para ${finishedRaceIds.length} corridas finalizadas`,
  );
}
