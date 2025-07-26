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
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateHistoricalFeatures = void 0;
const auxFunctions_1 = require("../../../utils/auxFunctions");
const fetchLastRaceDate_1 = require("../aux/fetchLastRaceDate");
const calculateHistoricalFeatures = (historicalResults, race, horseId) => __awaiter(void 0, void 0, void 0, function* () {
    const defaultValues = {
        avg_position: 0,
        position_variance: 0,
        win_rate: 0,
        place_rate: 0,
        avg_or_rating: 0,
        or_trend: 0,
        going_performance: 0,
        distance_performance: 0,
        recent_form: 0,
        days_since_last_run: 0,
    };
    // 1. Validação de Entrada: Exigir um mínimo de 3 corridas históricas
    if (!historicalResults || historicalResults.length < 3) {
        // console.log(
        //   `[AVISO] Histórico insuficiente (menos de 3 corridas) para cavalo ${horseId}, retornando valores padrão`,
        // );
        return defaultValues;
    }
    // 2. Pré-processamento de Posições: Tratar strings e nulos
    const positions = historicalResults
        .map((r) => {
        if (typeof r.position === "string") {
            const posNum = parseInt(r.position, 10);
            return Number.isNaN(posNum) ? null : posNum;
        }
        else if (typeof r.position === "number") {
            return r.position;
        }
        return null;
    })
        .filter((p) => p !== null);
    // Se após o pré-processamento ainda houver menos de 3 posições válidas
    if (positions.length < 3) {
        // console.log(
        //   `[AVISO] Menos de 3 posições válidas após pré-processamento para cavalo ${horseId}, retornando valores padrão`,
        // );
        // Calcular days_since_last_run mesmo que outras features sejam padrão
        let days_since_last_run_val = 0;
        if (race.date && typeof race.date === "string") {
            try {
                let lastRaceDate = yield (0, fetchLastRaceDate_1.fetchLastRaceDate)(horseId, race.date);
                if (!lastRaceDate) {
                    lastRaceDate = yield (0, fetchLastRaceDate_1.checkDirectHorseResults)(horseId, race.date);
                }
                if (lastRaceDate) {
                    days_since_last_run_val = (0, fetchLastRaceDate_1.calculateDaysBetween)(lastRaceDate, race.date);
                }
                else {
                    // console.log(
                    //   `[AVISO] Cavalo ${horseId}: Nenhuma corrida anterior encontrada para days_since_last_run.`,
                    // );
                }
            }
            catch (error) {
                // console.error(
                //   `[ERRO] Erro ao calcular days_since_last_run para cavalo ${horseId}:`,
                //   error,
                // );
            }
        }
        return Object.assign(Object.assign({}, defaultValues), { days_since_last_run: days_since_last_run_val });
    }
    // 3. Cálculo de days_since_last_run (manter a lógica existente, mas garantir que a data da corrida seja válida)
    let days_since_last_run = 0;
    if (race.date && typeof race.date === "string") {
        try {
            let lastRaceDate = yield (0, fetchLastRaceDate_1.fetchLastRaceDate)(horseId, race.date);
            if (!lastRaceDate) {
                lastRaceDate = yield (0, fetchLastRaceDate_1.checkDirectHorseResults)(horseId, race.date);
            }
            if (lastRaceDate) {
                days_since_last_run = (0, fetchLastRaceDate_1.calculateDaysBetween)(lastRaceDate, race.date);
            }
            else {
                // console.log(
                //   `[AVISO] Cavalo ${horseId}: Nenhuma corrida anterior encontrada para days_since_last_run.`,
                // );
            }
        }
        catch (error) {
            // console.error(
            //   `[ERRO] Erro ao calcular days_since_last_run para cavalo ${horseId}:`,
            //   error,
            // );
        }
    }
    else {
        // console.error(
        //   `[ERRO] Data da corrida inválida para cavalo ${horseId}: ${race.date}`,
        // );
    }
    // Calcular média de posições
    const avg_position = positions.reduce((sum, pos) => sum + pos, 0) / positions.length;
    // Calcular variância das posições
    const position_variance = positions.length;
    // Calcular taxa de vitórias e colocações
    const totalResults = positions.length;
    const win_rate = positions.filter((pos) => pos === 1).length / totalResults;
    const place_rate = positions.filter((pos) => pos <= 3).length / totalResults;
    // Calcular média de OR rating e tendência
    const orRatings = historicalResults
        .map((r) => r.or_rating)
        .filter((r) => r !== null && r !== undefined && !Number.isNaN(r));
    const avg_or_rating = orRatings.length > 0
        ? orRatings.reduce((sum, rating) => sum + rating, 0) / orRatings.length
        : 0;
    // Tendência do OR rating (diferença entre o último e a média)
    const latestORRating = orRatings.length > 0 ? orRatings[0] : 0;
    const or_trend = latestORRating - avg_or_rating;
    // Desempenho em pistas similares
    const goingResults = historicalResults.filter((r) => r.course === race.course);
    const going_performance = goingResults.length > 0
        ? goingResults
            .map((r) => r.position)
            .filter((p) => p !== null && !Number.isNaN(p))
            .reduce((sum, pos) => sum + pos, 0) / goingResults.length
        : 0;
    // Desempenho em distâncias similares
    const currentDistanceMeters = (0, auxFunctions_1.convertFurlongsToMeters)(race.distance || "");
    const distanceResults = historicalResults.filter((r) => {
        const rMeters = (0, auxFunctions_1.convertFurlongsToMeters)(r.distance || "");
        return (currentDistanceMeters > 0 &&
            Math.abs(rMeters - currentDistanceMeters) / currentDistanceMeters < 0.1);
    });
    const distance_performance = distanceResults.length > 0
        ? distanceResults
            .map((r) => r.position)
            .filter((p) => p !== null && !Number.isNaN(p))
            .reduce((sum, pos) => sum + pos, 0) / distanceResults.length
        : 0;
    // Forma recente (média ponderada das últimas corridas, dando mais peso às mais recentes)
    const recentResults = historicalResults.slice(0, Math.min(5, historicalResults.length));
    let weightedSum = 0;
    let weightSum = 0;
    recentResults.forEach((r, index) => {
        const weight = recentResults.length - index; // Peso maior para resultados mais recentes
        if (r.position !== null && !Number.isNaN(r.position)) {
            weightedSum += r.position * weight;
            weightSum += weight;
        }
    });
    const recent_form = weightSum > 0 ? weightedSum / weightSum : 0;
    return {
        avg_position,
        position_variance,
        win_rate,
        place_rate,
        avg_or_rating,
        or_trend,
        going_performance,
        distance_performance,
        recent_form,
        days_since_last_run,
    };
});
exports.calculateHistoricalFeatures = calculateHistoricalFeatures;
