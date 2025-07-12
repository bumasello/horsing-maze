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
const raceCardHrModel_1 = __importDefault(require("../../models/modelHr/raceCardHrModel"));
dotenv_1.default.config();
const getOneStoredRaceCard_Hr = (idrace) => __awaiter(void 0, void 0, void 0, function* () {
    const racecard = yield raceCardHrModel_1.default.findOne({ id_race: idrace });
    return racecard;
});
const getStoredRaceCard_Hr = () => __awaiter(void 0, void 0, void 0, function* () {
    const racecards = yield raceCardHrModel_1.default.find();
    return racecards;
});
// const getUnfinishedRaceCard_Hr = async (
//   bool: boolean,
// ): Promise<IRaceCard_Hr[]> => {
//   const racecards = await RaceCard.find<IRaceCard_Hr>({
//     finished: "0",
//     canceled: "0",
//     checked_detail: { $exists: false },
//   });
//
//   return racecards;
// };
const getUnfinishedRaceCard_Hr = (bool) => __awaiter(void 0, void 0, void 0, function* () {
    const racecards = yield raceCardHrModel_1.default.find({
        finished: "0",
        canceled: "0",
        checked_detail: bool,
    });
    return racecards;
});
const getRaceCardAndStore_Hr = (date) => __awaiter(void 0, void 0, void 0, function* () {
    yield new Promise((resolve) => {
        setTimeout(resolve, 2000);
    });
    const headers = new Headers();
    const url = `${process.env.HORSERACINGAPIURLRACECARDS}${date}` || "error";
    headers.set("x-rapidapi-key", `${process.env.XRAPIDAPIKEY4}`);
    headers.set("x-rapidapi-host", `${process.env.XRAPIDAPIHOST}`);
    try {
        const response = yield fetch(url, {
            method: "GET",
            headers: headers,
        });
        if (!response.ok) {
            throw new Error(`Erro na requisição getRaceCard: ${response.statusText}`);
        }
        const data = yield response.json();
        if (data.length === 0) {
            throw new Error("Requisição retornou sem dados.");
        }
        let inseridos = 0;
        for (const rc of data) {
            const checkRc = yield raceCardHrModel_1.default.findOne({ id_race: rc.id_race });
            if (!checkRc && inseridos < 25) {
                const raceCard = new raceCardHrModel_1.default(rc);
                const [, off_time = "00:00"] = (rc.date || "").split(" ");
                raceCard.off_time_br = timeUkToBr(off_time);
                raceCard.checked_detail = false;
                yield raceCard.save();
                inseridos++;
            }
        }
    }
    catch (err) {
        throw new Error(`Erro na requisição getRaceCard: ${err}`);
    }
});
const timeUkToBr = (off_time) => {
    const [horasStr, minStr] = off_time.split(":");
    let horasBr = Number.parseInt(horasStr);
    horasBr -= 4;
    if (horasBr >= 24) {
        horasBr = horasBr - 24;
    }
    const off_time_br = `${horasBr.toString()}:${minStr}`;
    // console.log(off_time, horasStr, minStr, off_time_br);
    return off_time_br;
};
exports.default = {
    getRaceCardAndStore_Hr,
    getStoredRaceCard_Hr,
    getOneStoredRaceCard_Hr,
    getUnfinishedRaceCard_Hr,
};
