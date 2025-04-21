import { cl_trainData } from "../functions/tensor_functions/claude_trainData";
import layPick from "../functions/spb_functions/entries/createEntries";

import type { Request, Response, NextFunction } from "express";

const getTrainDataAndCreatePredictions = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.log("TrainData");
  try {
    await cl_trainData();

    res.status(200).json({ message: "Previsões geradas com suscesso." });
  } catch (error) {
    next(error);
  }
};

const getInsertPredictions = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.log("getInsertPredictions");
  try {
    await layPick.generateLayPicks();
    res.status(200).json({ message: "Previsões armazendas com suscesso." });
  } catch (error) {
    next(error);
  }
};

export default {
  getTrainDataAndCreatePredictions,
  getInsertPredictions,
};
