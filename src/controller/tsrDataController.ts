import { generateHorseEntries_v3 } from "../functions/spb_functions/populate/populateHorseEntries";
import { generatePredictions_v4 } from "../functions/tensor_functions/tensor_v4/ml/claude-prediction-model";
import { trainLayBettingModel } from "../functions/tensor_functions/tensor_v4/ml/sonnet-claude-training";
import { generatePredictions_v3 } from "../functions/spb_functions/features_v3/generatePredictions_v3";

import type { NextFunction, Request, Response } from "express";
import { generateLayBettingPicks } from "../functions/tensor_functions/tensor_v4/ml/claude-generate-picks";

const getTraining = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.log("[Training] Iniciando treinamento do modelo...");

  try {
    const startTime = Date.now();

    // Executar treinamento
    await trainLayBettingModel();

    const timeElapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    res.status(200).json({
      message: "Treinamento do modelo executado com sucesso.",
      details: {
        timeElapsed: `${timeElapsed}s`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[Training] Erro:", error);
    next(error);
  }
};

const getGeneratePredictions = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.log("tsrGeneratePredictions");

  await generatePredictions_v4();

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
    await generateLayBettingPicks();

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
