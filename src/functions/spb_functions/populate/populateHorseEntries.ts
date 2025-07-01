import { supabase } from "../../..";

interface Pick {
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

export const generateHorseEntries = async () => {
  try {
    console.log("Iniciando geração de entradas de cavalos com previsões...");

    // 1. Buscar IDs das corridas não finalizadas e não canceladas
    console.log("Buscando IDs de corridas pendentes...");
    const { data: pendingRaces, error: pendingRacesError } = await supabase
      .schema("hml")
      .from("racecards_hr_view")
      .select("id")
      .eq("finished", "0")
      .eq("canceled", "0");

    if (pendingRacesError) {
      throw new Error(
        `Erro ao buscar corridas pendentes: ${pendingRacesError.message}`,
      );
    }

    if (!pendingRaces || pendingRaces.length === 0) {
      console.log(
        "Nenhuma corrida pendente encontrada. Nenhuma entrada será gerada.",
      );
      return;
    }

    const pendingRaceIds = pendingRaces.map((race) => race.id);
    console.log(`Encontradas ${pendingRaceIds.length} corridas pendentes.`);

    // 2. Buscar previsões de cavalos APENAS para as corridas pendentes
    console.log("Buscando previsões de cavalos para corridas pendentes...");
    const { data: predictions, error: predictionsError } = await supabase
      .schema("hml")
      .from("horse_predictions")
      .select("*")
      .in("racecard_id", pendingRaceIds)
      .order("racecard_id", { ascending: true })
      .order("probability", { ascending: false });

    if (predictionsError) {
      throw new Error(`Erro ao buscar previsões: ${predictionsError.message}`);
    }

    if (!predictions || predictions.length === 0) {
      console.log("Nenhuma previsão disponível para as corridas pendentes.");
      return;
    }

    console.log(
      `Encontradas ${predictions.length} previsões para corridas pendentes.`,
    );

    // 3. Extrair IDs únicos de corridas e cavalos das previsões filtradas
    const raceIds = [...new Set(predictions.map((p) => p.racecard_id))];
    const horseIds = [...new Set(predictions.map((p) => p.race_horse_id))];

    console.log(
      `Buscando informações detalhadas para ${raceIds.length} corridas e ${horseIds.length} cavalos...`,
    );

    // 4. Buscar informações detalhadas das corridas (apenas as pendentes)
    const { data: races, error: racesError } = await supabase
      .schema("hml")
      .from("racecards_hr_view")
      .select("*")
      .in("id", raceIds);

    if (racesError) {
      throw new Error(
        `Erro ao buscar detalhes das corridas: ${racesError.message}`,
      );
    }

    // 5. Buscar informações detalhadas dos cavalos (apenas os envolvidos nas previsões filtradas)
    const { data: horses, error: horsesError } = await supabase
      .from("race_horses_hr")
      .select("*")
      .in("id", horseIds);

    if (horsesError) {
      throw new Error(
        `Erro ao buscar detalhes dos cavalos: ${horsesError.message}`,
      );
    }

    if (!races || races.length === 0 || !horses || horses.length === 0) {
      console.log("Dados de corrida ou cavalo incompletos após filtragem.");
      return;
    }

    // 6. Combinar os resultados
    const preds: Pick[] = [];

    for (const prediction of predictions) {
      const race = races.find((r) => r.id === prediction.racecard_id);
      const horse = horses.find((h) => h.id === prediction.race_horse_id);

      if (!race || !horse) {
        console.warn(
          `! Dados incompletos para racecard_id ${prediction.racecard_id}, race_horse_id ${prediction.race_horse_id}. Pulando.`,
        );
        continue;
      }

      preds.push({
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

    console.log(`Combinados ${preds.length} registros com dados completos.`);

    // 7. Agrupar por corrida
    const byRace = new Map<number, Pick[]>();
    for (const p of preds) {
      const arr = byRace.get(p.racecard_id) || [];
      arr.push(p);
      byRace.set(p.racecard_id, arr);
    }

    console.log(`Agrupados em ${byRace.size} corridas distintas.`);

    // 8. Para cada grupo, só insere se tiver exatamente 1 top-pick
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const [racecard_id, group] of byRace.entries()) {
      const topProb = group[0].probability;
      const topGroup = group.filter((p) => p.probability === topProb);

      if (topGroup.length !== 1) {
        console.log(
          `! Corrida ${racecard_id} ignorada por empate (${topGroup.length}).`,
        );
        skipCount++;
        continue;
      }

      const pick = topGroup[0];
      const { error: upErr } = await supabase
        .schema("hml")
        .from("horse_entries")
        .upsert(
          [
            {
              racecard_id: pick.racecard_id,
              race_horse_id: pick.race_horse_id,
              course: pick.course,
              date: pick.date,
              off_time_br: pick.off_time_br,
              title: pick.title,
              horse: pick.horse,
              number: pick.number,
              probability: pick.probability,
            },
          ],
          { onConflict: "racecard_id" },
        );

      if (upErr) {
        console.error(
          `Erro ao inserir lay-pick corrida ${racecard_id}:`,
          upErr,
        );
        errorCount++;
      } else {
        console.log(
          `√ Lay-pick corrida ${racecard_id}: ${pick.horse} (#${pick.number}) — ${(pick.probability * 100).toFixed(1)}%`,
        );
        successCount++;
      }
    }

    console.log("\nResumo da geração de entradas:");
    console.log(`- Total de corridas processadas: ${byRace.size}`);
    console.log(`- Entradas inseridas com sucesso: ${successCount}`);
    console.log(`- Corridas ignoradas por empate: ${skipCount}`);
    console.log(`- Erros de inserção: ${errorCount}`);
    console.log("Geração de entradas concluída.");
  } catch (error) {
    console.error("Erro na geração de entradas:", error);
    throw error;
  }
};
