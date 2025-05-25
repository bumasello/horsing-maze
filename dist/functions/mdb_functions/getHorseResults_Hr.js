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
const horseStatsHrModel_1 = __importDefault(require("../../models/modelHr/horseStatsHrModel"));
const getRaceDetail_Hr_1 = __importDefault(require("./getRaceDetail_Hr"));
const getStoredHorseStats_Hr = () => __awaiter(void 0, void 0, void 0, function* () {
    const horseStats = yield horseStatsHrModel_1.default.find();
    return horseStats;
});
const getHorseStatsAndStore_hr = (racecard) => __awaiter(void 0, void 0, void 0, function* () {
    const apiKeys = [
        process.env.XRAPIDAPIKEY0,
        process.env.XRAPIDAPIKEY1,
        process.env.XRAPIDAPIKEY2,
        process.env.XRAPIDAPIKEY3,
        process.env.XRAPIDAPIKEY4,
    ].filter((key) => Boolean(key));
    if (apiKeys.length === 0) {
        throw new Error("Nenhuma api key no array.");
    }
    let currentKeyIndex = 0;
    const getHeaders = () => {
        const headers = new Headers();
        headers.set("x-rapidapi-key", apiKeys[currentKeyIndex]);
        headers.set("x-rapidapi-host", `${process.env.XRAPIDAPIHOST}`);
        return headers;
    };
    const rotateApiKey = () => {
        currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
        console.log("Mudando chave da api");
        return getHeaders();
    };
    const rc = racecard;
    const BATCH_SIZE = 10; // Processar 10 requisições por lote
    const BATCH_DELAY = 60000; // 60 segundos de pausa entre lotes
    const REQUEST_DELAY = 2000; // 1 segundo entre requisições
    for (const racecard of rc) {
        const detail = yield getRaceDetail_Hr_1.default.getStoredRaceDetail_Hr(racecard.id_race);
        console.log("temos o detail da corrida: ", racecard.id_race);
        for (const rdetail of detail) {
            for (let i = 0; i < rdetail.horses.length; i++) {
                const horse = rdetail.horses[i];
                let success = false;
                let retryCount = 0;
                const MAX_RETRIES = 3;
                let waitTime = 5000; // Tempo inicial de espera para retry
                let headers = getHeaders();
                while (!success && retryCount < MAX_RETRIES) {
                    try {
                        const url = `${process.env.HORSERACINGAPIURLHORSESTATS}${horse.id_horse}` ||
                            "error";
                        const response = yield fetch(url, {
                            method: "GET",
                            headers: headers,
                        });
                        if (!response.ok) {
                            if (response.status === 429) {
                                console.log("too many requests detectado");
                                headers = rotateApiKey();
                                continue;
                            }
                            throw new Error(`Erro na requisição getRaceDetailAndStore_Hr: ${response.statusText}`);
                        }
                        const data = yield response.json();
                        if (!data) {
                            throw new Error("Requisição retornou sem dados.");
                        }
                        const cleanedData = cleanHorseStatsData(data);
                        yield horseStatsHrModel_1.default.findOneAndUpdate({ id_horse: cleanedData.id_horse }, cleanedData, { upsert: true, new: true, setDefaultsOnInsert: true });
                        // const horseStats = new HorseStatsHrModel(cleanedData);
                        // await horseStats.save();
                        success = true;
                    }
                    catch (error) {
                        retryCount++;
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        console.error(error);
                        if (errorMessage.includes("Too Many Requests")) {
                            console.log("Erro de limite de requisições, trocando de API key...");
                            headers = rotateApiKey();
                            // Reduzir o tempo de espera quando estamos apenas trocando de chave
                            waitTime = 1000;
                        }
                        else if (retryCount < MAX_RETRIES) {
                            console.log(`Aguardando ${waitTime / 1000} segundos antes de tentar novamente...`);
                            yield new Promise((resolve) => setTimeout(resolve, waitTime));
                            waitTime *= 2;
                        }
                        else {
                            console.error(`Falha após ${MAX_RETRIES} tentativas para cavalo ${horse.id_horse}`);
                        }
                    }
                }
                if (i < rdetail.horses.length - 1) {
                    // Espera normal entre requisições
                    yield new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY));
                    // Se estamos no final de um lote, faz uma pausa maior
                    if ((i + 1) % BATCH_SIZE === 0) {
                        console.log(`Completado lote ${Math.floor((i + 1) / BATCH_SIZE)} de ${Math.ceil(rdetail.horses.length / BATCH_SIZE)}. Pausando por ${BATCH_DELAY / 1000} segundos...`);
                        yield new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
                    }
                }
            }
        }
    }
});
function cleanHorseStatsData(data) {
    // Cria uma cópia profunda para não modificar o original
    const cleanedData = JSON.parse(JSON.stringify(data));
    // Validar resultados se existirem
    if (Array.isArray(cleanedData.results)) {
        cleanedData.results = cleanedData.results.map((result) => {
            const cleanResult = Object.assign({}, result);
            // Limpar campos numéricos específicos
            // position
            if (typeof cleanResult.position === "string" &&
                isNaN(Number(cleanResult.position))) {
                cleanResult.position = null;
            }
            else if (typeof cleanResult.position === "string") {
                cleanResult.position = Number(cleanResult.position);
            }
            // class
            if (typeof cleanResult.class === "string" &&
                isNaN(Number(cleanResult.class))) {
                cleanResult.class = null;
            }
            else if (typeof cleanResult.class === "string") {
                cleanResult.class = Number(cleanResult.class);
            }
            // starting_price
            if (typeof cleanResult.starting_price === "string" &&
                isNaN(Number(cleanResult.starting_price))) {
                cleanResult.starting_price = null;
            }
            else if (typeof cleanResult.starting_price === "string") {
                cleanResult.starting_price = Number(cleanResult.starting_price);
            }
            // OR (Official Rating)
            if (typeof cleanResult.OR === "string" && isNaN(Number(cleanResult.OR))) {
                cleanResult.OR = null;
            }
            else if (typeof cleanResult.OR === "string") {
                cleanResult.OR = Number(cleanResult.OR);
            }
            return cleanResult;
        });
    }
    // Validar também os campos principais do cavalo
    if (typeof cleanedData.id_horse === "string" &&
        !isNaN(Number(cleanedData.id_horse))) {
        cleanedData.id_horse = Number(cleanedData.id_horse);
    }
    return cleanedData;
}
exports.default = {
    getHorseStatsAndStore_hr,
    getStoredHorseStats_Hr,
};
