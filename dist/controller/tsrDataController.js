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
const populateHorseEntries_1 = require("../functions/spb_functions/populate/populateHorseEntries");
const trainHorseData_v3_1 = require("../functions/tensor_functions/trainHorseData_v3");
const generatePredictions_v3_1 = require("../functions/spb_functions/features_v3/generatePredictions_v3");
const getTraining = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("tsrTrainData");
    try {
        yield (0, trainHorseData_v3_1.trainHorseData_v3)();
        res
            .status(200)
            .json({ message: "Treinamento do modelo executado com sucesso." });
    }
    catch (error) {
        next(error);
    }
});
const getGeneratePredictions = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("tsrGeneratePredictions");
    yield (0, generatePredictions_v3_1.generatePredictions_v3)();
    try {
        res.status(200).json({ message: "Previsões geradas com suscesso." });
    }
    catch (error) {
        next(error);
    }
});
const getInsertPredictions = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("tsrGetInsertPredictions");
    try {
        yield (0, populateHorseEntries_1.generateHorseEntries_v3)();
        res.status(200).json({ message: "Previsões armazendas com suscesso." });
    }
    catch (error) {
        next(error);
    }
});
exports.default = {
    getTraining,
    getInsertPredictions,
    getGeneratePredictions,
};
