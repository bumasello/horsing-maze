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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const raceCardHrModel_1 = __importDefault(require("../../models/modelHr/raceCardHrModel"));
const raceDetailHrModel_1 = __importDefault(require("../../models/modelHr/raceDetailHrModel"));
const horseHrModel_1 = __importDefault(require("../../models/modelHr/horseHrModel"));
dotenv_1.default.config();
const getAllStoredRaceDetail_Hr = () => __awaiter(void 0, void 0, void 0, function* () {
    const racedetail = yield raceDetailHrModel_1.default.find().lean();
    return racedetail;
});
const getStoredRaceDetail_Hr = (id_race) => __awaiter(void 0, void 0, void 0, function* () {
    const racedetail = yield raceDetailHrModel_1.default.find({
        id_race: id_race,
    });
    return racedetail;
});
const getRaceDetailAndStore_Hr = (raceid) => __awaiter(void 0, void 0, void 0, function* () {
    const headers = new Headers();
    const url = `${process.env.HORSERACINGAPIURLRACEDETAILS}${raceid}` || "error";
    headers.set("x-rapidapi-key", process.env.XRAPIDAPIKEY6 || "error");
    headers.set("x-rapidapi-host", process.env.XRAPIDAPIHOST || "error");
    yield new Promise((resolve) => {
        setTimeout(resolve, 2000);
    });
    try {
        const response = yield fetch(url, { method: "GET", headers });
        if (!response.ok) {
            throw new Error(`Erro na requisição getRaceDetail: ${response.statusText}`);
        }
        const data = yield response.json();
        if (!data)
            throw new Error("Requisição retornou sem dados.");
        const horses = Array.isArray(data.horses) ? data.horses : [];
        const _a = data, { _id: detailId } = _a, dataSansId = __rest(_a, ["_id"]);
        const { horses: horsesArray, _id: cardId } = dataSansId, raceCardFields = __rest(dataSansId, ["horses", "_id"]);
        if (horses.length > 8 && horses.length <= 15) {
            // 1) Atualiza RaceCard (só campos que interessam + checked_detail)
            yield raceCardHrModel_1.default.findOneAndUpdate({ id_race: data.id_race }, {
                $set: Object.assign(Object.assign({}, raceCardFields), { checked_detail: true }),
            }, { new: true });
            // 2) Processamento dos cavalos antes de salvá-los
            const processedHorses = [];
            const incomingHorseIds = [];
            for (const hr of horses) {
                // Verifica se id_horse é um número válido, caso contrário marca como non-runner
                if (hr.non_runner === 1) {
                    hr.position = "0";
                    hr.distance_beaten = "0";
                }
                if (Number.isNaN(Number(hr.position))) {
                    hr.position = "0"; // Define como 0 se não for um número válido
                    hr.non_runner = 1; // Marca como non-runner
                    hr.distance_beaten = "0";
                }
                hr.distance_beaten = hr.distance_beaten || "0";
                hr.position = hr.position || "0";
                hr.sp = hr.sp || "0";
                incomingHorseIds.push(hr.id_horse);
                hr.id_race = data.id_race;
                // remove o _id do hr antes de atualizar
                const _b = hr, { _id: hid } = _b, horseSansId = __rest(_b, ["_id"]);
                // Salva o cavalo no banco de dados
                const savedHorse = yield horseHrModel_1.default.HorseModel_Hr.findOneAndUpdate({ id_horse: hr.id_horse, id_race: hr.id_race }, horseSansId, { upsert: true, new: true, setDefaultsOnInsert: true });
                // Adiciona o cavalo processado ao array
                processedHorses.push(savedHorse);
            }
            // 3) Agora fazemos o upsert do RaceCardDetail com os cavalos já processados
            const updatedData = Object.assign(Object.assign({}, raceCardFields), { horses: processedHorses, id_race: data.id_race });
            yield raceDetailHrModel_1.default.findOneAndUpdate({ id_race: data.id_race }, updatedData, { upsert: true, new: true, setDefaultsOnInsert: true });
            // 4) Limpa horses removidos do feed
            yield horseHrModel_1.default.HorseModel_Hr.deleteMany({
                id_race: raceid,
                id_horse: { $nin: incomingHorseIds },
            });
        }
        else {
            // se inválido, remove tudo
            yield raceDetailHrModel_1.default.deleteOne({ id_race: raceid });
            yield horseHrModel_1.default.HorseModel_Hr.deleteMany({ id_race: raceid });
            yield raceCardHrModel_1.default.deleteOne({ id_race: raceid });
        }
    }
    catch (error) {
        throw new Error(`Erro em getRaceDetailAndStore_Hr: ${error}`);
    }
});
exports.default = {
    getStoredRaceDetail_Hr,
    getRaceDetailAndStore_Hr,
    getAllStoredRaceDetail_Hr,
};
