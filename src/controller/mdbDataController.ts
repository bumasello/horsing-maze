import raceCards from "../functions/mdb_functions/getRaceCard_Hr";
import raceDetails from "../functions/mdb_functions/getRaceDetail_Hr";
import horseStats from "../functions/mdb_functions/getHorseResults_Hr";

import type { Request, Response, NextFunction } from "express";

const getRaceCards = async (
  req: Request,
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
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const racecards = await raceCards.getStoredRaceCard_Hr();

    for (const rc of racecards) {
      await raceDetails.getRaceDetailAndStore_Hr(rc.id_race);
    }

    res.status(200).json({ message: "Racecards details obtidos com sucesso." });
  } catch (error) {
    next(error);
  }
};

const getHorseStats = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const racecards = await raceCards.getStoredRaceCard_Hr();

    if (!racecards) {
      throw new Error("Não encontramos corridas não iniciadas.");
    }

    await horseStats.getHorseStatsAndStore_hr(racecards);

    res.status(200).json({ message: "Horse stats obtidos com sucesso." });
  } catch (error) {
    next(error);
  }
};

export default { getRaceCards, getRaceCardsDetails, getHorseStats };
