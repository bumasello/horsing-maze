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
const __1 = require("../../.."); // ajuste conforme sua estrutura
const getRaceDetail_Hr_1 = __importDefault(require("../../mdb_functions/getRaceDetail_Hr"));
const populateRaceDetail_spb = () => __awaiter(void 0, void 0, void 0, function* () {
    // Seleciona as racecards do Supabase para obter os ids e o id_race original
    const { data: racecards, error: racecardsError } = yield __1.supabase
        .from("racecards_hr")
        .select("id, id_race");
    if (racecardsError) {
        console.error("Erro ao selecionar racecards_hr: ", racecardsError);
        return;
    }
    for (const race of racecards) {
        // Obtém os detalhes da corrida (do Mongo)
        const details = yield getRaceDetail_Hr_1.default.getStoredRaceDetail_Hr(race.id_race);
        if (!details || details.length === 0) {
            console.warn(`Detalhes não encontrados para a corrida ${race.id_race}`);
            continue;
        }
        for (const rc_detail of details) {
            const horses = rc_detail.horses;
            if (!horses || horses.length === 0) {
                console.warn(`Nenhum cavalo encontrado para a corrida ${race.id_race}`);
                continue;
            }
            // Processa cada cavalo do array
            for (const h of horses) {
                // Verifica se o cavalo já foi inserido para esse racecard, pelo par (racecard_id, id_horse)
                const { data: existingHorse, error: checkHorseError } = yield __1.supabase
                    .from("race_horses_hr")
                    .select("id")
                    .eq("racecard_id", race.id)
                    .eq("id_horse", h.id_horse);
                if (checkHorseError) {
                    console.error(`Erro verificando cavalo ${h.horse} para a corrida ${race.id_race}:`, checkHorseError);
                    continue;
                }
                let raceHorseId;
                if (existingHorse && existingHorse.length > 0) {
                    // Já existe, use o id existente
                    raceHorseId = existingHorse[0].id;
                    console.log(`Cavalo "${h.horse}" já existente para a corrida ${race.id_race} com race_horse_id: ${raceHorseId}`);
                }
                else {
                    // Insere o cavalo e captura o id gerado
                    const { data: insertedHorse, error: insertHorseError } = yield __1.supabase
                        .from("race_horses_hr")
                        .insert({
                        racecard_id: race.id,
                        horse: h.horse || null,
                        id_horse: h.id_horse || null,
                        jockey: h.jockey || null,
                        trainer: h.trainer || null,
                        age: h.age || null,
                        weight: h.weight || null,
                        number: h.number || null,
                        last_ran_days_ago: h.last_ran_days_ago || null,
                        non_runner: h.non_runner || null,
                        form: h.form || null,
                        position: h.position || null,
                        distance_beaten: h.distance_beaten || null,
                        owner: h.owner || null,
                        sire: h.sire || null,
                        dam: h.dam || null,
                        or_rating: h.OR || null,
                        sp: h.sp || null,
                    })
                        .select("id");
                    if (insertHorseError) {
                        console.error(`Erro inserindo cavalo ${h.horse} para a corrida ${race.id_race}:`, insertHorseError);
                        continue;
                    }
                    raceHorseId = insertedHorse[0].id;
                    console.log(`Inserido cavalo "${h.horse}" para a corrida ${race.id_race} com race_horse_id: ${raceHorseId}`);
                }
                // Agora, para as odds: verifique se há odds para esse cavalo
                if (h.odds && h.odds.length > 0) {
                    // Para cada odds, verificar se já existe (por exemplo, usando bookie e last_update como chave)
                    for (const o of h.odds) {
                        const { data: existingOdd, error: checkOddError } = yield __1.supabase
                            .from("odds_hr")
                            .select("id")
                            .eq("race_horse_id", raceHorseId)
                            .eq("bookie", o.bookie)
                            .eq("last_update", o.last_update);
                        if (checkOddError) {
                            console.error(`Erro verificando odds para o cavalo ${h.horse} (bookie: ${o.bookie}):`, checkOddError);
                            continue;
                        }
                        if (existingOdd && existingOdd.length > 0) {
                            console.log(`Odds para o cavalo "${h.horse}" (bookie: ${o.bookie}) já existem.`);
                            continue;
                        }
                        else {
                            const { error: insertOddError } = yield __1.supabase
                                .from("odds_hr")
                                .insert({
                                race_horse_id: raceHorseId,
                                bookie: o.bookie || null,
                                odd: o.odd || null,
                                last_update: o.last_update || null,
                                url: o.url || null,
                            });
                            if (insertOddError) {
                                console.error(`Erro inserindo odds para o cavalo ${h.horse} (bookie: ${o.bookie}):`, insertOddError);
                            }
                            else {
                                console.log(`Inserida odds para o cavalo "${h.horse}" (bookie: ${o.bookie}).`);
                            }
                        }
                    }
                }
                else {
                    console.log(`Sem odds para o cavalo "${h.horse}" na corrida ${race.id_race}.`);
                }
            } // Fim do loop para cada cavalo
        } // Fim do loop de detalhes
    } // Fim do loop para cada racecard
});
exports.default = populateRaceDetail_spb;
