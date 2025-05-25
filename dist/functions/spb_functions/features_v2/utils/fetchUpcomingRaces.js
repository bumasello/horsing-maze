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
exports.fetchUpcomingEntrie = exports.fetchUpcoming = void 0;
const __1 = require("../../../..");
const fetchUpcoming = () => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield __1.supabase
        .from("racecards_hr")
        .select("*")
        .eq("finished", 0)
        .order("date", { ascending: false });
    if (error) {
        throw new Error(`Erro buscando corridas pendentes: ${JSON.stringify(error)}`);
    }
    return data;
});
exports.fetchUpcoming = fetchUpcoming;
const fetchUpcomingEntrie = () => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield __1.supabase
        .from("racecards_hr")
        .select("*")
        .eq("finished", 0)
        .eq("create_entry", true)
        .order("date", { ascending: true });
    if (error) {
        throw new Error(`Erro buscando corridas pendentes: ${JSON.stringify(error)}`);
    }
    return data;
});
exports.fetchUpcomingEntrie = fetchUpcomingEntrie;
