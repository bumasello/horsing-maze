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
const racecardModel_1 = __importDefault(require("../model/racecardModel"));
const __1 = require("..");
dotenv_1.default.config();
const getRaceCard = (region) => __awaiter(void 0, void 0, void 0, function* () {
    const headers = new Headers();
    const url = `${process.env.RACINGAPIURLGB}${region}` || "error";
    const auth = Buffer.from(`${process.env.RACINGAPIUSERNAME}:${process.env.RACINGAPIPASSWORD}`).toString("base64");
    headers.set("Authorization", `Basic ${auth}`);
    try {
        const response = yield fetch(url, {
            method: "GET",
            headers: headers,
        });
        const data = yield response.json();
        data.racecards.forEach((racecard) => __awaiter(void 0, void 0, void 0, function* () {
            if (racecard.runners.length >= 7) {
                const raceCard = new racecardModel_1.default(racecard);
                raceCard.off_time_br = timeUkToBr(racecard.off_time);
                yield raceCard.save();
            }
            timeUkToBr(racecard.off_time);
        }));
        const dataSql = yield __1.supabase.from("races").select();
        console.log(dataSql);
        if (!response.ok) {
            throw new Error(`Erro na requisição getRaceCard: ${response.statusText}`);
        }
    }
    catch (err) {
        throw new Error(`Erro na requisição getRaceCard: ${err}`);
    }
});
const timeUkToBr = (off_time) => {
    const [horasStr, minStr] = off_time.split(":");
    let horasBr = Number.parseInt(horasStr);
    horasBr += 8;
    if (horasBr >= 24) {
        horasBr = horasBr - 24;
    }
    const off_time_br = `${horasBr.toString()}:${minStr}`;
    // console.log(off_time, horasStr, minStr, off_time_br);
    return off_time_br;
};
exports.default = getRaceCard;
