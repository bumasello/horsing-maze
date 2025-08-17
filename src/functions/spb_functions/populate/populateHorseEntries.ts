import { supabase } from "../../..";
import {
  calculateLayValueIndex,
  getAverageOdd,
} from "../features_v3/utils/bettingLogic";

interface PredictionData {
  racecard_id: number;
  race_horse_id: number;
  probability: number;
  course: string;
  date: string;
  off_time_br: string;
  title: string;
  horse: string;
  number: number;
}

interface ValuePick extends PredictionData {
  ivl: number;
  market_odd: number;
}

export const generateHorseEntries_v3 = async () => {
  try {
    console.log(
      "Iniciando geração de entradas (Lógica Híbrida: Valor + Probabilidade)...",
    );

    // ETAPA 1: COLETAR TODOS OS DADOS (sem alterações)
    const { data: pendingRaces, error: pendingRacesError } = await supabase
      .schema("hml")
      .from("racecards_hr_view")
      .select("id")
      .eq("finished", "0")
      .eq("canceled", "0");
    if (pendingRacesError)
      throw new Error(
        `Erro ao buscar corridas pendentes: ${pendingRacesError.message}`,
      );
    if (!pendingRaces || pendingRaces.length === 0) {
      console.log("Nenhuma corrida pendente encontrada.");
      return;
    }
    const pendingRaceIds = pendingRaces.map((race) => race.id);

    const { data: predictions, error: predictionsError } = await supabase
      .schema("hml")
      .from("horse_predictions")
      .select("*")
      .in("racecard_id", pendingRaceIds);
    if (predictionsError)
      throw new Error(`Erro ao buscar previsões: ${predictionsError.message}`);
    if (!predictions || predictions.length === 0) {
      console.log("Nenhuma previsão disponível para as corridas pendentes.");
      return;
    }

    const raceIds = [...new Set(predictions.map((p) => p.racecard_id))];
    const horseIds = [...new Set(predictions.map((p) => p.race_horse_id))];

    const { data: races, error: racesError } = await supabase
      .schema("hml")
      .from("racecards_hr_view")
      .select("*")
      .in("id", raceIds);
    if (racesError)
      throw new Error(
        `Erro ao buscar detalhes das corridas: ${racesError.message}`,
      );

    const { data: horses, error: horsesError } = await supabase
      .schema("hml")
      .from("race_horses_hr_view")
      .select("*")
      .in("id", horseIds);
    if (horsesError)
      throw new Error(
        `Erro ao buscar detalhes dos cavalos: ${horsesError.message}`,
      );

    if (!races || !horses) {
      console.log("Dados de corrida ou cavalo não encontrados.");
      return;
    }

    const allPredictionsData: PredictionData[] = [];
    for (const prediction of predictions) {
      const race = races.find((r) => r.id === prediction.racecard_id);
      const horse = horses.find((h) => h.id === prediction.race_horse_id);
      if (race && horse) {
        allPredictionsData.push({
          racecard_id: prediction.racecard_id,
          race_horse_id: prediction.race_horse_id,
          probability: prediction.probability,
          course: race.course,
          date: race.date,
          off_time_br: race.off_time_br,
          title: race.title,
          horse: horse.horse,
          number: horse.number,
        });
      }
    }
    console.log(
      `Combinados ${allPredictionsData.length} registros com dados completos.`,
    );

    // ETAPA 2: ANÁLISE HÍBRIDA POR CORRIDA
    console.log("\nAgrupando previsões por corrida para análise...");

    const predictionsByRace = new Map<number, PredictionData[]>();
    for (const pred of allPredictionsData) {
      const group = predictionsByRace.get(pred.racecard_id) || [];
      group.push(pred);
      predictionsByRace.set(pred.racecard_id, group);
    }
    console.log(`Agrupados em ${predictionsByRace.size} corridas distintas.`);

    let successCount = 0;
    let errorCount = 0;

    for (const [racecard_id, racePredictions] of predictionsByRace.entries()) {
      let bestPickInRace: ValuePick | null = null;
      let highestIvlInRace = 0;

      // 2.1. TENTATIVA 1: Encontrar a melhor aposta de VALOR
      for (const pred of racePredictions) {
        const averageOdd = await getAverageOdd(pred.race_horse_id);
        if (!averageOdd) continue;

        const ivl = calculateLayValueIndex(pred.probability, averageOdd);

        if (ivl > highestIvlInRace) {
          const MIN_IVL_THRESHOLD = 1.1;
          const MIN_ODD_THRESHOLD = 4.0;
          const MAX_ODD_THRESHOLD = 34.0;

          if (
            ivl > MIN_IVL_THRESHOLD &&
            averageOdd >= MIN_ODD_THRESHOLD &&
            averageOdd <= MAX_ODD_THRESHOLD
          ) {
            highestIvlInRace = ivl;
            bestPickInRace = { ...pred, ivl: ivl, market_odd: averageOdd };
          }
        }
      }

      let finalPick: PredictionData;
      let pickType: "value" | "probability";

      // 2.2. DECISÃO: Usar a pick de valor ou o fallback?
      if (bestPickInRace) {
        finalPick = bestPickInRace;
        pickType = "value";
        console.log(
          `√ [VALOR] Entrada para corrida ${racecard_id}: ${finalPick.horse} (#${finalPick.number}) | IVL: ${bestPickInRace.ivl.toFixed(2)}`,
        );
      } else {
        // TENTATIVA 2: FALLBACK - Pegar o cavalo com a maior probabilidade
        // Ordena o grupo pela maior probabilidade e pega o primeiro
        const sortedByProb = [...racePredictions].sort(
          (a, b) => b.probability - a.probability,
        );
        finalPick = sortedByProb[0];
        pickType = "probability";
        console.log(
          `- [PROB] Entrada para corrida ${racecard_id}: ${finalPick.horse} (#${finalPick.number}) | P(Não Vencer): ${(finalPick.probability * 100).toFixed(1)}%`,
        );
      }

      // ETAPA 3: Inserir a entrada selecionada (seja de valor ou de probabilidade)
      const { error: upErr } = await supabase
        .schema("hml")
        .from("horse_entries")
        .upsert(
          {
            racecard_id: finalPick.racecard_id,
            race_horse_id: finalPick.race_horse_id,
            course: finalPick.course,
            date: finalPick.date,
            off_time_br: finalPick.off_time_br,
            title: finalPick.title,
            horse: finalPick.horse,
            number: finalPick.number,
            probability: finalPick.probability,
            pick_type: pickType, // Salva o tipo de critério usado
          },
          { onConflict: "racecard_id" },
        );

      if (upErr) {
        console.error(
          `Erro ao inserir entrada para corrida ${racecard_id}:`,
          upErr,
        );
        errorCount++;
      } else {
        successCount++;
      }
    }

    console.log("\nResumo da geração de entradas:");
    console.log(`- Total de corridas processadas: ${predictionsByRace.size}`);
    console.log(`- Entradas inseridas com sucesso: ${successCount}`);
    console.log(`- Corridas com erro de inserção: ${errorCount}`);
    console.log("Geração de entradas concluída.");
  } catch (error) {
    console.error("Erro na geração de entradas:", error);
    throw error;
  }
};
