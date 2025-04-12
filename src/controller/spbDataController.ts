import populateRaceCard_spb from "../functions/spb_functions/populateRaceCard_spb";
import populateRaceDetail_spb from "../functions/spb_functions/populateRaceDetail_spb";
import populateHorseStats_spb from "../functions/spb_functions/populateHorseStats_spb";

import type { Request, Response, NextFunction } from "express";

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

export default {
  spbRaceCards,
  spbRaceDetail,
  spbHorseStats,
};
