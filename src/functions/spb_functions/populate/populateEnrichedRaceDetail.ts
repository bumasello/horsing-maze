import { supabase } from "../../..";
import { getHistoryRaceDetailId } from "../../utils/getHistoryRaceDetailId";
import { insertEnrichedRaceDetail } from "../../utils/insertEnrichedRaceDetail";

interface UnfinishedRaces {
  id: number;
  id_race: string;
}

interface UnfinishedRacesHorse {
  id: number;
  racecard_id: number;
  id_horse: number;
}

export const populateEnrichedRaceDetail_spb = async () => {
  const { data: unfinishedracecards, error: unfinishedracecardsError } =
    await supabase
      .schema("hml")
      .from("racecards_hr_enriched")
      .select("id, id_race")
      .eq("finished", "0")
      .eq("canceled", "0");

  if (unfinishedracecardsError)
    throw new Error("Erro ao carregar corridas não finalizadas no Supabase.");

  const totalRaces = unfinishedracecards?.length || 0;
  console.log(
    `🏁 Iniciando processamento de ${totalRaces} corridas não finalizadas`,
  );

  if (totalRaces === 0) {
    console.log("✅ Nenhuma corrida não finalizada encontrada.");
    return;
  }

  let processedRaces = 0;

  for (const race of unfinishedracecards as UnfinishedRaces[]) {
    processedRaces++;
    console.log(
      `\n🏇 [${processedRaces}/${totalRaces}] Processando corrida ID: ${race.id} (Race: ${race.id_race})`,
    );

    const { data: raceDetail, error: raceDetailError } = await supabase
      .schema("hml")
      .from("race_horses_hr_enriched")
      .select("id, racecard_id, id_horse")
      .eq("racecard_id", race.id);

    if (raceDetailError) {
      console.error(
        `❌ Erro ao carregar cavalos da corrida ${race.id}:`,
        raceDetailError,
      );
      throw new Error(
        "Erro ao carregar detalhes de corridas não finalizadas no Supabase.",
      );
    }

    const totalHorses = raceDetail?.length || 0;
    console.log(`   🐎 Total de cavalos nesta corrida: ${totalHorses}`);

    if (totalHorses === 0) {
      console.log(
        `   ! Nenhum cavalo encontrado para a corrida ${race.id}, pulando...`,
      );
      continue;
    }

    let processedHorses = 0;

    for (const horse of raceDetail as UnfinishedRacesHorse[]) {
      processedHorses++;
      console.log(
        `   🐴 [${processedHorses}/${totalHorses}] Processando cavalo ID: ${horse.id_horse}`,
      );

      try {
        const raceIds = await getHistoryRaceDetailId(horse.id_horse);

        const totalHistoricRaces = raceIds.length;
        console.log(
          `      📊 Encontradas ${totalHistoricRaces} corridas históricas para este cavalo`,
        );

        let processedHistoricRaces = 0;
        let insertedHistoricRaces = 0;
        let skippedHistoricRaces = 0;

        for (const raceId of raceIds) {
          processedHistoricRaces++;

          // Verificar se o race detail já existe no Supabase
          const { data: existingRace } = await supabase
            .schema("hml")
            .from("racecards_hr_enriched")
            .select("id")
            .eq("id_race", raceId.toString())
            .single();

          if (!existingRace) {
            await insertEnrichedRaceDetail(+raceId);
            insertedHistoricRaces++;
            console.log(
              `      ✅ [${processedHistoricRaces}/${totalHistoricRaces}] Race ID ${raceId} inserida com sucesso`,
            );
          } else {
            skippedHistoricRaces++;
            console.log(
              `      ⏭ [${processedHistoricRaces}/${totalHistoricRaces}] Race ID ${raceId} já existe, pulando...`,
            );
          }
        }

        console.log(
          `      📈 Cavalo ${horse.id_horse}: ${insertedHistoricRaces} inseridas, ${skippedHistoricRaces} puladas de ${totalHistoricRaces} total`,
        );
      } catch (error) {
        console.error(
          `      ❌ Erro ao processar histórico do cavalo ${horse.id_horse}:`,
          error,
        );
        // Continua processando os outros cavalos mesmo se um falhar
      }
    }

    const racesRemaining = totalRaces - processedRaces;
    const progressPercentage = ((processedRaces / totalRaces) * 100).toFixed(1);
    console.log(
      `\n📊 Progresso: ${processedRaces}/${totalRaces} corridas (${progressPercentage}%) | Restam: ${racesRemaining} corridas`,
    );
  }

  console.log(
    `\n🎉 Processamento concluído! Total de ${totalRaces} corridas processadas.`,
  );
};
