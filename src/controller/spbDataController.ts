import spb from "../spb_functions/populate";
import populateRaceDetail_spb from "../spb_functions/populateRaceDetail_spb";
import type { Request, Response, NextFunction } from "express";

const spbRaceCards = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.log("spbRaceCards");
  await spb.populateRacecards_spb();

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

export default {
  spbRaceCards,
  spbRaceDetail,
};
