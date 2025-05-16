import { cl_trainData } from "../functions/tensor_functions/claude_trainData";
import layPick from "../functions/spb_functions/entries/createEntries";

import type { Request, Response, NextFunction } from "express";
import { trainHorseData } from "../functions/tensor_functions/trainHorseData";

const getTrainDataAndCreatePredictions = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.log("tsrTrainData");
  try {
    // await cl_trainData();
    await trainHorseData();

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
  console.log("tsrgetInsertPredictions");
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
