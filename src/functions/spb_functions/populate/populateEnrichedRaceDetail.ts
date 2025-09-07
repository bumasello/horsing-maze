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
  // MODIFICAÇÃO TEMPORÁRIA: Buscar corridas com cavalos que têm non_runner ou position null
  console.log(
    "🔧 MODO CORREÇÃO: Buscando cavalos com non_runner ou position null...",
  );

  const { data: horsesWithNulls, error: nullHorsesError } = await supabase
    .schema("hml")
    .from("race_horses_hr_enriched")
    .select("racecard_id, id")
    .or("position.is.null");

  if (nullHorsesError) {
    throw new Error("Erro ao buscar cavalos com campos null no Supabase.");
  }

  if (!horsesWithNulls || horsesWithNulls.length === 0) {
    console.log("✅ Nenhum cavalo com non_runner ou position null encontrado.");
    return;
  }

  console.log(
    `🔧 Encontrados ${horsesWithNulls.length} cavalos com campos null`,
  );

  // Buscar as corridas únicas que têm cavalos com nulls
  const uniqueRacecardIds = [
    ...new Set(horsesWithNulls.map((h) => h.racecard_id)),
  ];

  const { data: unfinishedracecards, error: unfinishedracecardsError } =
    await supabase
      .schema("hml")
      .from("racecards_hr_enriched")
      .select("id, id_race")
      .in("id", uniqueRacecardIds);

  if (unfinishedracecardsError)
    throw new Error("Erro ao carregar corridas com campos null no Supabase.");

  console.log(
    `🔧 Processando ${unfinishedracecards?.length || 0} corridas para correção`,
  );

  for (const race of unfinishedracecards as UnfinishedRaces[]) {
    console.log(`🔧 Processando corrida ${race.id} (${race.id_race})`);

    // Buscar apenas cavalos desta corrida que têm non_runner ou position null
    const { data: raceDetail, error: raceDetailError } = await supabase
      .schema("hml")
      .from("race_horses_hr_enriched")
      .select("id, racecard_id, id_horse")
      .eq("racecard_id", race.id)
      .or("position.is.null");

    if (raceDetailError)
      throw new Error("Erro ao carregar cavalos com campos null no Supabase.");

    if (!raceDetail || raceDetail.length === 0) {
      console.log(
        `✅ Corrida ${race.id}: Nenhum cavalo com campos null encontrado`,
      );
      continue;
    }

    console.log(
      `🔧 Corrida ${race.id}: ${raceDetail.length} cavalos precisam correção`,
    );

    for (const horse of raceDetail as UnfinishedRacesHorse[]) {
      console.log(`🔧 Corrigindo cavalo ${horse.id_horse}...`);
      const raceIds = await getHistoryRaceDetailId(horse.id_horse);

      for (const raceId of raceIds) {
        await insertEnrichedRaceDetail(+raceId);
      }
    }
  }
};
