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
const horseStatsHrModel_1 = __importDefault(require("../../../models/modelHr/horseStatsHrModel"));
const populateHorseStats_spb = (next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        console.log("Iniciando população de estatísticas de cavalos no Supabase...");
        // Buscar estatísticas de cavalos marcados como atualizados no MongoDB
        const horseStats = yield getHorseResults_Hr_1.default.getStoredHorseStats_Hr();
        console.log(`Processando ${horseStats.length} cavalos com estatísticas atualizadas.`);
        // Processar cada cavalo
        for (const stats of horseStats) {
            // Realizar upsert diretamente sem verificação prévia
            const { data: insertedStats, error: upsertError } = yield index_1.supabase
                .from("horse_stats_hr")
                .upsert({
                horse: stats.horse,
                id_horse: stats.id_horse,
                result_count: stats.result_count || 0,
            }, { onConflict: "id_horse" })
                .select("id");
            if (upsertError) {
                throw new Error(`Erro ao fazer upsert para ${stats.horse}: ${upsertError.message}`);
            }
            // Obter o ID do registro inserido/atualizado
            const stats_id = (_a = insertedStats === null || insertedStats === void 0 ? void 0 : insertedStats[0]) === null || _a === void 0 ? void 0 : _a.id;
            if (!stats_id) {
                console.warn(`Aviso: Não foi possível obter ID após upsert para ${stats.horse}`);
                continue;
            }
            // Processar os resultados do cavalo
            for (const results of stats.results) {
                // Verificar se o resultado já existe
                const { data: existingResult, error: resultCheckError } = yield index_1.supabase
                    .from("horse_results_hr")
                    .select("id")
                    .eq("stats_id", stats_id)
                    .eq("date", results.date)
                    .eq("race", results.race);
                if (resultCheckError) {
                    throw new Error(`Erro ao verificar resultado para ${stats.horse} na data ${results.date}: ${resultCheckError.message}`);
                }
                // Inserir apenas se o resultado não existir
                if (!existingResult || existingResult.length === 0) {
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
                        throw new Error(`Erro inserindo resultado para "${stats.horse}" na data ${results.date}: ${insertResultError.message}`);
                    }
                }
            }
            // Marcar como não atualizado no MongoDB após processamento
            yield horseStatsHrModel_1.default.updateOne({ id_horse: stats.id_horse }, { $set: { updated: false } });
        }
        console.log("População de estatísticas de cavalos concluída com sucesso.");
    }
    catch (error) {
        console.error("Erro durante a população de estatísticas:", error);
        next(error);
    }
});
exports.default = populateHorseStats_spb;
