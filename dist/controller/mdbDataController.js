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
const getRaceCard_Hr_1 = __importDefault(require("../functions/mdb_functions/getRaceCard_Hr"));
const getRaceDetail_Hr_1 = __importDefault(require("../functions/mdb_functions/getRaceDetail_Hr"));
const getHorseResults_Hr_1 = __importDefault(require("../functions/mdb_functions/getHorseResults_Hr"));
const updateRaceCard_Hr_1 = __importDefault(require("../functions/mdb_functions/updateRaceCard_Hr"));
const getRaceCards = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("mdbGetRaceCards");
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate());
    const formatted = tomorrowDate.toISOString().slice(0, 10);
    try {
        yield getRaceCard_Hr_1.default.getRaceCardAndStore_Hr(formatted);
        res.status(200).json({ message: "Racecards obtidos com sucesso." });
    }
    catch (error) {
        next(error);
    }
});
const getRaceCardsDetails = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("mdbGetRaceCardsDetails");
        const racecards = yield getRaceCard_Hr_1.default.getUnfinishedRaceCard_Hr(false);
        const BATCH_SIZE = 10; // Processar 10 requisições por lote
        const BATCH_DELAY = 60000; // 60 segundos de pausa entre lotes
        const REQUEST_DELAY = 2000; // 1 segundo entre requisições
        for (let i = 0; i < racecards.length; i++) {
            const rc = racecards[i];
            let success = false;
            let retryCount = 0;
            const MAX_RETRIES = 3;
            let waitTime = 5000; // Tempo inicial de espera para retry
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
                        waitTime *= 2;
                    }
                    else {
                        console.error(`Falha após ${MAX_RETRIES} tentativas para corrida ${rc.id_race}`);
                    }
                }
            }
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
        res.status(200).json({ message: "Racecards details obtidos com sucesso." });
    }
    catch (error) {
        next(error);
    }
});
// apenas para debug
/*
const dbgGetRaceDetail = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  await dbgGetRaceDetailAndStore_Hr();
  res.status(200).json({ message: "Racecards atualizados com sucesso." });
};
*/
// Pegar o histórico do cavalo gasta muitas requisições. Aguardar ter uma Api ilimitate para utilizar esse recurso.
const getHorseStats = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("mdbGetHorseStats");
        const racecards = yield getRaceCard_Hr_1.default.getUnfinishedRaceCard_Hr(true);
        if (!racecards) {
            throw new Error("Não encontramos corridas não iniciadas.");
        }
        yield getHorseResults_Hr_1.default.getHorseStatsAndStore_hr(racecards);
        res.status(200).json({ message: "Horse stats obtidos com sucesso." });
    }
    catch (error) {
        next(error);
    }
});
const updateRaceCard = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("mdbUpdateRaceCard");
    try {
        yield updateRaceCard_Hr_1.default.updateRaceCard_Hr();
        res.status(200).json({ message: "Racecards atualizados com sucesso." });
    }
    catch (error) {
        next(error);
    }
});
const checkRacecards = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("checkRacecards");
    try {
        yield updateRaceCard_Hr_1.default.checkMissingRacecards_hr();
        res.status(200).json({ message: "Racecards checados com sucesso." });
    }
    catch (error) {
        next(error);
    }
});
const checkRacedetails = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("checkRacedetails");
    try {
        yield updateRaceCard_Hr_1.default.syncMissingRaceDetails();
        res.status(200).json({ message: "Racedetails checados com sucesso." });
    }
    catch (error) {
        next(error);
    }
});
exports.default = {
    getRaceCards,
    getRaceCardsDetails,
    getHorseStats,
    updateRaceCard,
    checkRacecards,
    checkRacedetails,
};
