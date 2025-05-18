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
exports.generatePredictionFeatures = void 0;
const fetchHorsesForRace_1 = require("./utils/fetchHorsesForRace");
const fetchHorseForRace_1 = require("./utils/fetchHorseForRace");
const calculateHistorialFeatures_1 = require("./utils/calculateHistorialFeatures");
const calculateJockeyFeatures_1 = require("./utils/calculateJockeyFeatures");
const auxFunctions_1 = require("../../utils/auxFunctions");
const auxFunctions_2 = require("../../utils/auxFunctions");
const encodeGoing_1 = require("./aux/encodeGoing");
const fetchUpcomingRaces_1 = require("./utils/fetchUpcomingRaces");
const savePredictionFeatures_1 = require("./utils/savePredictionFeatures");
const generatePredictionFeatures = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("Iniciando geração de features para previsão...");
        // 1. Buscar corridas não finalizadas
        const upcomingRaces = yield (0, fetchUpcomingRaces_1.fetchUpcoming)();
        console.log(`Encontradas ${upcomingRaces.length} corridas pendentes para previsão.`);
        const allPredictionFeatures = [];
        // 2. Para cada corrida
        for (const race of upcomingRaces) {
            console.log(`Processando corrida ${race.id} (${race.course}, ${race.date})...`);
            // 3. Buscar todos os cavalos da corrida
            const horses = yield (0, fetchHorsesForRace_1.fetchHorsesForRace)(race.id);
            console.log(`Encontrados ${horses.length} cavalos para a corrida ${race.id}.`);
            const racePredictionFeatures = [];
            // 4. Para cada cavalo
            for (const horse of horses) {
                // Pular cavalos que não vão correr
                if (horse.non_runner === 1) {
                    console.log(`Cavalo ${horse.id} (${horse.horse}) não vai correr, pulando.`);
                    continue;
                }
                // 5. Buscar histórico do cavalo até a data atual
                const horseHistory = yield (0, fetchHorseForRace_1.fetchHorseHistoryBeforeDate)(horse.id_horse || 0, new Date());
                // 6. Calcular features históricas
                const historicalFeatures = (0, calculateHistorialFeatures_1.calculateHistoricalFeatures)(horseHistory, race);
                // 7. Calcular features do jóquei
                const jockeyFeatures = yield (0, calculateJockeyFeatures_1.calculateJockeyFeatures)(horse.jockey || "", horse.id_horse || 0, race);
                // 8. Combinar todas as features
                const featureEntry = Object.assign(Object.assign({ race_horse_id: horse.id, race_id: race.id, 
                    // Features da corrida
                    going_encoded: (0, encodeGoing_1.encodeGoing)(race.going || ""), distance_meters: (0, auxFunctions_1.convertFurlongsToMeters)(race.distance || ""), field_size: horses.length, race_class: race.class || 0, 
                    // Features do cavalo
                    horse_age: horse.age || 0, weight_kg: (0, auxFunctions_2.convertHorseWeightToKg)(horse.weight || ""), or_rating: horse.or_rating || 0 }, historicalFeatures), jockeyFeatures);
                // 9. Salvar na tabela de features de previsão
                yield (0, savePredictionFeatures_1.savePredictionFeature)(featureEntry);
                racePredictionFeatures.push(featureEntry);
            }
            allPredictionFeatures.push({
                raceId: race.id,
                features: racePredictionFeatures,
            });
        }
        console.log(`Geração de features para previsão concluída. Total de ${allPredictionFeatures.length} corridas processadas.`);
        // return allPredictionFeatures;
    }
    catch (error) {
        console.error("Erro na geração de features para previsão:", error);
        throw error;
    }
});
exports.generatePredictionFeatures = generatePredictionFeatures;
