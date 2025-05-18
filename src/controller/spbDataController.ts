import populateRaceCard_spb from "../functions/spb_functions/populate/populateRaceCard_spb";
import populateRaceDetail_spb from "../functions/spb_functions/populate/populateRaceDetail_spb";
import populateHorseStats_spb from "../functions/spb_functions/populate/populateHorseStats_spb";
import populateHorseFeature_spb from "../functions/spb_functions/features_v1/populateHorseFeatures";

import { updateRacecards_spb } from "../functions/spb_functions/update/updateRacecard_hr";
import { updateLayPicks_spb } from "../functions/spb_functions/update/updateLayPicks";

import type { Request, Response, NextFunction } from "express";
import debugPopulateHorseFeature_spb from "../functions/debug/dbgPopulateHorseFeature_spb";
import { checkHorseResultLength } from "../functions/spb_functions/entries/checkHorseResultLength";

const spbRaceCards = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    console.log("spbRaceCards");
    await populateRaceCard_spb(next);

    res
      .status(200)
      .json({ message: "Racecards carregados para supabase com sucesso." });
  } catch (error) {
    next(error);
  }
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

    await populateHorseFeature_spb(next);
    // await debugPopulateHorseFeature_spb(256536, next);

    res
      .status(200)
      .json({ message: "HorseFeatures carregados para supabase com sucesso." });
  } catch (error) {
    next(error);
  }
};

const spbCheckCreateEntry = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    console.log("spbCheckCreateEntry");
    await checkHorseResultLength();
    res.status(200).json({
      message:
        "Corridas de cavalos com mais de 3 resultados selecionadas com sucesso.",
    });
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
    console.log("spbUpdateRacecard");
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
  spbCheckCreateEntry,
};
