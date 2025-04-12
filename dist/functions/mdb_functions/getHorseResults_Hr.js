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
const horseStatsHrModel_1 = __importDefault(require("../../models/modelHr/horseStatsHrModel"));
const getRaceDetail_Hr_1 = __importDefault(require("./getRaceDetail_Hr"));
const getStoredHorseStats_Hr = () => __awaiter(void 0, void 0, void 0, function* () {
    const horseStats = yield horseStatsHrModel_1.default.find();
    return horseStats;
});
const getHorseStatsAndStore_hr = (racecard) => __awaiter(void 0, void 0, void 0, function* () {
    const headers = new Headers();
    headers.set("x-rapidapi-key", `${process.env.XRAPIDAPIKEY2}`);
    headers.set("x-rapidapi-host", `${process.env.XRAPIDAPIHOST}`);
    const rc = racecard;
    for (const racecard of rc) {
        const detail = yield getRaceDetail_Hr_1.default.getStoredRaceDetail_Hr(racecard.id_race);
        for (const rdetail of detail) {
            for (const horse of rdetail.horses) {
                try {
                    const url = `${process.env.HORSERACINGAPIURLHORSESTATS}${horse.id_horse}` ||
                        "error";
                    const response = yield fetch(url, {
                        method: "GET",
                        headers: headers,
                    });
                    if (!response.ok) {
                        throw new Error(`Erro na requisição getRaceDetailAndStore_Hr: ${response.statusText}`);
                    }
                    const data = yield response.json();
                    if (!data) {
                        throw new Error("Requisição retornou sem dados.");
                    }
                    // console.log(data);
                    // const checkHr = await
                    const horseStats = new horseStatsHrModel_1.default(data);
                    yield horseStats.save();
                }
                catch (error) {
                    console.error(error);
                }
            }
        }
    }
});
exports.default = {
    getHorseStatsAndStore_hr,
    getStoredHorseStats_Hr,
};
