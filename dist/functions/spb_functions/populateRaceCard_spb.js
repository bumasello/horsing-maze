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
const getRaceCard_Hr_1 = __importDefault(require("../mdb_functions/getRaceCard_Hr"));
const __1 = require("../..");
const populateRacecards_spb = (next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const racecards = yield getRaceCard_Hr_1.default.getStoredRaceCard_Hr();
        for (const rc of racecards) {
            const { id_race, course, date, off_time_br, title, distance, age, going, finished, canceled, finish_time, prize, class: raceclass, } = rc;
            // Verifica se o racecard com o mesmo id_race já existe no Supabase
            const { data: existingData, error: existingError } = yield __1.supabase
                .from("racecards_hr")
                .select("id")
                .eq("id_race", id_race);
            if (existingError) {
                throw new Error(`Erro verificando existência do racecard ${id_race}: ${JSON.stringify(existingError)}.`);
            }
            // Se já existir, pula para o próximo registro
            if (existingData && existingData.length > 0) {
                console.log(`Racecard ${id_race} já existe. Pulando inserção.`);
                continue;
            }
            // Se não existe, insere o novo racecard
            const { data, error } = yield __1.supabase
                .from("racecards_hr")
                .insert({
                id_race,
                course,
                date,
                off_time_br,
                title,
                distance,
                age,
                going,
                finished,
                canceled,
                finish_time,
                prize,
                class: raceclass,
            })
                .select("id");
            if (error) {
                throw new Error(`Erro inserindo racecard ${id_race}: ${JSON.stringify(error)}.`);
            }
            console.log(`Racecard ${id_race} inserido com sucesso.`);
        }
    }
    catch (error) {
        next(error);
    }
});
exports.default = populateRacecards_spb;
