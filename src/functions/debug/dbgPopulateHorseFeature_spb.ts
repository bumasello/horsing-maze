import dayjs from "dayjs";
import {
  fetchRaceHorses,
  fetchSingleRacecards,
} from "../spb_functions/features_v1/services/raceCardService";
import { fetchHorseHistoricalResults } from "../spb_functions/features_v1/services/horseHistoryService";
import {
  fetchJockeyWinRate,
  fetchJockeyHorseWinRate,
} from "../spb_functions/features_v1/services/jockeyService";
import {
  average,
  variance,
  convertFurlongsToMeters,
  cleanDateString as _cleanDateString,
  countWins as _countWins,
  countPlaces as _countPlaces,
  convertHorseWeightToKg,
} from "../utils/auxFunctions";

// import type { IRaceHorse_Spb } from "../../../models/modelSpb/raceHorse_Spb";
// import type { IHorseFeatureEntry_Spb } from "../../../models/modelSpb/horseFeatureEntry_Spb";

import type { NextFunction } from "express";

const debugPopulateHorseFeature_spb = async (
  racecard_id: number,
  next: NextFunction,
) => {
  try {
    console.log(`\n[DEBUG] Iniciando debug para racecard_id = ${racecard_id}`);

    // Ajuste: passamos o racecard_id
    const racecards = await fetchSingleRacecards(racecard_id);
    console.log(
      "[DEBUG] racecards retornados:",
      JSON.stringify(racecards, null, 2),
    );

    for (const rc of racecards) {
      const raceDate = dayjs(rc.date).format("YYYY-MM-DD");
      console.log(
        `\n[DEBUG] Processando Racecard ID=${rc.id}, date=${raceDate}`,
      );

      const horses = await fetchRaceHorses(rc.id);
      console.log(`[DEBUG] ${horses.length} cavalos encontrados:`, horses);

      const field_size = horses.length;
      for (const h of horses) {
        console.log(`\n[DEBUG] Horse ID=${h.id_horse} | Dados iniciais:`, h);

        const historicalResults = await fetchHorseHistoricalResults(
          h.id_horse || 0,
          raceDate,
        );
        console.log(
          `[DEBUG] historicalResults (count=${historicalResults.length}):`,
          historicalResults,
        );

        // inicialização
        let avg_position = 0,
          position_variance = 0,
          win_rate = 0,
          place_rate = 0,
          avg_or_rating = 0,
          or_trend = 0,
          days_since_last_run = 0,
          going_performance = 0,
          distance_performance = 0;

        if (historicalResults.length > 0) {
          const positions = historicalResults.map((r) => r.position || 0);
          avg_position = average(positions);
          position_variance = variance(positions, avg_position);

          console.log("[DEBUG] - PLACE RATE");
          const totalResults = historicalResults.length;
          console.log("totalResults: ", totalResults);
          win_rate = positions.filter((pos) => pos === 1).length / totalResults;
          console.log("win_rate: ", win_rate);
          place_rate =
            positions.filter((pos) => pos <= 3).length / totalResults;

          const orRatings = historicalResults.map((r) => r.or_rating || 0);
          avg_or_rating = average(orRatings);
          or_trend = (h.or_rating || 0) - avg_or_rating;

          // dias desde última corrida
          const validPastDates = historicalResults
            .map((r) => r.date ?? "")
            .filter((d) =>
              dayjs(d, ["YYYY-MM-DD", "DD-MM-YYYY"], true).isValid(),
            )
            .filter((d) =>
              dayjs(d, ["YYYY-MM-DD", "DD-MM-YYYY"], true).isBefore(
                dayjs(raceDate),
              ),
            );

          if (validPastDates.length > 0) {
            const lastDate = validPastDates.reduce((max, curr) =>
              dayjs(curr).isAfter(dayjs(max)) ? curr : max,
            );
            days_since_last_run = dayjs(raceDate).diff(
              dayjs(lastDate, ["YYYY-MM-DD", "DD-MM-YYYY"], true),
              "day",
            );
          }

          // desempenho por going
          const goingResults = historicalResults.filter(
            (r) => r.course === rc.course,
          );
          if (goingResults.length > 0) {
            going_performance = average(
              goingResults.map((r) => r.position || 0),
            );
          }

          // desempenho por distância
          const currentDistanceMeters = convertFurlongsToMeters(
            rc.distance || "",
          );
          const distanceResults = historicalResults.filter((r) => {
            const rMeters = convertFurlongsToMeters(r.distance || "");
            return (
              currentDistanceMeters > 0 &&
              Math.abs(rMeters - currentDistanceMeters) /
                currentDistanceMeters <
                0.1
            );
          });
          if (distanceResults.length > 0) {
            distance_performance = average(
              distanceResults.map((r) => r.position || 0),
            );
          }
        }

        const jockey_win_rate = await fetchJockeyWinRate(h.jockey || "");
        const jockey_horse_win_rate = await fetchJockeyHorseWinRate(
          h.jockey || "",
          h.id_horse || 0,
        );

        const target = (h.position || 99) === 1 ? 0 : 1;

        const goingMap: Record<string, number> = {
          Hard: 1,
          Firm: 2,
          "Good to Firm": 3,
          Good: 4,
          "Good to Soft": 2,
          Soft: 1,
          Heavy: 0,
        };
        const going_encoded = goingMap[rc.going || "Good"] ?? 2;
        const distance_meters = convertFurlongsToMeters(rc.distance || "");
        const weight_kg = convertHorseWeightToKg(h.weight || "");

        const featureEntry = {
          race_horse_id: h.id,
          race_id: rc.id,
          going_encoded,
          distance_meters,
          field_size,
          race_class: rc.class || 0,
          horse_age: h.age || 0,
          weight_kg,
          or_rating: h.or_rating || 0,
          days_since_last_run,
          avg_position,
          position_variance,
          win_rate,
          place_rate,
          avg_or_rating,
          or_trend,
          going_performance,
          distance_performance,
          jockey_win_rate,
          jockey_horse_win_rate,
          target,
        };

        console.log("[DEBUG] featureEntry gerado:", featureEntry);
      }
    }

    console.log("\n[DEBUG] Debug completo.");
  } catch (error) {
    console.error("[DEBUG] Erro durante debug:", error);
    next(error);
  }
};

export default debugPopulateHorseFeature_spb;
