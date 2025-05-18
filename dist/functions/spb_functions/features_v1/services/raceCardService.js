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
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRaceHorses = exports.fetchSingleRacecards = exports.fetchRacecards = void 0;
const __1 = require("../../../..");
const fetchRacecards = () => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield __1.supabase.from("racecards_hr").select("*");
    if (error) {
        throw new Error(`Error buscando serviço do racecards: ${JSON.stringify(error)}`);
    }
    return data;
});
exports.fetchRacecards = fetchRacecards;
const fetchSingleRacecards = (rc) => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield __1.supabase
        .from("racecards_hr")
        .select("*")
        .eq("id_race", rc);
    if (error) {
        throw new Error(`Error buscando serviço do racecards: ${JSON.stringify(error)}`);
    }
    return data;
});
exports.fetchSingleRacecards = fetchSingleRacecards;
const fetchRaceHorses = (racecard_id) => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield __1.supabase
        .from("race_horses_hr")
        .select("*")
        .eq("racecard_id", racecard_id);
    if (error) {
        throw new Error(`Erro buscando serviço dos cavalos para racecard ${racecard_id}: ${JSON.stringify(error)}`);
    }
    return data;
});
exports.fetchRaceHorses = fetchRaceHorses;
