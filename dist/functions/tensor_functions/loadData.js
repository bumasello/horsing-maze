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
exports.pendingRaces = pendingRaces;
exports.loadTrainingData = loadTrainingData;
const __1 = require("../..");
function pendingRaces() {
    return __awaiter(this, void 0, void 0, function* () {
        const { data: races, error: racesError } = yield __1.supabase
            .from("racecards_hr")
            .select("id, id_race")
            .eq("finished", 0)
            .eq("create_entry", true);
        if (racesError)
            throw new Error(racesError.message);
        const result = [];
        for (const r of races) {
            const { data: feats, error: featsError } = yield __1.supabase
                .from("horse_features")
                .select("*")
                .eq("race_id", r.id);
            if (featsError)
                throw new Error(featsError.message);
            result.push({
                raceId: r.id,
                id_race: r.id_race || "",
                features: feats || [],
            });
        }
        return result;
    });
}
function loadTrainingData() {
    return __awaiter(this, void 0, void 0, function* () {
        const { data: racesDone, error: racesError } = yield __1.supabase
            .from("racecards_hr")
            .select("id")
            .eq("finished", 0);
        if (racesError)
            throw new Error(racesError.message);
        const allFeatures = [];
        for (const { id } of racesDone) {
            const { data: feats, error: featsError } = yield __1.supabase
                .from("horse_features")
                .select("*")
                .eq("race_id", id);
            if (featsError)
                throw new Error(featsError.message);
            allFeatures.push(...(feats || []));
        }
        return allFeatures;
    });
}
