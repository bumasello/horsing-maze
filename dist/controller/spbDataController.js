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
const populateRaceCard_spb_1 = __importDefault(require("../functions/spb_functions/populateRaceCard_spb"));
const populateRaceDetail_spb_1 = __importDefault(require("../functions/spb_functions/populateRaceDetail_spb"));
const populateHorseStats_spb_1 = __importDefault(require("../functions/spb_functions/populateHorseStats_spb"));
const spbRaceCards = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, populateRaceCard_spb_1.default)(next);
    res
        .status(200)
        .json({ message: "Racecards carregados para supabase com sucesso." });
});
const spbRaceDetail = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
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
const spbHorseStats = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
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
exports.default = {
    spbRaceCards,
    spbRaceDetail,
    spbHorseStats,
};
