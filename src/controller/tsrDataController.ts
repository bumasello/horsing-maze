import { cl_trainData } from "../functions/tensor_functions/claude_trainData";
import populateLayPicks from "../functions/spb_functions/populate/populateLayPicks";

import { trainHorseData } from "../functions/tensor_functions/trainHorseData";
import { trainHorseData_v2 } from "../functions/tensor_functions/trainHorseData_v2";

import { generatePredictions } from "../functions/spb_functions/features_v2/generatePredictions";
import { generateHorseEntries } from "../functions/spb_functions/populate/populateHorseEntries";

import type { Request, Response, NextFunction } from "express";

const getTraining = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.log("tsrTrainData");
  try {
    // await cl_trainData();
    // await trainHorseData();
    await trainHorseData_v2();

    res
      .status(200)
      .json({ message: "Treinamento do modelo executado com sucesso." });
  } catch (error) {
    next(error);
  }
};

const getGeneratePredictions = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.log("tsrGeneratePredictions");

  await generatePredictions();

  try {
    res.status(200).json({ message: "Previsões geradas com suscesso." });
  } catch (error) {
    next(error);
  }
};

const getInsertPredictions = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.log("tsrGetInsertPredictions");
  try {
    // await populateLayPicks.generateLayPicks();
    await generateHorseEntries();
    res.status(200).json({ message: "Previsões armazendas com suscesso." });
  } catch (error) {
    next(error);
  }
};

export default {
  getTraining,
  getInsertPredictions,
  getGeneratePredictions,
};
