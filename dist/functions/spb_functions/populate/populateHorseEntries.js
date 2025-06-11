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
exports.generateHorseEntries = void 0;
const __1 = require("../../..");
const generateHorseEntries = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("Iniciando geração de entradas de cavalos com previsões...");
        // 1. Buscar previsões de cavalos
        console.log("Buscando previsões de cavalos...");
        const { data: predictions, error: predictionsError } = yield __1.supabase
            .schema("hml")
            .from("horse_predictions")
            .select("*")
            .order("racecard_id", { ascending: true })
            .order("probability", { ascending: false });
        if (predictionsError) {
            throw new Error(`Erro ao buscar previsões: ${predictionsError.message}`);
        }
        if (!predictions || predictions.length === 0) {
            console.log("Nenhuma previsão disponível.");
            return;
        }
        console.log(`Encontradas ${predictions.length} previsões para processamento.`);
        // 2. Extrair IDs únicos de corridas e cavalos
        const raceIds = [...new Set(predictions.map((p) => p.racecard_id))];
        const horseIds = [...new Set(predictions.map((p) => p.race_horse_id))];
        console.log(`Buscando informações para ${raceIds.length} corridas e ${horseIds.length} cavalos...`);
        // 3. Buscar informações das corridas
        const { data: races, error: racesError } = yield __1.supabase
            .schema("hml")
            .from("racecards_hr_view")
            .select("*")
            .in("id", raceIds)
            .eq("finished", "0")
            .eq("canceled", "0");
        if (racesError) {
            throw new Error(`Erro ao buscar corridas: ${racesError.message}`);
        }
        if (!races || races.length === 0) {
            console.log("Nenhuma corrida pendente encontrada.");
            return;
        }
        console.log(`Encontradas ${races.length} corridas pendentes.`);
        // 4. Buscar informações dos cavalos
        const { data: horses, error: horsesError } = yield __1.supabase
            .from("race_horses_hr")
            .select("*")
            .in("id", horseIds);
        if (horsesError) {
            throw new Error(`Erro ao buscar cavalos: ${horsesError.message}`);
        }
        if (!horses || horses.length === 0) {
            console.log("Nenhuma informação de cavalo encontrada.");
            return;
        }
        console.log(`Encontradas informações para ${horses.length} cavalos.`);
        // 5. Combinar os resultados
        const preds = [];
        for (const prediction of predictions) {
            const race = races.find((r) => r.id === prediction.racecard_id);
            const horse = horses.find((h) => h.id === prediction.race_horse_id);
            if (!race || !horse) {
                console.warn(`! Dados incompletos para racecard_id ${prediction.racecard_id}, race_horse_id ${prediction.race_horse_id}`);
                continue;
            }
            preds.push({
                racecard_id: prediction.racecard_id,
                race_horse_id: prediction.race_horse_id,
                probability: prediction.probability,
                course: race.course,
                date: race.date,
                off_time_br: race.off_time_br,
                title: race.title,
                horse: horse.horse,
                number: horse.number,
            });
        }
        console.log(`Combinados ${preds.length} registros com dados completos.`);
        // 6. Agrupar por corrida
        const byRace = new Map();
        for (const p of preds) {
            const arr = byRace.get(p.racecard_id) || [];
            arr.push(p);
            byRace.set(p.racecard_id, arr);
        }
        console.log(`Agrupados em ${byRace.size} corridas distintas.`);
        // 7. Para cada grupo, só insere se tiver exatamente 1 top-pick
        let successCount = 0;
        let skipCount = 0;
        let errorCount = 0;
        for (const [racecard_id, group] of byRace.entries()) {
            const topProb = group[0].probability;
            const topGroup = group.filter((p) => p.probability === topProb);
            if (topGroup.length !== 1) {
                console.log(`! Corrida ${racecard_id} ignorada por empate (${topGroup.length}).`);
                skipCount++;
                continue;
            }
            const pick = topGroup[0];
            const { error: upErr } = yield __1.supabase
                .schema("hml")
                .from("horse_entries")
                .upsert([
                {
                    racecard_id: pick.racecard_id,
                    race_horse_id: pick.race_horse_id,
                    course: pick.course,
                    date: pick.date,
                    off_time_br: pick.off_time_br,
                    title: pick.title,
                    horse: pick.horse,
                    number: pick.number,
                    probability: pick.probability,
                },
            ], { onConflict: "racecard_id" });
            if (upErr) {
                console.error(`Erro ao inserir lay-pick corrida ${racecard_id}:`, upErr);
                errorCount++;
            }
            else {
                console.log(`√ Lay-pick corrida ${racecard_id}: ${pick.horse} (#${pick.number}) — ${(pick.probability * 100).toFixed(1)}%`);
                successCount++;
            }
        }
        console.log("\nResumo da geração de entradas:");
        console.log(`- Total de corridas processadas: ${byRace.size}`);
        console.log(`- Entradas inseridas com sucesso: ${successCount}`);
        console.log(`- Corridas ignoradas por empate: ${skipCount}`);
        console.log(`- Erros de inserção: ${errorCount}`);
        console.log("Geração de entradas concluída.");
    }
    catch (error) {
        console.error("Erro na geração de entradas:", error);
        throw error;
    }
});
exports.generateHorseEntries = generateHorseEntries;
