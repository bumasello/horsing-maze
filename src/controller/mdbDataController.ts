import raceCards from "../functions/mdb_functions/getRaceCard_Hr";
import raceDetails from "../functions/mdb_functions/getRaceDetail_Hr";
import horseStats from "../functions/mdb_functions/getHorseResults_Hr";
import updateData from "../functions/mdb_functions/updateRaceCard_Hr";

import type { Request, Response, NextFunction } from "express";
import updateRaceCard_Hr from "../functions/mdb_functions/updateRaceCard_Hr";

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

const updateRaceCard = async (
  req: Request,
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
  req: Request,
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
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.log("checkRacedetails");
  try {
    await updateData.checkMissingRacedetails_hr();

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
