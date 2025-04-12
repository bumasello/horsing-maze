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
const dotenv_1 = __importDefault(require("dotenv"));
const raceDetailHrModel_1 = __importDefault(require("../../models/modelHr/raceDetailHrModel"));
const horseHrModel_1 = __importDefault(require("../../models/modelHr/horseHrModel"));
dotenv_1.default.config();
const getStoredRaceDetail_Hr = (id_race) => __awaiter(void 0, void 0, void 0, function* () {
    const racedetail = yield raceDetailHrModel_1.default.find({
        id_race: id_race,
    });
    return racedetail;
});
const getRaceDetailAndStore_Hr = (raceid) => __awaiter(void 0, void 0, void 0, function* () {
    const headers = new Headers();
    const url = `${process.env.HORSERACINGAPIURLRACEDETAILS}${raceid}` || "error";
    headers.set("x-rapidapi-key", `${process.env.XRAPIDAPIKEY2}`);
    headers.set("x-rapidapi-host", `${process.env.XRAPIDAPIHOST}`);
    try {
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
        const checkRd = yield raceDetailHrModel_1.default.findOne({ id_race: data.id_race });
        if (!checkRd) {
            const raceDetail = new raceDetailHrModel_1.default(data);
            yield raceDetail.save();
            for (const hr of data.horses) {
                const checkHr = yield horseHrModel_1.default.HorseModel_Hr.findOne({
                    id_horse: hr.id_horse,
                    id_race: hr.id_race,
                });
                if (!checkHr) {
                    const horse = new horseHrModel_1.default.HorseModel_Hr(hr);
                    horse.id_race = raceDetail.id_race;
                    yield horse.save();
                }
            }
        }
    }
    catch (error) {
        throw new Error(`Erro na requisição getRaceDetailAndStore_Hr: ${error}`);
    }
});
exports.default = { getStoredRaceDetail_Hr, getRaceDetailAndStore_Hr };
