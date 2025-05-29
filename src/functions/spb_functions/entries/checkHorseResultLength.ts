import { supabase } from "../../..";

export const checkHorseResultLength = async () => {
  console.log("Iniciando verificação de elegibilidade de corridas...");

  // Buscar corridas não finalizadas
  const { data: unfinishedRaceCards, error: raceCardError } = await supabase
    .from("racecards_hr")
    .select("id")
    .eq("finished", "0");

  if (raceCardError) {
    throw new Error(
      `Erro ao buscar corridas não finalizadas: ${raceCardError.message}`,
    );
  }

  if (!unfinishedRaceCards || unfinishedRaceCards.length === 0) {
    console.log("Nenhuma corrida não finalizada encontrada.");
    return;
  }

  console.log(
    `Processando ${unfinishedRaceCards.length} corridas não finalizadas.`,
  );

  // Arrays para armazenar IDs de corridas a serem atualizadas
  const eligibleRaceIds: number[] = [];
  const nonEligibleRaceIds: number[] = [];

  // Verificar cada corrida não finalizada
  for (const racecard of unfinishedRaceCards) {
    const racecardId = racecard.id;

    // Buscar cavalos participantes da corrida
    const { data: horses, error: horsesError } = await supabase
      .from("race_horses_hr")
      .select("id_horse")
      .eq("racecard_id", racecardId);

    if (horsesError) {
      throw new Error(
        `Erro ao buscar cavalos da corrida ${racecardId}: ${horsesError.message}`,
      );
    }

    if (!horses || horses.length === 0) {
      console.log(
        `Corrida ${racecardId} não tem cavalos registrados. Ignorando.`,
      );
      continue;
    }

    console.log(
      `Corrida ${racecardId}: Verificando ${horses.length} cavalos...`,
    );

    // Extrair IDs dos cavalos
    const horseIds = horses.map((h) => h.id_horse).filter((id) => id !== null);

    if (horseIds.length === 0) {
      console.log(
        `Corrida ${racecardId}: Nenhum ID de cavalo válido encontrado. Marcando como não elegível.`,
      );
      nonEligibleRaceIds.push(racecardId);
      continue;
    }

    // Buscar estatísticas dos cavalos diretamente usando result_count
    const { data: horseStats, error: statsError } = await supabase
      .from("horse_stats_hr")
      .select("id_horse, result_count")
      .in("id_horse", horseIds);

    if (statsError) {
      throw new Error(
        `Erro ao buscar estatísticas dos cavalos para corrida ${racecardId}: ${statsError.message}`,
      );
    }

    if (!horseStats || horseStats.length === 0) {
      console.log(
        `Corrida ${racecardId}: Nenhuma estatística encontrada para os cavalos. Marcando como não elegível.`,
      );
      nonEligibleRaceIds.push(racecardId);
      continue;
    }

    // Verificar se todos os cavalos têm pelo menos 3 resultados
    const statsMap = new Map(
      horseStats.map((stat) => [stat.id_horse, stat.result_count]),
    );
    let allHorsesQualified = true;
    const missingStats = [];

    for (const horseId of horseIds) {
      const resultCount = statsMap.get(horseId);

      // Log detalhado para cada cavalo
      console.log(
        `Cavalo ID ${horseId}: ${resultCount !== undefined ? resultCount : "sem estatísticas"} resultados`,
      );

      if (resultCount === undefined || resultCount < 3) {
        allHorsesQualified = false;
        missingStats.push(horseId);
      }
    }

    if (allHorsesQualified) {
      console.log(
        `Corrida ${racecardId}: Todos os cavalos têm pelo menos 3 resultados. Marcando como elegível.`,
      );
      eligibleRaceIds.push(racecardId);
    } else {
      console.log(
        `Corrida ${racecardId}: Cavalos sem estatísticas suficientes: ${missingStats.join(", ")}. Marcando como não elegível.`,
      );
      nonEligibleRaceIds.push(racecardId);
    }
  }

  // Atualizar corridas elegíveis (create_entry: true)
  if (eligibleRaceIds.length > 0) {
    const { error: updateEligibleError } = await supabase
      .from("racecards_hr")
      .update({ create_entry: true })
      .in("id", eligibleRaceIds);

    if (updateEligibleError) {
      throw new Error(
        `Erro ao marcar corridas como elegíveis: ${updateEligibleError.message}`,
      );
    }
    console.log(
      `${eligibleRaceIds.length} corridas marcadas como elegíveis (create_entry: true).`,
    );
    console.log(`IDs das corridas elegíveis: ${eligibleRaceIds.join(", ")}`);
  }

  // Atualizar corridas não elegíveis (create_entry: false)
  if (nonEligibleRaceIds.length > 0) {
    const { error: updateNonEligibleError } = await supabase
      .from("racecards_hr")
      .update({ create_entry: false })
      .in("id", nonEligibleRaceIds);

    if (updateNonEligibleError) {
      throw new Error(
        `Erro ao marcar corridas como não elegíveis: ${updateNonEligibleError.message}`,
      );
    }
    console.log(
      `${nonEligibleRaceIds.length} corridas marcadas como não elegíveis (create_entry: false).`,
    );
    console.log(
      `IDs das corridas não elegíveis: ${nonEligibleRaceIds.join(", ")}`,
    );
  }

  console.log("Processamento concluído com sucesso.");
};
