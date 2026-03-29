import { supabase } from "../..";

export const checkHorseResultLength = async () => {
  console.log("Iniciando verificação de elegibilidade de corridas...");

  const { data: unfinishedRaceCards, error: raceCardError } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .select("id")
    .eq("finished", 0);

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

  const racecardIds = unfinishedRaceCards.map((rc) => rc.id);

  // Busca todos os cavalos de todas as corridas de uma vez
  const { data: allHorses, error: horsesError } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select("racecard_id, id_horse")
    .in("racecard_id", racecardIds);

  if (horsesError) {
    throw new Error(
      `Erro ao buscar cavalos das corridas: ${horsesError.message}`,
    );
  }

  // Agrupa cavalos por corrida em memória
  const horsesByRace = new Map<number, number[]>();
  for (const h of allHorses || []) {
    if (!h.id_horse) continue;
    const group = horsesByRace.get(h.racecard_id) || [];
    group.push(h.id_horse);
    horsesByRace.set(h.racecard_id, group);
  }

  // Coleta todos os id_horse únicos para buscar stats de uma vez
  const allHorseIds = [
    ...new Set((allHorses || []).map((h) => h.id_horse).filter(Boolean)),
  ];

  const { data: allHorseStats, error: statsError } = await supabase
    .schema("hml")
    .from("horse_stats_enriched")
    .select("id_horse, result_count")
    .in("id_horse", allHorseIds);

  if (statsError) {
    throw new Error(
      `Erro ao buscar estatísticas dos cavalos: ${statsError.message}`,
    );
  }

  // Map de stats em memória
  const statsMap = new Map(
    (allHorseStats || []).map((stat) => [stat.id_horse, stat.result_count]),
  );

  const eligibleRaceIds: number[] = [];
  const nonEligibleRaceIds: number[] = [];

  for (const racecard of unfinishedRaceCards) {
    const racecardId = racecard.id;
    const horseIds = horsesByRace.get(racecardId) || [];

    if (horseIds.length === 0) {
      console.log(
        `Corrida ${racecardId} sem cavalos registrados. Marcando como não elegível.`,
      );
      nonEligibleRaceIds.push(racecardId);
      continue;
    }

    const missingStats: number[] = [];

    for (const horseId of horseIds) {
      const resultCount = statsMap.get(horseId);
      if (resultCount === undefined || resultCount < 3) {
        missingStats.push(horseId);
      }
    }

    if (missingStats.length === 0) {
      console.log(`Corrida ${racecardId}: todos os cavalos elegíveis.`);
      eligibleRaceIds.push(racecardId);
    } else {
      console.log(
        `Corrida ${racecardId}: cavalos sem estatísticas suficientes: ${missingStats.join(", ")}.`,
      );
      nonEligibleRaceIds.push(racecardId);
    }
  }

  // Atualiza elegíveis e não elegíveis em paralelo
  await Promise.all([
    eligibleRaceIds.length > 0
      ? supabase
          .schema("hml")
          .from("racecards_hr_enriched")
          .update({ create_entry: true })
          .in("id", eligibleRaceIds)
          .then(({ error }) => {
            if (error)
              throw new Error(
                `Erro ao marcar corridas elegíveis: ${error.message}`,
              );
            console.log(
              `${eligibleRaceIds.length} corridas marcadas como elegíveis.`,
            );
          })
      : Promise.resolve(),

    nonEligibleRaceIds.length > 0
      ? supabase
          .schema("hml")
          .from("racecards_hr_enriched")
          .update({ create_entry: false })
          .in("id", nonEligibleRaceIds)
          .then(({ error }) => {
            if (error)
              throw new Error(
                `Erro ao marcar corridas não elegíveis: ${error.message}`,
              );
            console.log(
              `${nonEligibleRaceIds.length} corridas marcadas como não elegíveis.`,
            );
          })
      : Promise.resolve(),
  ]);

  console.log("Verificação de elegibilidade concluída com sucesso.");
};
