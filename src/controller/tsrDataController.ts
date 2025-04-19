// import { trainData } from "../functions/tensor_functions/trainData";
import type { Request, Response, NextFunction } from "express";
import { cl_trainData } from "../functions/tensor_functions/claude_trainData";

const getPredictions = async (
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

export default {
  getPredictions,
};
