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
exports.updateCleanRacecard = void 0;
const __1 = require("../../..");
const updateCleanRacecard = (next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { data, error } = yield __1.supabase
            .from("racecards_hr")
            .select("id_race")
            .eq("finished", "0")
            .eq("canceled", "0")
            .eq("create_entry", false);
        console.log(data);
    }
    catch (error) {
        next(error);
    }
});
exports.updateCleanRacecard = updateCleanRacecard;
