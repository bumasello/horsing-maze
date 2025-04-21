import { supabase } from "../../..";
import dayjs from "dayjs";
import { fetchRacecards, fetchRaceHorses } from "../services/raceCardService";
import { fetchHorseHistoricalResults } from "../services/horseHistoryService";
import {
  fetchJockeyWinRate,
  fetchJockeyHorseWinRate,
} from "../services/jockeyService";
import {
  average,
  variance,
  convertFurlongsToMeters,
  cleanDateString,
  countWins,
  countPlaces,
  convertHorseWeightToKg,
} from "../../utils/auxFunctions";

import type { IRaceCard_Spb } from "../../../models/modelSpb/raceCard_Spb";
import type { IRaceHorse_Spb } from "../../../models/modelSpb/raceHorse_Spb";
import type { IHorseFeatureEntry_Spb } from "../../../models/modelSpb/horseFeatureEntry_Spb";
import type { NextFunction } from "express";

const populateHorseFeature_spb = async (next: NextFunction) => {
  try {
    const racecards = await fetchRacecards();

    for (const rc of racecards) {
      const raceDate = dayjs(rc.date).format("YYYY-MM-DD");
      const horses = await fetchRaceHorses(rc.id);

      const field_size = horses.length;
      for (const h of horses as IRaceHorse_Spb[]) {
        const historicalResults = await fetchHorseHistoricalResults(
          h.id_horse || 0,
          raceDate,
        );

        // iniciar variaveis com zero
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

          const totalResults = historicalResults.length;
          win_rate = positions.filter((pos) => pos === 1).length / totalResults;
          place_rate =
            positions.filter((pos) => pos <= 3).length / totalResults;

          const orRatings = historicalResults.map((r) => r.or_rating || 0);
          avg_or_rating = average(orRatings);
          or_trend = (h.or_rating || 0) - avg_or_rating;

          // calular dias da ultima corrida
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
            // encontra a última data
            const lastDate = validPastDates.reduce(
              (max, curr) => (dayjs(curr).isAfter(dayjs(max)) ? curr : max),
              validPastDates[0],
            );

            days_since_last_run = dayjs(raceDate).diff(
              dayjs(lastDate, ["YYYY-MM-DD", "DD-MM-YYYY"], true),
              "day",
            );
          }

          const goingResults = historicalResults.filter(
            (r) => r.course === rc.course,
          );
          if (goingResults.length > 0) {
            going_performance = average(
              goingResults.map((r) => r.position || 0),
            );
          }

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
        const featureEntry: IHorseFeatureEntry_Spb = {
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

        const { data, error } = await supabase
          .from("horse_features")
          .upsert(featureEntry, {
            onConflict: "race_horse_id,race_id",
          })
          .select("id");

        if (error) {
          throw new Error(`Erro no upsert features: ${error}`);
        }
      }
    }
  } catch (error) {
    next(error);
  }
};

export default populateHorseFeature_spb;
