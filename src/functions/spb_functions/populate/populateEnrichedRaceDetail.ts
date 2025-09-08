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

  // console.log(unfinishedracecards);

  for (const race of unfinishedracecards as UnfinishedRaces[]) {
    // console.log(race.id);
    const { data: raceDetail, error: raceDetailError } = await supabase
      .schema("hml")
      .from("race_horses_hr_enriched")
      .select("id, racecard_id, id_horse")
      .eq("racecard_id", race.id);

    if (raceDetailError)
      throw new Error(
        "Erro ao carregar detalhes de corridas não finalizadas no Supabase.",
      );

    for (const horse of raceDetail as UnfinishedRacesHorse[]) {
      // console.log(horse.id_horse);
      const raceIds = await getHistoryRaceDetailId(horse.id_horse);

      for (const raceId of raceIds) {
        // Verificar se o race detail já existe no Supabase
        const { data: existingRace } = await supabase
          .schema("hml")
          .from("racecards_hr_enriched")
          .select("id")
          .eq("id_race", raceId.toString())
          .single();

        if (!existingRace) {
          await insertEnrichedRaceDetail(+raceId);
        } else {
          console.log(`Race ID ${raceId} já existe, pulando...`);
        }
      }
    }
  }
};

export const populateEnrichedRaceDetail_teste = async () => {
  console.log(
    "🔧 MODO CORREÇÃO: Buscando cavalos com position null em corridas finalizadas...",
  );

  // Buscar cavalos com position null que estão em corridas finalizadas (finished = 1)
  const { data: horsesWithNulls, error: nullHorsesError } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select(
      `
      id,
      racecard_id,
      id_horse,
      horse,
      position,
      non_runner,
      racecards_hr_enriched!inner (
        id,
        id_race,
        finished,
        date,
        course
      )
    `,
    )
    .is("position", null)
    .eq("racecards_hr_enriched.finished", 1);

  if (nullHorsesError) {
    console.error("Erro ao buscar cavalos:", nullHorsesError);
    throw new Error(
      "Erro ao buscar cavalos com position null em corridas finalizadas.",
    );
  }

  if (!horsesWithNulls || horsesWithNulls.length === 0) {
    console.log(
      "✅ Nenhum cavalo com position null em corridas finalizadas encontrado.",
    );
    return;
  }

  console.log(
    `🔧 Encontrados ${horsesWithNulls.length} cavalos com position null em corridas finalizadas`,
  );

  // Agrupar cavalos por racecard_id para processar por corrida
  const horsesByRacecard = horsesWithNulls.reduce(
    (acc, horse) => {
      const racecardId = horse.racecard_id;
      if (!acc[racecardId]) {
        acc[racecardId] = {
          racecard: horse.racecards_hr_enriched,
          horses: [],
        };
      }
      acc[racecardId].horses.push(horse);
      return acc;
    },
    {} as Record<number, { racecard: any; horses: any[] }>,
  );

  const totalRaces = Object.keys(horsesByRacecard).length;
  console.log(
    `📊 Total de corridas finalizadas com cavalos sem position: ${totalRaces}`,
  );

  // Processar cada corrida
  let raceCount = 0;
  for (const [racecardId, data] of Object.entries(horsesByRacecard)) {
    raceCount++;
    const racecard = data.racecard;
    const horses = data.horses;

    console.log(`\n🏇 [${raceCount}/${totalRaces}] Processando corrida:`);
    console.log(`   📍 Racecard ID: ${racecardId}`);
    console.log(`   🏁 Race ID: ${racecard.id_race}`);
    console.log(`   📅 Data: ${racecard.date}`);
    console.log(`   🏟  Local: ${racecard.course}`);
    console.log(`   🐎 Cavalos com position null: ${horses.length}`);

    // Verificar se o race detail já existe no Supabase
    const { data: existingRace } = await supabase
      .schema("hml")
      .from("racecards_hr_enriched")
      .select("id")
      .eq("id_race", racecard.id_race.toString())
      .single();

    if (existingRace) {
      console.log(`   ⏭  Race ID ${racecard.id_race} já existe, pulando...`);
      continue;
    }

    // Processar a corrida inteira uma vez (vai atualizar todos os cavalos)
    try {
      console.log(`   ⏳ Buscando dados atualizados da API...`);
      await insertEnrichedRaceDetail(+racecard.id_race);
      console.log(`   ✅ Corrida ${racecard.id_race} processada com sucesso!`);
    } catch (error) {
      console.error(
        `   ❌ Erro ao processar corrida ${racecard.id_race}:`,
        error,
      );

      // Opcionalmente, você pode querer processar cavalos individualmente se a corrida falhar
      console.log(`   🔄 Tentando processar cavalos individualmente...`);
      for (const horse of horses) {
        try {
          console.log(
            `      🐎 Processando cavalo ${horse.id_horse} (${horse.horse})...`,
          );
          const raceIds = await getHistoryRaceDetailId(horse.id_horse);

          if (raceIds && raceIds.length > 0) {
            // Processar apenas a corrida específica que tem o problema
            const targetRaceId = raceIds.find((id) => id === racecard.id_race);
            if (targetRaceId) {
              // Verificar novamente antes de processar individualmente
              const { data: existingIndividualRace } = await supabase
                .schema("hml")
                .from("racecards_hr_enriched")
                .select("id")
                .eq("id_race", targetRaceId.toString())
                .single();

              if (!existingIndividualRace) {
                await insertEnrichedRaceDetail(+targetRaceId);
                console.log(`      ✅ Cavalo ${horse.id_horse} processado`);
              } else {
                console.log(`      ⏭  Race ID ${targetRaceId} já existe, pulando cavalo...`);
              }
            } else {
              console.log(
                `      ! Race ID ${racecard.id_race} não encontrado no histórico do cavalo ${horse.id_horse}`,
              );
            }
          }
        } catch (horseError) {
          console.error(
            `      ❌ Erro ao processar cavalo ${horse.id_horse}:`,
            horseError,
          );
        }
      }
    }
  }
};
