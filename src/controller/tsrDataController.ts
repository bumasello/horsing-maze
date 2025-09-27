import { generatePredictions_v3 } from "../functions/spb_functions/features_v3/generatePredictions_v3";
import { generateHorseEntries_v3 } from "../functions/spb_functions/populate/populateHorseEntries";
import { trainLayBettingModel } from "../functions/tensor_functions/tensor_v4/ml/claude-training-model";

import type { NextFunction, Request, Response } from "express";

const getTraining = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.log("tsrTrainData");
  try {
    await trainLayBettingModel();

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

  await generatePredictions_v3();

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
    await generateHorseEntries_v3();

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
