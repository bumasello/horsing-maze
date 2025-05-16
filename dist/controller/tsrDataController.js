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
const createEntries_1 = __importDefault(require("../functions/spb_functions/entries/createEntries"));
const trainHorseData_1 = require("../functions/tensor_functions/trainHorseData");
const getTrainDataAndCreatePredictions = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("tsrTrainData");
    try {
        // await cl_trainData();
        yield (0, trainHorseData_1.trainHorseData)();
        res.status(200).json({ message: "Previsões geradas com suscesso." });
    }
    catch (error) {
        next(error);
    }
});
const getInsertPredictions = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("tsrgetInsertPredictions");
    try {
        yield createEntries_1.default.generateLayPicks();
        res.status(200).json({ message: "Previsões armazendas com suscesso." });
    }
    catch (error) {
        next(error);
    }
});
exports.default = {
    getTrainDataAndCreatePredictions,
    getInsertPredictions,
};
