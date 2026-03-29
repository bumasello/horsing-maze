import horseStats from "../../integrations/mongodb/getHorseResults_Hr";
import raceCards from "../../integrations/mongodb/getRaceCard_Hr";
import raceDetails from "../../integrations/mongodb/getRaceDetail_Hr";
import updateData from "../../integrations/mongodb/updateRaceCard_Hr";

import type { NextFunction, Request, Response } from "express";
import type { IRaceCard_Hr } from "../../models/modelHr/raceCardHrModel";

export const getRaceCards = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const formatted = tomorrowDate.toISOString().slice(0, 10);
    const inseridos = await raceCards.getRaceCardAndStore_Hr(formatted);
    res
      .status(200)
      .json({ message: "Racecards obtidos com sucesso.", inseridos });
  } catch (error) {
    next(error);
  }
};

export const getRaceCardsDetails = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const racecards = await raceCards.getUnfinishedRaceCard_Hr(false);
    const BATCH_SIZE = 10;
    const BATCH_DELAY = 60000;
    const REQUEST_DELAY = 2000;

    for (let i = 0; i < racecards.length; i++) {
      const rc = racecards[i] as IRaceCard_Hr;
      let success = false;
      let retryCount = 0;
      const MAX_RETRIES = 3;
      let waitTime = 5000;

      while (!success && retryCount < MAX_RETRIES) {
        try {
          await raceDetails.getRaceDetailAndStore_Hr(rc.id_race);
          success = true;
        } catch (error) {
          retryCount++;
          if (retryCount < MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            waitTime *= 2;
          }
        }
      }

      if (i < racecards.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY));
        if ((i + 1) % BATCH_SIZE === 0) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
        }
      }
    }

    res.status(200).json({ message: "Racecards details obtidos com sucesso." });
  } catch (error) {
    next(error);
  }
};

export const getHorseStats = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const racecards = await raceCards.getUnfinishedRaceCard_Hr(true);
    if (!racecards) throw new Error("Não encontramos corridas não iniciadas.");
    await horseStats.getHorseStatsAndStore_hr(racecards);
    res.status(200).json({ message: "Horse stats obtidos com sucesso." });
  } catch (error) {
    next(error);
  }
};

export const updateRaceCard = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await updateData.updateRaceCard_Hr();
    res.status(200).json({ message: "Racecards atualizados com sucesso." });
  } catch (error) {
    next(error);
  }
};

export const checkRacecards = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await updateData.checkMissingRacecards_hr();
    res.status(200).json({ message: "Racecards checados com sucesso." });
  } catch (error) {
    next(error);
  }
};

export const checkRacedetails = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await updateData.syncMissingRaceDetails();
    res.status(200).json({ message: "Racedetails checados com sucesso." });
  } catch (error) {
    next(error);
  }
};
