import raceCards from "../functions/mdb_functions/getRaceCard_Hr.ts";
import raceDetails from "../functions/mdb_functions/getRaceDetail_Hr.ts";
import horseStats from "../functions/mdb_functions/getHorseResults_Hr.ts";
import updateData from "../functions/mdb_functions/updateRaceCard_Hr.ts";

import type { Request, Response, NextFunction } from "express";
import type { IRaceCard_Hr } from "../models/modelHr/raceCardHrModel.ts";
import {
  dbgGetRaceDetailAndStore_Hr,
  teste,
} from "../functions/debug/dbgGetRaceDetail_hr.ts";

const getRaceCards = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate());

  const formatted = tomorrowDate.toISOString().slice(0, 10);

  try {
    await raceCards.getRaceCardAndStore_Hr(formatted);

    res.status(200).json({ message: "Racecards obtidos com sucesso." });
  } catch (error) {
    next(error);
  }
};

const getRaceCardsDetails = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const racecards = await raceCards.getUnfinishedRaceCard_Hr(true);

    const BATCH_SIZE = 10; // Processar 10 requisições por lote
    const BATCH_DELAY = 60000; // 60 segundos de pausa entre lotes
    const REQUEST_DELAY = 2000; // 1 segundo entre requisições

    for (let i = 0; i < racecards.length; i++) {
      const rc = racecards[i] as IRaceCard_Hr;
      let success = false;
      let retryCount = 0;
      const MAX_RETRIES = 3;
      let waitTime = 5000; // Tempo inicial de espera para retry

      while (!success && retryCount < MAX_RETRIES) {
        try {
          await raceDetails.getRaceDetailAndStore_Hr(rc.id_race);
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
            waitTime *= 2;
          } else {
            console.error(
              `Falha após ${MAX_RETRIES} tentativas para corrida ${rc.id_race}`,
            );
          }
        }
      }
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

    res.status(200).json({ message: "Racecards details obtidos com sucesso." });
  } catch (error) {
    next(error);
  }
};

const dbgGetRaceDetail = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  await dbgGetRaceDetailAndStore_Hr();
  res.status(200).json({ message: "Racecards atualizados com sucesso." });
};

// Pegar o histórico do cavalo gasta muitas requisições. Aguardar ter uma Api ilimitate para utilizar esse recurso.
const getHorseStats = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const racecards = await raceCards.getUnfinishedRaceCard_Hr(true);

    if (!racecards) {
      throw new Error("Não encontramos corridas não iniciadas.");
    }

    await horseStats.getHorseStatsAndStore_hr(racecards);

    res.status(200).json({ message: "Horse stats obtidos com sucesso." });
  } catch (error) {
    next(error);
  }
};

const updateRaceCard = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.log("updateRaceCard");
  try {
    await updateData.updateRaceCard_Hr();

    res.status(200).json({ message: "Racecards atualizados com sucesso." });
  } catch (error) {
    next(error);
  }
};

const checkRacecards = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.log("checkRacecards");
  try {
    await updateData.checkMissingRacecards_hr();

    res.status(200).json({ message: "Racecards checados com sucesso." });
  } catch (error) {
    next(error);
  }
};

const checkRacedetails = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.log("checkRacedetails");
  try {
    await updateData.syncMissingRaceDetails();

    res.status(200).json({ message: "Racedetails checados com sucesso." });
  } catch (error) {
    next(error);
  }
};

export default {
  getRaceCards,
  getRaceCardsDetails,
  getHorseStats,
  updateRaceCard,
  checkRacecards,
  checkRacedetails,
};
