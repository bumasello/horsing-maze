import populateRaceCard_spb from "../functions/spb_functions/populate/populateRaceCard_spb";
import populateRaceDetail_spb from "../functions/spb_functions/populate/populateRaceDetail_spb";
import populateHorseStats_spb from "../functions/spb_functions/populate/populateHorseStats_spb";
import populateHorseFeature_spb from "../functions/spb_functions/populate/populateHorseFeatures";

import type { Request, Response, NextFunction } from "express";
import { updateRacecards_spb } from "../functions/spb_functions/update/racecard_hr";

const spbRaceCards = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  await populateRaceCard_spb(next);

  res
    .status(200)
    .json({ message: "Racecards carregados para supabase com sucesso." });
};

const spbRaceDetail = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    console.log("spbRaceDetail");
    await populateRaceDetail_spb();
  } catch (error) {
    next(error);
  }
  res
    .status(200)
    .json({ message: "RaceDetails carregados para supabase com sucesso." });
};

const spbHorseStats = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    console.log("spbHorseStats");
    await populateHorseStats_spb(next);
  } catch (error) {
    next(error);
  }
  res
    .status(200)
    .json({ message: "HorseStats carregados para supabase com sucesso." });
};

const spbHorseFeatures = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    console.log("spbHorseFeatures");

    await populateHorseFeature_spb(next);

    res
      .status(200)
      .json({ message: "HorseFeatures carregados para supabase com sucesso." });
  } catch (error) {
    next(error);
  }
};

const spbUpdateRacecard = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await updateRacecards_spb(next);

    res
      .status(200)
      .json({ message: "Racecards atualizados no supabase com sucesso." });
  } catch (error) {
    next(error);
  }
};

export default {
  spbRaceCards,
  spbRaceDetail,
  spbHorseStats,
  spbHorseFeatures,
  spbUpdateRacecard,
};
