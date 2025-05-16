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
exports.checkHorseResultLength = void 0;
const __1 = require("../../..");
const checkHorseResultLength = () => __awaiter(void 0, void 0, void 0, function* () {
    const { data: horsesWithStats, error } = yield __1.supabase
        .from("horse_stats_hr")
        .select("id_horse, horse_results_hr(count)");
    if (error) {
        throw new Error(`Erro ao executar query: ${error}`);
    }
    if (!horsesWithStats)
        return;
    // console.log(horsesWithStats);
    const qualifiedHorseIds = new Set();
    for (const stats of horsesWithStats) {
        let count = 0;
        if (stats.horse_results_hr &&
            Array.isArray(stats.horse_results_hr) &&
            stats.horse_results_hr.length > 0) {
            count = stats.horse_results_hr[0].count;
        }
        if (stats.id_horse !== null && stats.id_horse !== 0 && count >= 3) {
            qualifiedHorseIds.add(stats.id_horse);
        }
    }
    if (qualifiedHorseIds.size === 0) {
        console.log("Sem cavalos com mais de 3 corridas.");
        return;
    }
    const { data: unfinishedRaceCards, error: raceCardError } = yield __1.supabase
        .from("racecards_hr")
        .select("id")
        .eq("finished", "0");
    if (raceCardError) {
        throw new Error(`Erro ao executar query: ${error}`);
    }
    if (!unfinishedRaceCards)
        return;
    const racecardIdToUpdate = [];
    for (const racecard of unfinishedRaceCards) {
        const racecardId = racecard.id;
        const { data: horses, error: horsesError } = yield __1.supabase
            .from("race_horses_hr")
            .select("id_horse")
            .eq("racecard_id", racecardId);
        if (horsesError) {
            throw new Error(`Erro ao executar query: ${error}`);
        }
        if (!horses || horses.length === 0) {
            continue;
        }
        let allHorsesAreQualified = true;
        for (const hr of horses) {
            if (hr.id_horse === null || !qualifiedHorseIds.has(hr.id_horse)) {
                allHorsesAreQualified = false;
                break;
            }
        }
        if (allHorsesAreQualified) {
            racecardIdToUpdate.push(racecardId);
        }
    }
    if (racecardIdToUpdate.length > 0) {
        const { data: updateData, error: updateError } = yield __1.supabase
            .from("racecards_hr")
            .update({ create_entry: true })
            .in("id", racecardIdToUpdate);
        if (updateError) {
            throw new Error(`Erro ao executar query: ${error}`);
        }
    }
});
exports.checkHorseResultLength = checkHorseResultLength;
