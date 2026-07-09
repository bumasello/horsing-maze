import { checkHorseResultLength } from "../../services/data-sync/checkHorseResultLength";
import { populateEnrichedRaceDetail_spb } from "../../services/data-sync/populateEnrichedRaceDetail";
import { populateHorseStats_spb } from "../../services/data-sync/populateHorseStats_spb";
import { populateRacecardsEnriched_spb } from "../../services/data-sync/populateRaceCard_spb_enriched";
import { populateRaceDetail_spb } from "../../services/data-sync/populateRaceDetail_spb";
import { updateCleanRacecard } from "../../services/data-sync/updateCleanRacecard";
import {
	generatePredictionFeatures_v4,
	generateTrainingFeatures_v4,
} from "../../services/features/pipeline/feature-orchestrator";
import {
	updateLayBettingResults,
	updateRacecardsAndDetails,
} from "../../services/features/pipeline/update_results";
import { getDataSchema } from "../../shared/db-config";

import type { NextFunction, Request, Response } from "express";
import type { EnrichmentStats } from "../../services/racing-api/racingApi.service";

import { supabase } from "../..";
import {
	enrichRacecardsFromRacingApi,
	enrichResultsFromRacingApi,
} from "../../services/racing-api/racingApi.service";

export const raceCards = async (
	_req: Request,
	res: Response,
	next: NextFunction,
) => {
	try {
		await populateRacecardsEnriched_spb();
		res
			.status(200)
			.json({ message: "Racecards carregados para supabase com sucesso." });
	} catch (error) {
		next(error);
	}
};

export const raceDetails = async (
	_req: Request,
	res: Response,
	next: NextFunction,
) => {
	try {
		await populateRaceDetail_spb();
		res
			.status(200)
			.json({ message: "RaceDetails carregados para supabase com sucesso." });
	} catch (error) {
		next(error);
	}
};

export const horseStats = async (
	_req: Request,
	res: Response,
	next: NextFunction,
) => {
	try {
		await populateHorseStats_spb();
		res
			.status(200)
			.json({ message: "HorseStats carregados para supabase com sucesso." });
	} catch (error) {
		next(error);
	}
};

export const enrichedDetails = async (
	_req: Request,
	res: Response,
	next: NextFunction,
) => {
	try {
		await populateEnrichedRaceDetail_spb();
		res.status(200).json({
			message: "Enriched horse stats carregados para supabase com sucesso.",
		});
	} catch (error) {
		next(error);
	}
};

export const checkCreateEntry = async (
	_req: Request,
	res: Response,
	next: NextFunction,
) => {
	try {
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

export const horseFeatures = async (
	_req: Request,
	res: Response,
	next: NextFunction,
) => {
	try {
		const endDate = new Date();
		const startDate = new Date();
		startDate.setFullYear(startDate.getFullYear() - 2);

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

		const { data: upcomingRaces, error } = await supabase
			.schema(getDataSchema())
			.from("racecards_hr_enriched")
			.select("id_race")
			.eq("finished", 0)
			.eq("canceled", 0);

		if (error) throw error;

		if (!upcomingRaces || upcomingRaces.length === 0) {
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

		const predictionFeatures = await generatePredictionFeatures_v4(
			supabase,
			raceIds,
			{
				mode: "prediction",
				saveToDatabase: true,
				minQualityScore: 0.5,
			},
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
		next(error);
	}
};

export const updateRacecard = async (
	_req: Request,
	res: Response,
	next: NextFunction,
) => {
	try {
		await updateRacecardsAndDetails();
		await updateLayBettingResults();

		res.status(200).json({
			message: "Racecards atualizados no supabase com sucesso.",
		});
	} catch (error) {
		next(error);
	}
};

export const enrichRacecards = async (
	_req: Request,
	res: Response,
	next: NextFunction,
) => {
	try {
		const stats: EnrichmentStats = await enrichRacecardsFromRacingApi();

		res.status(200).json({
			message: "Racecards enriquecidos com Racing API",
			racesFromApi: stats.racesFromApi,
			racesMatched: stats.racesMatched,
			horsesMatched: stats.horsesMatched,
			horsesNotMatched: stats.horsesNotMatched,
			errors: stats.errors,
		});
	} catch (error) {
		next(error);
	}
};
