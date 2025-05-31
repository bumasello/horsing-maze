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
const populateRaceCard_spb_1 = __importDefault(require("../functions/spb_functions/populate/populateRaceCard_spb"));
const populateRaceDetail_spb_1 = __importDefault(require("../functions/spb_functions/populate/populateRaceDetail_spb"));
const populateHorseStats_spb_1 = __importDefault(require("../functions/spb_functions/populate/populateHorseStats_spb"));
const populateHorseFeatures_1 = __importDefault(require("../functions/spb_functions/features_v1/populateHorseFeatures"));
const updateRacecard_hr_1 = require("../functions/spb_functions/update/updateRacecard_hr");
const updateLayPicks_1 = require("../functions/spb_functions/update/updateLayPicks");
const checkHorseResultLength_1 = require("../functions/spb_functions/entries/checkHorseResultLength");
const updateCleanRacecard_1 = require("../functions/spb_functions/update/updateCleanRacecard");
const spbRaceCards = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("spbRaceCards");
        yield (0, populateRaceCard_spb_1.default)(next);
        res
            .status(200)
            .json({ message: "Racecards carregados para supabase com sucesso." });
    }
    catch (error) {
        next(error);
    }
});
const spbRaceDetail = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("spbRaceDetail");
        yield (0, populateRaceDetail_spb_1.default)();
    }
    catch (error) {
        next(error);
    }
    res
        .status(200)
        .json({ message: "RaceDetails carregados para supabase com sucesso." });
});
const spbHorseStats = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("spbHorseStats");
        yield (0, populateHorseStats_spb_1.default)(next);
    }
    catch (error) {
        next(error);
    }
    res
        .status(200)
        .json({ message: "HorseStats carregados para supabase com sucesso." });
});
const spbHorseFeatures = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("spbHorseFeatures");
        // await generateTrainingFeatures();
        // await generatePredictionFeatures();
        yield (0, populateHorseFeatures_1.default)(next);
        // await debugPopulateHorseFeature_spb(256536, next);
        res
            .status(200)
            .json({ message: "HorseFeatures carregados para supabase com sucesso." });
    }
    catch (error) {
        next(error);
    }
});
const spbCheckCreateEntry = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("spbCheckCreateEntry");
        yield (0, checkHorseResultLength_1.checkHorseResultLength)();
        yield (0, updateCleanRacecard_1.updateCleanRacecard)(next);
        res.status(200).json({
            message: "Corridas de cavalos com mais de 3 resultados selecionadas com sucesso.",
        });
    }
    catch (error) {
        next(error);
    }
});
const spbUpdateRacecard = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("spbUpdateRacecard");
        yield (0, updateRacecard_hr_1.updateRacecards_spb)(next);
        yield (0, updateLayPicks_1.updateLayPicks_spb)(next);
        res
            .status(200)
            .json({ message: "Racecards atualizados no supabase com sucesso." });
    }
    catch (error) {
        next(error);
    }
});
exports.default = {
    spbRaceCards,
    spbRaceDetail,
    spbHorseStats,
    spbHorseFeatures,
    spbUpdateRacecard,
    spbCheckCreateEntry,
};
