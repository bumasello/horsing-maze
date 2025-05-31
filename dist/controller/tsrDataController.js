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
const claude_trainData_1 = require("../functions/tensor_functions/claude_trainData");
const populateLayPicks_1 = __importDefault(require("../functions/spb_functions/populate/populateLayPicks"));
const generatePredictions_1 = require("../functions/spb_functions/features_v2/generatePredictions");
const getTraining = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("tsrTrainData");
    try {
        yield (0, claude_trainData_1.cl_trainData)();
        // await trainHorseData();
        // await trainHorseData_v2();
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
    yield (0, generatePredictions_1.generatePredictions)();
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
        yield populateLayPicks_1.default.generateLayPicks();
        // await generateHorseEntries();
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
