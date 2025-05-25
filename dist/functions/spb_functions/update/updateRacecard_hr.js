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
exports.updateRacecards_spb = void 0;
const __1 = require("../../..");
const getRaceCard_Hr_1 = __importDefault(require("../../mdb_functions/getRaceCard_Hr"));
const getRaceDetail_Hr_1 = __importDefault(require("../../mdb_functions/getRaceDetail_Hr"));
const updateRacecards_spb = (next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { data: unFinished, error } = yield __1.supabase
            .from("racecards_hr")
            .select("id,id_race")
            .eq("finished", "0");
        if (error) {
            throw new Error("Erro ao carregar corridas não finalizadas no Supabase.");
        }
        for (const idRace of unFinished) {
            const mdbRacecard = yield getRaceCard_Hr_1.default.getOneStoredRaceCard_Hr(idRace.id_race);
            const mdbRacedetail = yield getRaceDetail_Hr_1.default.getStoredRaceDetail_Hr(idRace.id_race);
            if (!mdbRacecard || !mdbRacedetail) {
                const { error } = yield __1.supabase
                    .from("racecards_hr")
                    .delete()
                    .eq("id_race", idRace.id_race);
                if (error)
                    console.error("Erro ao deletar corrida:", error);
                continue;
            }
            const updatedRacecard = {
                id: idRace.id,
                id_race: mdbRacecard === null || mdbRacecard === void 0 ? void 0 : mdbRacecard.id_race.toString(),
                age: mdbRacecard === null || mdbRacecard === void 0 ? void 0 : mdbRacecard.age,
                canceled: mdbRacecard === null || mdbRacecard === void 0 ? void 0 : mdbRacecard.canceled,
                class: mdbRacecard === null || mdbRacecard === void 0 ? void 0 : mdbRacecard.class,
                course: mdbRacecard === null || mdbRacecard === void 0 ? void 0 : mdbRacecard.course,
                date: mdbRacecard === null || mdbRacecard === void 0 ? void 0 : mdbRacecard.date,
                distance: mdbRacecard === null || mdbRacecard === void 0 ? void 0 : mdbRacecard.distance,
                finish_time: mdbRacecard === null || mdbRacecard === void 0 ? void 0 : mdbRacecard.finish_time,
                finished: mdbRacecard === null || mdbRacecard === void 0 ? void 0 : mdbRacecard.finished,
                going: mdbRacecard === null || mdbRacecard === void 0 ? void 0 : mdbRacecard.going,
                off_time_br: mdbRacecard === null || mdbRacecard === void 0 ? void 0 : mdbRacecard.off_time_br,
                prize: mdbRacecard === null || mdbRacecard === void 0 ? void 0 : mdbRacecard.prize,
                title: mdbRacecard === null || mdbRacecard === void 0 ? void 0 : mdbRacecard.title,
            };
            const { data: upsertData, error: upsertError } = yield __1.supabase
                .from("racecards_hr")
                .upsert(updatedRacecard, { onConflict: "id" });
            if (upsertError) {
                console.log(upsertError);
                throw new Error(`Erro ao realizar o upsert de corridas no supabase. ${upsertError}`);
            }
            for (const detail of mdbRacedetail) {
                for (const horse of detail.horses) {
                    const { data: idDetail, error } = yield __1.supabase
                        .from("race_horses_hr")
                        .select("id")
                        .eq("racecard_id", idRace.id)
                        .eq("id_horse", horse.id_horse);
                    if (error) {
                        throw new Error("Erro ao carregar cavalos das corridas não finalizadas no Supabase.");
                    }
                    // trata data como array de { id: number }
                    const idList = (idDetail !== null && idDetail !== void 0 ? idDetail : []);
                    if (idList.length === 0) {
                        console.warn(`Horse ${horse.id_horse} não encontrado em race_horses_hr, talvez não tenha sido inserido antes.`);
                        continue;
                    }
                    for (const { id } of idList) {
                        const updatedHorse = {
                            id,
                            id_horse: horse.id_horse,
                            horse: horse.horse,
                            age: horse.age,
                            racecard_id: idRace.id,
                            dam: horse.dam,
                            distance_beaten: horse.distance_beaten,
                            form: horse.form,
                            jockey: horse.jockey,
                            last_ran_days_ago: horse.last_ran_days_ago,
                            non_runner: horse.non_runner,
                            number: horse.number,
                            or_rating: horse.OR,
                            owner: horse.owner,
                            position: Number(horse.position),
                            sire: horse.sire,
                            sp: horse.sp,
                            trainer: horse.trainer,
                            weight: horse.weight,
                        };
                        const { data: upsertHorse, error: upsertError } = yield __1.supabase
                            .from("race_horses_hr")
                            .upsert(updatedHorse, { onConflict: "id" });
                        if (upsertError) {
                            console.log(upsertError);
                            throw new Error(`Erro ao realizar o upsert de cavalos no supabase. ${upsertError}`);
                        }
                    }
                }
            }
        }
    }
    catch (error) {
        next(error);
    }
});
exports.updateRacecards_spb = updateRacecards_spb;
