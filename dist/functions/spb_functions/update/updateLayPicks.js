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
exports.updateLayPicks_spb = void 0;
const __1 = require("../../..");
const updateLayPicks_spb = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { data: unFinished, error } = yield __1.supabase
            .from("lay_picks")
            .select("id,race_horse_id!inner(position)")
            .is("was_correct", null);
        if (!unFinished)
            return;
        // console.log(unFinished);
        // console.log(unFinished);
        for (const lay of unFinished) {
            // Vamos verificar a estrutura e acessar a posição corretamente
            let position;
            if (Array.isArray(lay.race_horse_id)) {
                // Se for um array, pegamos a posição do primeiro item (se existir)
                position =
                    lay.race_horse_id.length > 0 ? lay.race_horse_id[0].position : 0;
            }
            else {
                // Se for um objeto único
                position = lay.race_horse_id.position;
            }
            if (position === 1) {
                yield __1.supabase
                    .from("lay_picks")
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
                    .from("lay_picks")
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
                    .from("lay_picks")
                    .update({
                    was_correct: true,
                    void: false,
                    result_position: position,
                    resolved_at: new Date().toISOString(),
                })
                    .eq("id", lay.id);
            }
            // console.log(`LayPick ID: ${lay.id}, Position: ${position}`);
        }
    }
    catch (error) {
        console.error(error);
    }
});
exports.updateLayPicks_spb = updateLayPicks_spb;
