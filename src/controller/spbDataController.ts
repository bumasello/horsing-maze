import { populateRaceDetail_spb } from "../functions/spb_functions/populate/populateRaceDetail_spb";
import { populateHorseStats_spb } from "../functions/spb_functions/populate/populateHorseStats_spb";
import { populateRacecardsEnriched_spb } from "../functions/spb_functions/populate/populateRaceCard_spb_enriched";
import { populateEnrichedRaceDetail_spb } from "../functions/spb_functions/populate/populateEnrichedRaceDetail";
import { checkHorseResultLength } from "../functions/spb_functions/entries/checkHorseResultLength";
import { updateCleanRacecard } from "../functions/spb_functions/update/updateCleanRacecard";
import {
  generatePredictionFeatures_v4,
  generateTrainingFeatures_v4,
} from "../functions/spb_functions/features_v4/pipeline/feature-orchestrator";
import {
  updateLayBettingResults,
  updateRacecardsAndDetails,
} from "../functions/spb_functions/features_v4/pipeline/update_results";

import type { Request, Response, NextFunction } from "express";
import { supabase } from "..";

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
    await populateRaceDetail_spb();
    res
      .status(200)
      .json({ message: "RaceDetails carregados para supabase com sucesso." });
  } catch (error) {
    next(error);
  }
};

const spbHorseStats = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    console.log("spbHorseStats");
    await populateHorseStats_spb();
    res
      .status(200)
      .json({ message: "HorseStats carregados para supabase com sucesso." });
  } catch (error) {
    next(error);
  }
};

const spbEnrichedDetails = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    console.log("spbEnrichedDetails");
    await populateEnrichedRaceDetail_spb();
    res.status(200).json({
      message: "Enriched horse stats carregados para supabase com sucesso.",
    });
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

const spbHorseFeatures = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // PARTE 1: FEATURES DE TREINO
    console.log("[V4] Starting training feature generation...");

    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 2);

    console.log(
      `[V4] Training period: ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    const trainingResult = await generateTrainingFeatures_v4(
      supabase,
      startDate,
      endDate,
      {
        mode: "training",
        batchSize: 50,
        saveToDatabase: true,
        minQualityScore: 0.7,
      },
    );

    console.log(
      `[V4] Training complete: ${trainingResult.racesProcessed} races, ${trainingResult.featuresGenerated} features`,
    );

    // PARTE 2: FEATURES DE PREDICAO
    console.log("[V4] Starting prediction feature generation...");

    const { data: upcomingRaces, error } = await supabase
      .schema("hml")
      .from("racecards_hr_enriched")
      .select("id_race")
      .eq("finished", 0)
      .eq("canceled", 0);

    if (error) {
      throw error;
    }

    if (!upcomingRaces || upcomingRaces.length === 0) {
      console.log("[V4] No upcoming races found for prediction");
      res.status(200).json({
        message: "HorseFeatures carregados para supabase com sucesso.",
        details: {
          training: {
            racesProcessed: trainingResult.racesProcessed,
            featuresGenerated: trainingResult.featuresGenerated,
          },
          prediction: { message: "No upcoming races to process" },
        },
      });
      return;
    }

    const raceIds = upcomingRaces.map((r) => r.id_race);
    console.log(`[V4] Found ${raceIds.length} upcoming races`);

    const predictionFeatures = await generatePredictionFeatures_v4(
      supabase,
      raceIds,
      {
        mode: "prediction",
        saveToDatabase: true,
        minQualityScore: 0.5,
      },
    );

    console.log(
      `[V4] Prediction features generated: ${predictionFeatures.length} horses`,
    );

    res.status(200).json({
      message: "HorseFeatures carregados para supabase com sucesso.",
      details: {
        training: {
          racesProcessed: trainingResult.racesProcessed,
          featuresGenerated: trainingResult.featuresGenerated,
        },
        prediction: {
          racesFound: raceIds.length,
          featuresGenerated: predictionFeatures.length,
        },
      },
    });
  } catch (error) {
    console.error("[V4] Error in spbHorseFeatures:", error);
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
    await updateRacecardsAndDetails();
    await updateLayBettingResults();
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
  spbEnrichedDetails,
  spbHorseFeatures,
  spbUpdateRacecard,
  spbCheckCreateEntry,
};
