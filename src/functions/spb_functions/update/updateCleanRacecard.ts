import { supabase } from "../../..";
import RaceCardModel_Hr from "../../../models/modelHr/raceCardHrModel";
import RaceCardDetailModel_Hr from "../../../models/modelHr/raceDetailHrModel";

export const updateCleanRacecard = async () => {
  const { data, error } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .select("id_race")
    .eq("finished", 0)
    .eq("canceled", 0)
    .eq("create_entry", false);

  if (error) {
    throw new Error(`Erro ao buscar corridas não elegíveis: ${error.message}`);
  }

  if (!data || data.length === 0) {
    console.log("Nenhuma corrida para limpar.");
    return;
  }

  console.log(`Limpando ${data.length} corridas não elegíveis...`);

  const raceIds = data.map((rc) => rc.id_race);

  // Deleta do MongoDB em paralelo
  await Promise.all([
    RaceCardModel_Hr.deleteMany({ id_race: { $in: raceIds } }),
    RaceCardDetailModel_Hr.deleteMany({ id_race: { $in: raceIds } }),
  ]);

  console.log(`${raceIds.length} corridas deletadas do MongoDB.`);

  // Deleta do Supabase após confirmar deleção no MongoDB
  const { error: deleteError } = await supabase
    .schema("hml")
    .from("racecards_hr_enriched")
    .delete()
    .in("id_race", raceIds);

  if (deleteError) {
    throw new Error(
      `Erro ao deletar corridas do Supabase: ${deleteError.message}`,
    );
  }

  console.log(`${raceIds.length} corridas deletadas do Supabase.`);
  console.log(`IDs removidos: ${raceIds.join(", ")}`);
};
