import populateRaceCard_spb from "../functions/spb_functions/populate/populateRaceCard_spb.ts";
import populateRaceDetail_spb from "../functions/spb_functions/populate/populateRaceDetail_spb.ts";
import populateHorseStats_spb from "../functions/spb_functions/populate/populateHorseStats_spb.ts";
import populateHorseFeature_spb from "../functions/spb_functions/populate/populateHorseFeatures.ts";

import { updateRacecards_spb } from "../functions/spb_functions/update/racecard_hr.ts";
import { updateLayPicks_spb } from "../functions/spb_functions/update/lay_picks.ts";

import type { Request, Response, NextFunction } from "express";
import debugPopulateHorseFeature_spb from "../functions/debug/dbgPopulateHorseFeature_spb.ts";

const spbRaceCards = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  await populateRaceCard_spb(next);

  res
    .status(200)
    .json({ message: "Racecards carregados para supabase com sucesso." });
};

const spbRaceDetail = async (
  _req: Request,
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
  _req: Request,
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
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    console.log("spbHorseFeatures");

    // await populateHorseFeature_spb(next);
    await debugPopulateHorseFeature_spb(256536, next);

    res
      .status(200)
      .json({ message: "HorseFeatures carregados para supabase com sucesso." });
  } catch (error) {
    next(error);
  }
};

const spbUpdateRacecard = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await updateRacecards_spb(next);
    await updateLayPicks_spb(next);

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
