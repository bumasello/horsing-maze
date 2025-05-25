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
const index_1 = require("../../../index");
const getHorseResults_Hr_1 = __importDefault(require("../../mdb_functions/getHorseResults_Hr"));
const populateHorseStats_spb = (next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const horseStats = yield getHorseResults_Hr_1.default.getStoredHorseStats_Hr();
        // selecionando todos os cavalos armazenados
        for (const stats of horseStats) {
            const { data: existing, error: checkError } = yield index_1.supabase
                .from("horse_stats_hr")
                .select("id")
                .eq("id_horse", stats.id_horse);
            if (checkError) {
                throw new Error(`Erro ao verificar existência de ${stats.horse}:`);
            }
            let stats_id;
            if (existing && existing.length > 0) {
                stats_id = existing[0].id;
            }
            else {
                const { data: insertedStats, error: insertError } = yield index_1.supabase
                    .from("horse_stats_hr")
                    .insert({
                    horse: stats.horse,
                    id_horse: stats.id_horse,
                })
                    .select("id");
                if (insertError) {
                    throw new Error(`Erro ao inserir stats para ${stats.horse}:`);
                }
                stats_id = insertedStats && ((_a = insertedStats[0]) === null || _a === void 0 ? void 0 : _a.id);
            }
            for (const results of stats.results) {
                const { data: existingResult, error: resultCheckError } = yield index_1.supabase
                    .from("horse_results_hr")
                    .select("id")
                    .eq("stats_id", stats_id)
                    .eq("date", results.date)
                    .eq("race", results.race);
                if (resultCheckError) {
                    throw new Error(`Erro ao verificar resultado para ${stats.horse} na data ${results.date}:`);
                }
                if (existingResult && existingResult.length > 0) {
                    // console.log(
                    //   `Resultado para "${stats.horse}" na data ${results.date} já existe.`,
                    // );
                }
                else {
                    if (!results.position) {
                        continue;
                    }
                    const { error: insertResultError } = yield index_1.supabase
                        .from("horse_results_hr")
                        .insert({
                        stats_id: stats_id,
                        date: results.date,
                        position: results.position,
                        course: results.course,
                        distance: results.distance,
                        class: results.class || 0,
                        weight: results.weight,
                        starting_price: results.starting_price,
                        jockey: results.jockey,
                        trainer: results.trainer,
                        or_rating: results.OR || 0,
                        race: results.race,
                        prize: results.prize,
                    });
                    if (insertResultError) {
                        throw new Error(`Erro inserindo resultado para "${stats.horse}" na data ${results.date}:`);
                    }
                }
            }
        }
    }
    catch (error) {
        next(error);
    }
});
exports.default = populateHorseStats_spb;
