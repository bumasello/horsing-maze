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
exports.generateTrainingFeatures = void 0;
const fetchFinishedRaces_1 = require("./utils/fetchFinishedRaces");
const fetchHorsesForRace_1 = require("./utils/fetchHorsesForRace");
const fetchHorseForRace_1 = require("./utils/fetchHorseForRace");
const calculateHistorialFeatures_1 = require("./utils/calculateHistorialFeatures");
const calculateJockeyFeatures_1 = require("./utils/calculateJockeyFeatures");
const auxFunctions_1 = require("../../utils/auxFunctions");
const auxFunctions_2 = require("../../utils/auxFunctions");
const saveTrainingFeature_1 = require("./utils/saveTrainingFeature");
const encodeGoing_1 = require("./aux/encodeGoing");
const generateTrainingFeatures = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("Iniciando geração de features para treinamento...");
        // 1. Buscar corridas finalizadas
        const finishedRaces = yield (0, fetchFinishedRaces_1.fetchFinishedRaces)();
        console.log(`Encontradas ${finishedRaces.length} corridas finalizadas para processamento.`);
        let featuresCount = 0;
        // 2. Para cada corrida
        for (const race of finishedRaces) {
            console.log(`Processando corrida ${race.id} (${race.course}, ${race.date})...`);
            // 3. Buscar todos os cavalos da corrida
            const horses = yield (0, fetchHorsesForRace_1.fetchHorsesForRace)(race.id);
            console.log(`Encontrados ${horses.length} cavalos para a corrida ${race.id}.`);
            // 4. Para cada cavalo
            for (const horse of horses) {
                // Pular cavalos que não correram
                if (horse.non_runner === 1) {
                    console.log(`Cavalo ${horse.id} (${horse.horse}) não correu, pulando.`);
                    continue;
                }
                // 5. Buscar histórico do cavalo até a data da corrida
                const horseHistory = yield (0, fetchHorseForRace_1.fetchHorseHistoryBeforeDate)(horse.id_horse || 0, race.date);
                // 6. Calcular features históricas
                const historicalFeatures = (0, calculateHistorialFeatures_1.calculateHistoricalFeatures)(horseHistory, race);
                // 7. Calcular features do jóquei
                const jockeyFeatures = yield (0, calculateJockeyFeatures_1.calculateJockeyFeatures)(horse.jockey || "", horse.id_horse || 0, race);
                // 8. Definir target (0 se venceu, 1 se não venceu)
                const target = horse.position === 1 ? 0 : 1;
                // 9. Combinar todas as features
                const featureEntry = Object.assign(Object.assign(Object.assign({ race_horse_id: horse.id, race_id: race.id, 
                    // Features da corrida
                    going_encoded: (0, encodeGoing_1.encodeGoing)(race.going || ""), distance_meters: (0, auxFunctions_1.convertFurlongsToMeters)(race.distance || ""), field_size: horses.length, race_class: race.class || 0, 
                    // Features do cavalo
                    horse_age: horse.age || 0, weight_kg: (0, auxFunctions_2.convertHorseWeightToKg)(horse.weight || ""), or_rating: horse.or_rating || 0 }, historicalFeatures), jockeyFeatures), { 
                    // Target
                    target: target });
                // 10. Salvar na tabela de features de treinamento
                yield (0, saveTrainingFeature_1.saveTrainingFeature)(featureEntry);
                featuresCount++;
            }
        }
        console.log(`Geração de features concluída. Total de ${featuresCount} features geradas.`);
    }
    catch (error) {
        console.log(error);
        console.error("Erro na geração de features para treinamento:", error);
        const detalhe = error instanceof Error
            ? `${error.message}\n${error.stack}`
            : JSON.stringify(error, null, 2);
        throw new Error(`Erro ao salvar feature de treinamento: ${detalhe}`);
    }
});
exports.generateTrainingFeatures = generateTrainingFeatures;
