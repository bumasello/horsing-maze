import dotenv from "dotenv";
import raceCard from "../mdb_functions/getRaceCard_Hr";
import raceDetail from "../mdb_functions/getRaceDetail_Hr";

import RaceCard from "../../models/modelHr/raceCardHrModel";

import RaceCardDetailModel_Hr from "../../models/modelHr/raceDetailHrModel";

import type { IRaceDetail_Hr } from "../../models/modelHr/raceDetailHrModel";
import type { IRaceCard_Hr } from "../../models/modelHr/raceCardHrModel";

dotenv.config();

const updateRaceCard_Hr = async () => {
  const racecards = await raceCard.getUnfinishedRaceCard_Hr(true);

  const BATCH_SIZE = 10;
  const BATCH_DELAY = 60000;
  const REQUEST_DELAY = 1000;

  console.log(`Iniciando atualização de ${racecards.length} corridas...`);

  for (let i = 0; i < racecards.length; i++) {
    const rc = racecards[i] as IRaceCard_Hr;

    try {
      // getRaceDetailAndStore_Hr já tem retry interno — não precisa de retry aqui
      await raceDetail.getRaceDetailAndStore_Hr(rc.id_race, true);
      console.log(`Race detail atualizado: ${rc.id_race}`);

      // Busca o detail já salvo para atualizar o RaceCard
      const stored = await raceDetail.getStoredRaceDetail_Hr(rc.id_race);

      if (stored && stored.length > 0) {
        const { _id, horses, ...raceCardData } = stored[0] as IRaceDetail_Hr;

        await RaceCard.findOneAndUpdate(
          { id_race: rc.id_race },
          { $set: { ...raceCardData } }, // bug corrigido
          { new: true },
        );

        console.log(`Race card atualizado: ${rc.id_race}`);
      }
    } catch (error) {
      // getRaceDetailAndStore_Hr já esgotou as tentativas — loga e continua
      console.error(`Falha ao processar corrida ${rc.id_race}:`, error);
    }

    if (i < racecards.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY));

      if ((i + 1) % BATCH_SIZE === 0) {
        const currentBatch = Math.floor((i + 1) / BATCH_SIZE);
        const totalBatches = Math.ceil(racecards.length / BATCH_SIZE);
        console.log(
          `Lote ${currentBatch}/${totalBatches} concluído. Pausando ${BATCH_DELAY / 1000}s...`,
        );
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
      }
    }
  }

  console.log(`Atualização concluída para ${racecards.length} corridas.`);
};

const checkMissingRacecards_hr = async () => {
  const racedetails: IRaceDetail_Hr[] =
    await raceDetail.getAllStoredRaceDetail_Hr();

  for (const rd of racedetails) {
    const { _id, horses, ...rdData } = rd;

    await RaceCard.findOneAndUpdate({ id_race: rdData.id_race }, rdData, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
  }
};

const checkMissingRacedetails_hr = async () => {
  // const racecards: IRaceCard_Hr[] = await raceCard.getStoredRaceCard_Hr();
  const raceIds = await findMissingRaceIds();
  console.log(raceIds);
  // for (const rc of racecards) {
  //   const racedetail = await raceDetail.getStoredRaceDetail_Hr(rc.id_race);
  //   console.log(racedetail);
  //
  //   if (!racedetail) {
  //     console.log(rc);
  //     // await raceDetail.getRaceDetailAndStore_Hr(rc.id_race);
  //   }
  // }
};

export async function findMissingRaceIds(): Promise<number[]> {
  // Todos os id_race já inseridos em RaceCard
  const allRaceIds: number[] = await RaceCard.distinct("id_race");
  // Todos os id_race já inseridos em RaceCardDetail
  const existingRaceIds: number[] =
    await RaceCardDetailModel_Hr.distinct("id_race");

  // Filtra só os que faltam detalhes
  return allRaceIds.filter((id) => !existingRaceIds.includes(id));
}

/**
 * Para cada raceId sem detalhe, tenta buscar da API e armazenar.
 * Se falhar, apenas loga o erro e continua no próximo.
 */
export async function syncMissingRaceDetails(): Promise<void> {
  const missing = await findMissingRaceIds();

  if (missing.length === 0) {
    console.log("Nenhum racecard sem detalhe encontrado.");
    return;
  }

  console.log(missing);
  console.log(
    `Encontrados ${missing.length} racecards sem detalhe. Iniciando sync...`,
  );

  // for (const raceId of missing) {
  //   try {
  //     await raceDetailService.getRaceDetailAndStore_Hr(raceId);
  //     console.log(`✓ Detalhe sincronizado para raceId=${raceId}`);
  //   } catch (err) {
  //     console.error(
  //       `✗ Falha ao sincronizar detalhe para raceId=${raceId}:`,
  //       err,
  //     );
  //   }
  // }

  console.log("Sincronização de detalhes pendentes concluída.");
}

export default {
  updateRaceCard_Hr,
  checkMissingRacecards_hr,
  checkMissingRacedetails_hr,
  syncMissingRaceDetails,
};
