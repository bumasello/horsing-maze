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
exports.fetchFinishedRaces = void 0;
const __1 = require("../../../..");
const fetchFinishedRaces = () => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield __1.supabase
        .from("racecards_hr")
        .select("*")
        .eq("finished", 1)
        .order("date", { ascending: false });
    if (error) {
        throw new Error(`Erro buscando corridas finalizadas: ${JSON.stringify(error)}`);
    }
    return data;
});
exports.fetchFinishedRaces = fetchFinishedRaces;
