import { generatePredictions_v4 } from "../../services/ml/claude-prediction-model";
import { trainLayBettingModel } from "../../services/ml/sonnet-claude-training";
import { generateLayBettingPicks } from "../../services/ml/claude-generate-picks";

import type { NextFunction, Request, Response } from "express";

export const training = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const startTime = Date.now();
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
    next(error);
  }
};

export const predictions = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await generatePredictions_v4();
    res.status(200).json({ message: "Previsões geradas com sucesso." });
  } catch (error) {
    next(error);
  }
};

export const layPicks = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await generateLayBettingPicks();
    res.status(200).json({ message: "Previsões armazenadas com sucesso." });
  } catch (error) {
    next(error);
  }
};
