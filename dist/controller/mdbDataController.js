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
const getRaceCard_Hr_1 = __importDefault(require("../functions/mdb_functions/getRaceCard_Hr"));
const getRaceDetail_Hr_1 = __importDefault(require("../functions/mdb_functions/getRaceDetail_Hr"));
const getHorseResults_Hr_1 = __importDefault(require("../functions/mdb_functions/getHorseResults_Hr"));
const getRaceCards = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate());
    const formatted = tomorrowDate.toISOString().slice(0, 10);
    try {
        yield getRaceCard_Hr_1.default.getRaceCardAndStore_Hr(formatted);
        res.status(200).json({ message: "Racecards obtidos com sucesso." });
    }
    catch (error) {
        next(error);
    }
});
const getRaceCardsDetails = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const racecards = yield getRaceCard_Hr_1.default.getStoredRaceCard_Hr();
        for (const rc of racecards) {
            yield getRaceDetail_Hr_1.default.getRaceDetailAndStore_Hr(rc.id_race);
        }
        res.status(200).json({ message: "Racecards details obtidos com sucesso." });
    }
    catch (error) {
        next(error);
    }
});
const getHorseStats = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const racecards = yield getRaceCard_Hr_1.default.getStoredRaceCard_Hr();
        if (!racecards) {
            throw new Error("Não encontramos corridas não iniciadas.");
        }
        yield getHorseResults_Hr_1.default.getHorseStatsAndStore_hr(racecards);
        res.status(200).json({ message: "Horse stats obtidos com sucesso." });
    }
    catch (error) {
        next(error);
    }
});
exports.default = { getRaceCards, getRaceCardsDetails, getHorseStats };
