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
const dotenv_1 = __importDefault(require("dotenv"));
const raceCardHrModel_1 = __importDefault(require("../../models/modelHr/raceCardHrModel"));
const raceDetailHrModel_1 = __importDefault(require("../../models/modelHr/raceDetailHrModel"));
const horseHrModel_1 = __importDefault(require("../../models/modelHr/horseHrModel"));
dotenv_1.default.config();
const getAllStoredRaceDetail_Hr = () => __awaiter(void 0, void 0, void 0, function* () {
    const racedetail = yield raceDetailHrModel_1.default.find().lean();
    return racedetail;
});
const getStoredRaceDetail_Hr = (id_race) => __awaiter(void 0, void 0, void 0, function* () {
    const racedetail = yield raceDetailHrModel_1.default.find({
        id_race: id_race,
    });
    return racedetail;
});
/**
 * Função para obter detalhes de corrida e armazenar no banco de dados,
 * com implementação de rotação de API keys para evitar limites de requisição
 */
const getRaceDetailAndStore_Hr = (raceid) => __awaiter(void 0, void 0, void 0, function* () {
    // Array de API keys disponíveis, filtradas para remover valores undefined/null
    const apiKeys = [
        process.env.XRAPIDAPIKEY0,
        process.env.XRAPIDAPIKEY1,
        process.env.XRAPIDAPIKEY2,
        process.env.XRAPIDAPIKEY3,
        process.env.XRAPIDAPIKEY4,
        process.env.XRAPIDAPIKEY5,
        process.env.XRAPIDAPIKEY6,
        process.env.XRAPIDAPIKEY7,
    ].filter((key) => Boolean(key));
    if (apiKeys.length === 0) {
        throw new Error("Nenhuma API key disponível no array.");
    }
    let currentKeyIndex = 0;
    // Função para obter headers com a API key atual
    const getHeaders = () => {
        const headers = new Headers();
        headers.set("x-rapidapi-key", apiKeys[currentKeyIndex]);
        headers.set("x-rapidapi-host", process.env.XRAPIDAPIHOST || "error");
        return headers;
    };
    // Função para rotacionar para a próxima API key
    const rotateApiKey = () => {
        currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
        console.log(`Mudando para API key ${currentKeyIndex + 1}/${apiKeys.length}`);
        return getHeaders();
    };
    // Configurações de retry
    const MAX_RETRIES = 3;
    let retryCount = 0;
    let waitTime = 5000; // Tempo inicial de espera para retry
    let success = false;
    let headers = getHeaders();
    // URL da API
    const url = `${process.env.HORSERACINGAPIURLRACEDETAILS}${raceid}` || "error";
    // Delay inicial antes da requisição
    yield new Promise((resolve) => setTimeout(resolve, 2000));
    while (!success && retryCount < MAX_RETRIES) {
        try {
            const response = yield fetch(url, { method: "GET", headers });
            if (!response.ok) {
                // Se receber erro 429 (Too Many Requests), rotaciona a API key
                if (response.status === 429) {
                    console.log("Erro 429: Too many requests detectado");
                    headers = rotateApiKey();
                    continue; // Tenta novamente com a nova key sem incrementar retry
                }
                throw new Error(`Erro na requisição getRaceDetail: ${response.statusText}`);
            }
            const data = yield response.json();
            if (!data)
                throw new Error("Requisição retornou sem dados.");
            const horses = Array.isArray(data.horses) ? data.horses : [];
            const _a = data, { _id: detailId } = _a, dataSansId = __rest(_a, ["_id"]);
            const { horses: horsesArray, _id: cardId } = dataSansId, raceCardFields = __rest(dataSansId, ["horses", "_id"]);
            if (horses.length > 8 && horses.length <= 15) {
                // 1) Atualiza RaceCard (só campos que interessam + checked_detail)
                yield raceCardHrModel_1.default.findOneAndUpdate({ id_race: data.id_race }, {
                    $set: Object.assign(Object.assign({}, raceCardFields), { checked_detail: true }),
                }, { new: true });
                // 2) Processamento dos cavalos antes de salvá-los
                const processedHorses = [];
                const incomingHorseIds = [];
                for (const hr of horses) {
                    // Verifica se id_horse é um número válido, caso contrário marca como non-runner
                    if (hr.non_runner === 1) {
                        hr.position = "0";
                        hr.distance_beaten = "0";
                    }
                    if (Number.isNaN(Number(hr.position))) {
                        hr.position = "0"; // Define como 0 se não for um número válido
                        hr.non_runner = 1; // Marca como non-runner
                        hr.distance_beaten = "0";
                    }
                    hr.distance_beaten = hr.distance_beaten || "0";
                    hr.position = hr.position || "0";
                    hr.sp = hr.sp || "0";
                    incomingHorseIds.push(hr.id_horse);
                    hr.id_race = data.id_race;
                    // remove o _id do hr antes de atualizar
                    const _b = hr, { _id: hid } = _b, horseSansId = __rest(_b, ["_id"]);
                    // Salva o cavalo no banco de dados
                    const savedHorse = yield horseHrModel_1.default.HorseModel_Hr.findOneAndUpdate({ id_horse: hr.id_horse, id_race: hr.id_race }, horseSansId, { upsert: true, new: true, setDefaultsOnInsert: true });
                    // Adiciona o cavalo processado ao array
                    processedHorses.push(savedHorse);
                }
                // 3) Agora fazemos o upsert do RaceCardDetail com os cavalos já processados
                const updatedData = Object.assign(Object.assign({}, raceCardFields), { horses: processedHorses, id_race: data.id_race });
                yield raceDetailHrModel_1.default.findOneAndUpdate({ id_race: data.id_race }, updatedData, { upsert: true, new: true, setDefaultsOnInsert: true });
                // 4) Limpa horses removidos do feed
                yield horseHrModel_1.default.HorseModel_Hr.deleteMany({
                    id_race: raceid,
                    id_horse: { $nin: incomingHorseIds },
                });
            }
            else {
                // se inválido, remove tudo
                yield raceDetailHrModel_1.default.deleteOne({ id_race: raceid });
                yield horseHrModel_1.default.HorseModel_Hr.deleteMany({ id_race: raceid });
                yield raceCardHrModel_1.default.deleteOne({ id_race: raceid });
            }
            // Marca como sucesso para sair do loop
            success = true;
        }
        catch (error) {
            retryCount++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Erro em getRaceDetailAndStore_Hr: ${errorMessage}`);
            if (errorMessage.includes("Too Many Requests")) {
                console.log("Erro de limite de requisições, trocando de API key...");
                headers = rotateApiKey();
                // Reduzir o tempo de espera quando estamos apenas trocando de chave
                waitTime = 1000;
            }
            else if (retryCount < MAX_RETRIES) {
                console.log(`Aguardando ${waitTime / 1000} segundos antes de tentar novamente...`);
                yield new Promise((resolve) => setTimeout(resolve, waitTime));
                waitTime *= 2; // Aumenta o tempo de espera exponencialmente
            }
            else {
                console.error(`Falha após ${MAX_RETRIES} tentativas para corrida ${raceid}`);
                throw new Error(`Erro em getRaceDetailAndStore_Hr após ${MAX_RETRIES} tentativas: ${errorMessage}`);
            }
        }
    }
});
exports.default = {
    getStoredRaceDetail_Hr,
    getRaceDetailAndStore_Hr,
    getAllStoredRaceDetail_Hr,
};
