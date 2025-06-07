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
exports.updateHorseEntries_spb = void 0;
const __1 = require("../../..");
const updateHorseEntries_spb = () => __awaiter(void 0, void 0, void 0, function* () {
    const { data: unFinished, error } = yield __1.supabase
        .schema("hml")
        .from("horse_entries")
        .select("id,race_horse_id")
        .is("was_correct", null);
    if (!unFinished)
        return;
    for (const lay of unFinished) {
        const { data: positionData, error: positionError } = yield __1.supabase
            .from("race_horses_hr")
            .select("position")
            .eq("id", lay.race_horse_id);
        if (!positionData)
            return;
        const position = positionData[0].position;
        if (position === 1) {
            yield __1.supabase
                .schema("hml")
                .from("horse_entries")
                .update({
                was_correct: false,
                void: false,
                result_position: position,
                resolved_at: new Date().toISOString(),
            })
                .eq("id", lay.id);
        }
        else if (position === 0) {
            yield __1.supabase
                .schema("hml")
                .from("horse_entries")
                .update({
                was_correct: false,
                void: true,
                result_position: position,
                resolved_at: new Date().toISOString(),
            })
                .eq("id", lay.id);
        }
        else {
            yield __1.supabase
                .schema("hml")
                .from("horse_entries")
                .update({
                was_correct: true,
                void: false,
                result_position: position,
                resolved_at: new Date().toISOString(),
            })
                .eq("id", lay.id);
        }
    }
});
exports.updateHorseEntries_spb = updateHorseEntries_spb;
