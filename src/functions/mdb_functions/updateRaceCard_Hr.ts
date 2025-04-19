import dotenv from "dotenv";
import raceCard from "../mdb_functions/getRaceCard_Hr";
import raceDetail from "../mdb_functions/getRaceDetail_Hr";

import RaceCard from "../../models/modelHr/raceCardHrModel";

import type { IRaceCard_Hr } from "../../models/modelHr/raceCardHrModel";
import { IRaceDetail_Hr } from "../../models/modelHr/raceDetailHrModel";

dotenv.config();

const updateRaceCard_Hr = async () => {
  const racecards = await raceCard.getStoredRaceCard_Hr();
  const BATCH_SIZE = 10; // Processar 10 requisições por lote
  const BATCH_DELAY = 60000; // 60 segundos de pausa entre lotes
  const REQUEST_DELAY = 1000; // 1 segundo entre requisições

  for (let i = 0; i < racecards.length; i++) {
    const rc = racecards[i] as IRaceCard_Hr;
    let success = false;
    let retryCount = 0;
    const MAX_RETRIES = 3;
    let waitTime = 5000; // Tempo inicial de espera para retry

    // Tentar a requisição com retry e backoff exponencial
    while (!success && retryCount < MAX_RETRIES) {
      try {
        await raceDetail.getRaceDetailAndStore_Hr(rc.id_race);
        console.log(`Atualizou Racedetail: ${rc.id_race}`);
        success = true;
      } catch (error) {
        retryCount++;
        console.error(
          `Erro ao atualizar race detail ${rc.id_race}, tentativa ${retryCount}:`,
          error,
        );

        if (retryCount < MAX_RETRIES) {
          console.log(
            `Aguardando ${waitTime / 1000} segundos antes de tentar novamente...`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          waitTime *= 2; // Backoff exponencial
        } else {
          console.error(
            `Falha após ${MAX_RETRIES} tentativas para corrida ${rc.id_race}`,
          );
        }
      }
    }

    // Se conseguiu obter os detalhes, atualiza o racecard
    if (success) {
      try {
        const newRaceCard = await raceDetail.getStoredRaceDetail_Hr(rc.id_race);
        if (newRaceCard && newRaceCard.length > 0) {
          const raceDetailData = newRaceCard[0];
          const { horses, ...raceCardData } = raceDetailData as IRaceDetail_Hr;
          await RaceCard.findOneAndUpdate(
            { id_race: rc.id_race },
            raceCardData,
            {
              new: true,
            },
          );
          console.log(`Atualizou Racecard: ${rc.id_race}`);
        }
      } catch (error) {
        console.error(`Erro ao atualizar race card ${rc.id_race}:`, error);
      }
    }

    // Verificar se precisa esperar entre lotes
    if (i < racecards.length - 1) {
      // Espera normal entre requisições
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY));

      // Se estamos no final de um lote, faz uma pausa maior
      if ((i + 1) % BATCH_SIZE === 0) {
        console.log(
          `Completado lote ${Math.floor((i + 1) / BATCH_SIZE)} de ${Math.ceil(racecards.length / BATCH_SIZE)}. Pausando por ${BATCH_DELAY / 1000} segundos...`,
        );
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
      }
    }
  }

  console.log(
    `Processo de atualização concluído para ${racecards.length} corridas.`,
  );
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
  const racecards: IRaceCard_Hr[] = await raceCard.getStoredRaceCard_Hr();

  for (const rc of racecards) {
    const racedetail = await raceDetail.getStoredRaceDetail_Hr(rc.id_race);

    if (!racedetail) {
      console.log(rc);
      // await raceDetail.getRaceDetailAndStore_Hr(rc.id_race);
    }
  }
};

export default {
  updateRaceCard_Hr,
  checkMissingRacecards_hr,
  checkMissingRacedetails_hr,
};
