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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findMissingRaceIds = findMissingRaceIds;
exports.syncMissingRaceDetails = syncMissingRaceDetails;
const dotenv_1 = __importDefault(require("dotenv"));
const getRaceCard_Hr_1 = __importDefault(require("../mdb_functions/getRaceCard_Hr"));
const getRaceDetail_Hr_1 = __importDefault(require("../mdb_functions/getRaceDetail_Hr"));
const raceCardHrModel_1 = __importDefault(require("../../models/modelHr/raceCardHrModel"));
const raceDetailHrModel_1 = __importDefault(require("../../models/modelHr/raceDetailHrModel"));
dotenv_1.default.config();
const updateRaceCard_Hr = () => __awaiter(void 0, void 0, void 0, function* () {
    const racecards = yield getRaceCard_Hr_1.default.getUnfinishedRaceCard_Hr(true);
    const BATCH_SIZE = 10; // Processar 10 requisições por lote
    const BATCH_DELAY = 60000; // 60 segundos de pausa entre lotes
    const REQUEST_DELAY = 1000; // 1 segundo entre requisições
    for (let i = 0; i < racecards.length; i++) {
        const rc = racecards[i];
        let success = false;
        let retryCount = 0;
        const MAX_RETRIES = 3;
        let waitTime = 5000; // Tempo inicial de espera para retry
        // Tentar a requisição com retry e backoff exponencial
        while (!success && retryCount < MAX_RETRIES) {
            try {
                yield getRaceDetail_Hr_1.default.getRaceDetailAndStore_Hr(rc.id_race);
                console.log(`Atualizou Racedetail: ${rc.id_race}`);
                success = true;
            }
            catch (error) {
                retryCount++;
                console.error(`Erro ao atualizar race detail ${rc.id_race}, tentativa ${retryCount}:`, error);
                if (retryCount < MAX_RETRIES) {
                    console.log(`Aguardando ${waitTime / 1000} segundos antes de tentar novamente...`);
                    yield new Promise((resolve) => setTimeout(resolve, waitTime));
                    waitTime *= 2; // Backoff exponencial
                }
                else {
                    console.error(`Falha após ${MAX_RETRIES} tentativas para corrida ${rc.id_race}`);
                }
            }
        }
        // Se conseguiu obter os detalhes, atualiza o racecard
        if (success) {
            try {
                const newRaceCard = yield getRaceDetail_Hr_1.default.getStoredRaceDetail_Hr(rc.id_race);
                if (newRaceCard && newRaceCard.length > 0) {
                    const raceDetailData = newRaceCard[0];
                    const _a = raceDetailData, { _id: detailId, horses } = _a, raceCardData = __rest(_a, ["_id", "horses"]);
                    yield raceCardHrModel_1.default.findOneAndUpdate({ id_race: rc.id_race }, { $set: { raceCardData } }, {
                        new: true,
                    });
                    console.log(`Atualizou Racecard: ${rc.id_race}`);
                }
            }
            catch (error) {
                console.error(`Erro ao atualizar race card ${rc.id_race}:`, error);
            }
        }
        // Verificar se precisa esperar entre lotes
        if (i < racecards.length - 1) {
            // Espera normal entre requisições
            yield new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY));
            // Se estamos no final de um lote, faz uma pausa maior
            if ((i + 1) % BATCH_SIZE === 0) {
                console.log(`Completado lote ${Math.floor((i + 1) / BATCH_SIZE)} de ${Math.ceil(racecards.length / BATCH_SIZE)}. Pausando por ${BATCH_DELAY / 1000} segundos...`);
                yield new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
            }
        }
    }
    console.log(`Processo de atualização concluído para ${racecards.length} corridas.`);
});
const checkMissingRacecards_hr = () => __awaiter(void 0, void 0, void 0, function* () {
    const racedetails = yield getRaceDetail_Hr_1.default.getAllStoredRaceDetail_Hr();
    for (const rd of racedetails) {
        const { _id, horses } = rd, rdData = __rest(rd, ["_id", "horses"]);
        yield raceCardHrModel_1.default.findOneAndUpdate({ id_race: rdData.id_race }, rdData, {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        });
    }
});
const checkMissingRacedetails_hr = () => __awaiter(void 0, void 0, void 0, function* () {
    // const racecards: IRaceCard_Hr[] = await raceCard.getStoredRaceCard_Hr();
    const raceIds = yield findMissingRaceIds();
    console.log(raceIds);
    // for (const rc of racecards) {
    //   const racedetail = await raceDetail.getStoredRaceDetail_Hr(rc.id_race);
    //   console.log(racedetail);
    //
    //   if (!racedetail) {
    //     console.log(rc);
    //     // await raceDetail.getRaceDetailAndStore_Hr(rc.id_race);
    //   }
    // }
});
function findMissingRaceIds() {
    return __awaiter(this, void 0, void 0, function* () {
        // Todos os id_race já inseridos em RaceCard
        const allRaceIds = yield raceCardHrModel_1.default.distinct("id_race");
        // Todos os id_race já inseridos em RaceCardDetail
        const existingRaceIds = yield raceDetailHrModel_1.default.distinct("id_race");
        // Filtra só os que faltam detalhes
        return allRaceIds.filter((id) => !existingRaceIds.includes(id));
    });
}
/**
 * Para cada raceId sem detalhe, tenta buscar da API e armazenar.
 * Se falhar, apenas loga o erro e continua no próximo.
 */
function syncMissingRaceDetails() {
    return __awaiter(this, void 0, void 0, function* () {
        const missing = yield findMissingRaceIds();
        if (missing.length === 0) {
            console.log("Nenhum racecard sem detalhe encontrado.");
            return;
        }
        console.log(missing);
        console.log(`Encontrados ${missing.length} racecards sem detalhe. Iniciando sync...`);
        // for (const raceId of missing) {
        //   try {
        //     await raceDetailService.getRaceDetailAndStore_Hr(raceId);
        //     console.log(`✓ Detalhe sincronizado para raceId=${raceId}`);
        //   } catch (err) {
        //     console.error(
        //       `✗ Falha ao sincronizar detalhe para raceId=${raceId}:`,
        //       err,
        //     );
        //   }
        // }
        console.log("Sincronização de detalhes pendentes concluída.");
    });
}
exports.default = {
    updateRaceCard_Hr,
    checkMissingRacecards_hr,
    checkMissingRacedetails_hr,
    syncMissingRaceDetails,
};
