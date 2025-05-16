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
exports.fetchHorseHistoricalResults = void 0;
const __1 = require("../../..");
const fetchHorseHistoricalResults = (id_horse, raceDate) => __awaiter(void 0, void 0, void 0, function* () {
    const { data: statsRow, error: statsError } = yield __1.supabase
        .from("horse_stats_hr")
        .select("id")
        .eq("id_horse", id_horse)
        .limit(1);
    if (statsError) {
        throw new Error(`Erro buscando stats para cavalo ${id_horse}: ${JSON.stringify(statsError)}`);
    }
    if (!statsRow || statsRow.length === 0) {
        return [];
    }
    const stats_id = statsRow[0].id;
    const { data, error } = yield __1.supabase
        .from("horse_results_hr")
        .select("*")
        .eq("stats_id", stats_id);
    if (error) {
        throw new Error(`Erro buscando históricos para cavalo ${id_horse}: ${JSON.stringify(error)}`);
    }
    return data !== null && data !== void 0 ? data : [];
});
exports.fetchHorseHistoricalResults = fetchHorseHistoricalResults;
