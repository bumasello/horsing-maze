"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dayjs_1 = __importDefault(require("dayjs"));
const raceCardService_1 = require("../spb_functions/services/raceCardService");
const horseHistoryService_1 = require("../spb_functions/services/horseHistoryService");
const jockeyService_1 = require("../spb_functions/services/jockeyService");
const auxFunctions_1 = require("../utils/auxFunctions");
const debugPopulateHorseFeature_spb = (racecard_id, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        console.log(`\n[DEBUG] Iniciando debug para racecard_id = ${racecard_id}`);
        // Ajuste: passamos o racecard_id
        const racecards = yield (0, raceCardService_1.fetchSingleRacecards)(racecard_id);
        console.log("[DEBUG] racecards retornados:", JSON.stringify(racecards, null, 2));
        for (const rc of racecards) {
            const raceDate = (0, dayjs_1.default)(rc.date).format("YYYY-MM-DD");
            console.log(`\n[DEBUG] Processando Racecard ID=${rc.id}, date=${raceDate}`);
            const horses = yield (0, raceCardService_1.fetchRaceHorses)(rc.id);
            console.log(`[DEBUG] ${horses.length} cavalos encontrados:`, horses);
            const field_size = horses.length;
            for (const h of horses) {
                console.log(`\n[DEBUG] Horse ID=${h.id_horse} | Dados iniciais:`, h);
                const historicalResults = yield (0, horseHistoryService_1.fetchHorseHistoricalResults)(h.id_horse || 0, raceDate);
                console.log(`[DEBUG] historicalResults (count=${historicalResults.length}):`, historicalResults);
                // inicialização
                let avg_position = 0, position_variance = 0, win_rate = 0, place_rate = 0, avg_or_rating = 0, or_trend = 0, days_since_last_run = 0, going_performance = 0, distance_performance = 0;
                if (historicalResults.length > 0) {
                    const positions = historicalResults.map((r) => r.position || 0);
                    avg_position = (0, auxFunctions_1.average)(positions);
                    position_variance = (0, auxFunctions_1.variance)(positions, avg_position);
                    console.log("[DEBUG] - PLACE RATE");
                    const totalResults = historicalResults.length;
                    console.log("totalResults: ", totalResults);
                    win_rate = positions.filter((pos) => pos === 1).length / totalResults;
                    console.log("win_rate: ", win_rate);
                    place_rate =
                        positions.filter((pos) => pos <= 3).length / totalResults;
                    const orRatings = historicalResults.map((r) => r.or_rating || 0);
                    avg_or_rating = (0, auxFunctions_1.average)(orRatings);
                    or_trend = (h.or_rating || 0) - avg_or_rating;
                    // dias desde última corrida
                    const validPastDates = historicalResults
                        .map((r) => { var _a; return (_a = r.date) !== null && _a !== void 0 ? _a : ""; })
                        .filter((d) => (0, dayjs_1.default)(d, ["YYYY-MM-DD", "DD-MM-YYYY"], true).isValid())
                        .filter((d) => (0, dayjs_1.default)(d, ["YYYY-MM-DD", "DD-MM-YYYY"], true).isBefore((0, dayjs_1.default)(raceDate)));
                    if (validPastDates.length > 0) {
                        const lastDate = validPastDates.reduce((max, curr) => (0, dayjs_1.default)(curr).isAfter((0, dayjs_1.default)(max)) ? curr : max);
                        days_since_last_run = (0, dayjs_1.default)(raceDate).diff((0, dayjs_1.default)(lastDate, ["YYYY-MM-DD", "DD-MM-YYYY"], true), "day");
                    }
                    // desempenho por going
                    const goingResults = historicalResults.filter((r) => r.course === rc.course);
                    if (goingResults.length > 0) {
                        going_performance = (0, auxFunctions_1.average)(goingResults.map((r) => r.position || 0));
                    }
                    // desempenho por distância
                    const currentDistanceMeters = (0, auxFunctions_1.convertFurlongsToMeters)(rc.distance || "");
                    const distanceResults = historicalResults.filter((r) => {
                        const rMeters = (0, auxFunctions_1.convertFurlongsToMeters)(r.distance || "");
                        return (currentDistanceMeters > 0 &&
                            Math.abs(rMeters - currentDistanceMeters) /
                                currentDistanceMeters <
                                0.1);
                    });
                    if (distanceResults.length > 0) {
                        distance_performance = (0, auxFunctions_1.average)(distanceResults.map((r) => r.position || 0));
                    }
                }
                const jockey_win_rate = yield (0, jockeyService_1.fetchJockeyWinRate)(h.jockey || "");
                const jockey_horse_win_rate = yield (0, jockeyService_1.fetchJockeyHorseWinRate)(h.jockey || "", h.id_horse || 0);
                const target = (h.position || 99) === 1 ? 0 : 1;
                const goingMap = {
                    Hard: 1,
                    Firm: 2,
                    "Good to Firm": 3,
                    Good: 4,
                    "Good to Soft": 2,
                    Soft: 1,
                    Heavy: 0,
                };
                const going_encoded = (_a = goingMap[rc.going || "Good"]) !== null && _a !== void 0 ? _a : 2;
                const distance_meters = (0, auxFunctions_1.convertFurlongsToMeters)(rc.distance || "");
                const weight_kg = (0, auxFunctions_1.convertHorseWeightToKg)(h.weight || "");
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
    }
    catch (error) {
        console.error("[DEBUG] Erro durante debug:", error);
        next(error);
    }
});
exports.default = debugPopulateHorseFeature_spb;
