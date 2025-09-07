import { populateRacecards_spb } from "../functions/spb_functions/populate/populateRaceCard_spb";
import { populateRaceDetail_spb } from "../functions/spb_functions/populate/populateRaceDetail_spb";
import { populateHorseStats_spb } from "../functions/spb_functions/populate/populateHorseStats_spb";

import { updateRacecards_spb } from "../functions/spb_functions/update/updateRacecard_hr";
import { updateHorseEntries_spb } from "../functions/spb_functions/update/updateLayPicks";

import type { Request, Response, NextFunction } from "express";
import { checkHorseResultLength } from "../functions/spb_functions/entries/checkHorseResultLength";
import { updateCleanRacecard } from "../functions/spb_functions/update/updateCleanRacecard";
import { generateTrainingFeatures_v3 } from "../functions/spb_functions/features_v3/generateTrainingFeatures";
import { generatePredictionFeatures_v3 } from "../functions/spb_functions/features_v3/generatePredictionFeatures";
import { populateRacecardsEnriched_spb } from "../functions/spb_functions/populate/populateRaceCard_spb_enriched";
import { populateEnrichedRaceDetail_spb } from "../functions/spb_functions/populate/populateEnrichedRaceDetail";

const spbRaceCards = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    console.log("spbRaceCards");
    await populateRacecardsEnriched_spb();

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
    // await populateRaceDetail_spb();
    await populateEnrichedRaceDetail_spb();
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
    // await populateHorseStats_spb();
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

    await generateTrainingFeatures_v3();
    await generatePredictionFeatures_v3();

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
    await updateCleanRacecard();
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
    await updateRacecards_spb();
    // await updateHorseEntries_spb();

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
