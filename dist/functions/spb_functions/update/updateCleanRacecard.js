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
exports.updateCleanRacecard = void 0;
const __1 = require("../../..");
const raceCardHrModel_1 = __importDefault(require("../../../models/modelHr/raceCardHrModel"));
const raceDetailHrModel_1 = __importDefault(require("../../../models/modelHr/raceDetailHrModel"));
const updateCleanRacecard = (next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { data, error } = yield __1.supabase
            .from("racecards_hr")
            .select("id_race")
            .eq("finished", "0")
            .eq("canceled", "0")
            .eq("create_entry", false);
        if (error) {
            throw new Error(error.message);
        }
        if (!data)
            return;
        for (const rc of data) {
            yield raceCardHrModel_1.default.deleteOne({ id_race: rc.id_race });
            yield raceDetailHrModel_1.default.deleteOne({ id_race: rc.id_race });
            yield __1.supabase.from("racecards_hr").delete().eq("id_race", rc.id_race);
        }
    }
    catch (error) {
        next(error);
    }
});
exports.updateCleanRacecard = updateCleanRacecard;
