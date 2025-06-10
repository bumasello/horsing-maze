"use strict";
/**
 * Pipeline automatizado para atualização de dados de corridas
 *
 * Este script executa uma sequência de funções para atualizar dados de corridas,
 * transferir dados entre MongoDB e Supabase, treinar modelos de ML e gerar previsões.
 *
 * Foi projetado para ser executado como um microsserviço agendado via Node Cron.
 */
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
exports.runPipeline = void 0;
exports.setupCronJob = setupCronJob;
const updateRaceCard_Hr_1 = __importDefault(require("../functions/mdb_functions/updateRaceCard_Hr"));
const getRaceCard_Hr_1 = __importDefault(require("../functions/mdb_functions/getRaceCard_Hr"));
const getRaceDetail_Hr_1 = __importDefault(require("../functions/mdb_functions/getRaceDetail_Hr"));
const getHorseResults_Hr_1 = __importDefault(require("../functions/mdb_functions/getHorseResults_Hr"));
const updateRacecard_hr_1 = require("../functions/spb_functions/update/updateRacecard_hr");
const updateLayPicks_1 = require("../functions/spb_functions/update/updateLayPicks");
const populateRaceCard_spb_1 = require("../functions/spb_functions/populate/populateRaceCard_spb");
const populateRaceDetail_spb_1 = require("../functions/spb_functions/populate/populateRaceDetail_spb");
const populateHorseStats_spb_1 = require("../functions/spb_functions/populate/populateHorseStats_spb");
const checkHorseResultLength_1 = require("../functions/spb_functions/entries/checkHorseResultLength");
const updateCleanRacecard_1 = require("../functions/spb_functions/update/updateCleanRacecard");
const generateTrainingFeatures_1 = require("../functions/spb_functions/features_v2/generateTrainingFeatures");
const generatePredictionFeatures_1 = require("../functions/spb_functions/features_v2/generatePredictionFeatures");
const trainHorseData_v2_1 = require("../functions/tensor_functions/trainHorseData_v2");
const generatePredictions_1 = require("../functions/spb_functions/features_v2/generatePredictions");
const populateHorseEntries_1 = require("../functions/spb_functions/populate/populateHorseEntries");
/**
 * Configurações centralizadas do pipeline
 */
const CONFIG = {
    batchProcessing: {
        batchSize: 10, // Número de requisições por lote
        batchDelay: 60000, // 60 segundos de pausa entre lotes
        requestDelay: 2000, // 2 segundos entre requisições individuais
    },
    retry: {
        maxRetries: 3, // Número máximo de tentativas
        initialWaitTime: 5000, // 5 segundos de espera inicial
        backoffFactor: 2, // Fator de multiplicação para backoff exponencial
    },
    dates: {
        daysToAdd: 1, // 0 = data atual, 1 = amanhã, etc.
    },
};
/**
 * Sistema de logging aprimorado
 */
const logger = {
    info: (message) => {
        const timestamp = new Date().toISOString();
        console.info(`[INFO] [${timestamp}] ${message}`);
        // Aqui poderia ser adicionada integração com sistemas de log externos
    },
    warn: (message) => {
        const timestamp = new Date().toISOString();
        console.warn(`[WARN] [${timestamp}] ${message}`);
    },
    error: (message, error) => {
        const timestamp = new Date().toISOString();
        console.error(`[ERROR] [${timestamp}] ${message}`);
        if (error === null || error === void 0 ? void 0 : error.stack) {
            console.error(`[ERROR] [${timestamp}] Stack: ${error.stack}`);
        }
    },
};
/**
 * Sistema de métricas para monitoramento de desempenho
 */
const metrics = {
    startTimes: {},
    start: (label) => {
        metrics.startTimes[label] = Date.now();
        logger.info(`Iniciando: ${label}`);
    },
    end: (label) => {
        const startTime = metrics.startTimes[label];
        if (!startTime) {
            logger.warn(`Métrica não iniciada para: ${label}`);
            return undefined;
        }
        const duration = Date.now() - startTime;
        logger.info(`Concluído: ${label} - Duração: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
        delete metrics.startTimes[label];
        return duration;
    },
    // Método auxiliar para envolver uma função com métricas
    measure(label, fn) {
        return __awaiter(this, void 0, void 0, function* () {
            metrics.start(label);
            try {
                return yield fn();
            }
            finally {
                metrics.end(label);
            }
        });
    },
};
/**
 * Função utilitária para processamento em lotes
 * @param items - Itens a serem processados
 * @param processFn - Função de processamento para cada item
 * @param options - Opções de configuração
 */
function processBatch(items_1, processFn_1) {
    return __awaiter(this, arguments, void 0, function* (items, processFn, options = {}) {
        const batchSize = options.batchSize || CONFIG.batchProcessing.batchSize;
        const batchDelay = options.batchDelay || CONFIG.batchProcessing.batchDelay;
        const requestDelay = options.requestDelay || CONFIG.batchProcessing.requestDelay;
        logger.info(`Iniciando processamento em lotes de ${items.length} itens (tamanho do lote: ${batchSize})`);
        for (let i = 0; i < items.length; i++) {
            yield processFn(items[i], i, items);
            if (i < items.length - 1) {
                // Espera normal entre requisições
                yield new Promise((resolve) => setTimeout(resolve, requestDelay));
                // Se estamos no final de um lote, faz uma pausa maior
                if ((i + 1) % batchSize === 0) {
                    const currentBatch = Math.floor((i + 1) / batchSize);
                    const totalBatches = Math.ceil(items.length / batchSize);
                    logger.info(`Completado lote ${currentBatch} de ${totalBatches}. Pausando por ${batchDelay / 1000} segundos...`);
                    yield new Promise((resolve) => setTimeout(resolve, batchDelay));
                }
            }
        }
        logger.info(`Processamento em lotes concluído para ${items.length} itens`);
    });
}
/**
 * Função utilitária para retry com backoff exponencial
 * @param fn - Função a ser executada com retry
 * @param options - Opções de configuração
 * @param label - Rótulo para identificação nos logs
 */
function withRetry(fn_1) {
    return __awaiter(this, arguments, void 0, function* (fn, options = {}, label = "operação") {
        const maxRetries = options.maxRetries || CONFIG.retry.maxRetries;
        let waitTime = options.initialWaitTime || CONFIG.retry.initialWaitTime;
        const backoffFactor = options.backoffFactor || CONFIG.retry.backoffFactor;
        let success = false;
        let retryCount = 0;
        let result;
        while (!success && retryCount < maxRetries) {
            try {
                result = yield fn();
                success = true;
                return result;
            }
            catch (error) {
                retryCount++;
                logger.error(`Erro na ${label}, tentativa ${retryCount}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error : new Error(String(error)));
                if (retryCount < maxRetries) {
                    logger.info(`Aguardando ${waitTime / 1000} segundos antes de tentar novamente...`);
                    yield new Promise((resolve) => setTimeout(resolve, waitTime));
                    waitTime *= backoffFactor; // Backoff exponencial
                }
                else {
                    logger.error(`Falha após ${maxRetries} tentativas para ${label}`);
                    throw error; // Propaga o erro após esgotar as tentativas
                }
            }
        }
        // Esta linha nunca deve ser alcançada devido ao return dentro do try,
        // mas é necessária para satisfazer o TypeScript
        throw new Error("Falha inesperada no sistema de retry");
    });
}
/**
 * Etapa 1: Atualização de dados no MongoDB
 */
function updateMongoDBData() {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info("Iniciando atualização de dados no MongoDB");
        yield metrics.measure("Atualização de Race Card HR", () => __awaiter(this, void 0, void 0, function* () {
            yield updateRaceCard_Hr_1.default.updateRaceCard_Hr();
            logger.info("Atualização de Race Card HR concluída com sucesso");
        }));
        yield metrics.measure("Atualização de Racecards SPB", () => __awaiter(this, void 0, void 0, function* () {
            yield (0, updateRacecard_hr_1.updateRacecards_spb)();
            logger.info("Atualização de Racecards SPB concluída com sucesso");
        }));
        yield metrics.measure("Atualização de Horse Entries SPB", () => __awaiter(this, void 0, void 0, function* () {
            yield (0, updateLayPicks_1.updateHorseEntries_spb)();
            logger.info("Atualização de Horse Entries SPB concluída com sucesso");
        }));
        logger.info("Atualização de dados no MongoDB concluída com sucesso");
    });
}
/**
 * Etapa 2: Processamento de dados no MongoDB
 */
function processMongoDBData() {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info("Iniciando processamento de dados no MongoDB");
        // Obtenção de race cards
        yield metrics.measure("Obtenção de race cards", () => __awaiter(this, void 0, void 0, function* () {
            const date = new Date();
            date.setDate(date.getDate() + CONFIG.dates.daysToAdd);
            const formatted = date.toISOString().slice(0, 10);
            logger.info(`Obtendo race cards para a data: ${formatted}`);
            yield getRaceCard_Hr_1.default.getRaceCardAndStore_Hr(formatted);
            logger.info("Race cards obtidos e armazenados com sucesso");
        }));
        // Obtenção de detalhes de race cards
        yield metrics.measure("Obtenção de detalhes de race cards", () => __awaiter(this, void 0, void 0, function* () {
            const racecards = yield getRaceCard_Hr_1.default.getUnfinishedRaceCard_Hr(false);
            logger.info(`Encontrados ${racecards.length} race cards não finalizados para processamento`);
            if (racecards.length === 0) {
                logger.warn("Nenhum race card não finalizado encontrado para processamento");
                return;
            }
            yield processBatch(racecards, (rc, index, array) => __awaiter(this, void 0, void 0, function* () {
                yield withRetry(() => __awaiter(this, void 0, void 0, function* () {
                    logger.info(`Processando detalhes para race card ${rc.id_race} (${index + 1}/${array.length})`);
                    yield getRaceDetail_Hr_1.default.getRaceDetailAndStore_Hr(rc.id_race);
                    logger.info(`Detalhes para race card ${rc.id_race} atualizados com sucesso`);
                }), {}, `race card ${rc.id_race}`);
            }));
            logger.info("Todos os detalhes de race cards foram processados com sucesso");
        }));
        // Obtenção de estatísticas de cavalos
        yield metrics.measure("Obtenção de estatísticas de cavalos", () => __awaiter(this, void 0, void 0, function* () {
            const racecardsForStats = yield getRaceCard_Hr_1.default.getUnfinishedRaceCard_Hr(true);
            if (!racecardsForStats || racecardsForStats.length === 0) {
                logger.warn("Não foram encontradas corridas não iniciadas para obtenção de estatísticas de cavalos");
                return;
            }
            logger.info(`Encontrados ${racecardsForStats.length} race cards não iniciados para processamento de estatísticas de cavalos`);
            yield getHorseResults_Hr_1.default.getHorseStatsAndStore_hr(racecardsForStats);
            logger.info("Estatísticas de cavalos obtidas e armazenadas com sucesso");
        }));
        logger.info("Processamento de dados no MongoDB concluído com sucesso");
    });
}
/**
 * Etapa 3: Transferência e preparação de dados no Supabase
 */
function transferToSupabase() {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info("Iniciando transferência e preparação de dados no Supabase");
        // Transferência de race cards
        yield metrics.measure("Transferência de race cards para Supabase", () => __awaiter(this, void 0, void 0, function* () {
            yield (0, populateRaceCard_spb_1.populateRacecards_spb)();
            logger.info("Race cards transferidos para Supabase com sucesso");
        }));
        // Transferência de detalhes de corridas
        yield metrics.measure("Transferência de detalhes de corridas para Supabase", () => __awaiter(this, void 0, void 0, function* () {
            yield (0, populateRaceDetail_spb_1.populateRaceDetail_spb)();
            logger.info("Detalhes de corridas transferidos para Supabase com sucesso");
        }));
        // Transferência de estatísticas de cavalos
        yield metrics.measure("Transferência de estatísticas de cavalos para Supabase", () => __awaiter(this, void 0, void 0, function* () {
            yield (0, populateHorseStats_spb_1.populateHorseStats_spb)();
            logger.info("Estatísticas de cavalos transferidas para Supabase com sucesso");
        }));
        // Verificação de cavalos com resultados suficientes
        yield metrics.measure("Verificação de cavalos com resultados suficientes", () => __awaiter(this, void 0, void 0, function* () {
            yield (0, checkHorseResultLength_1.checkHorseResultLength)();
            logger.info("Verificação de resultados de cavalos concluída com sucesso");
        }));
        // Atualização de race cards limpos
        yield metrics.measure("Atualização de race cards limpos", () => __awaiter(this, void 0, void 0, function* () {
            yield (0, updateCleanRacecard_1.updateCleanRacecard)();
            logger.info("Race cards limpos atualizados com sucesso");
        }));
        // Geração de features
        yield metrics.measure("Geração de features para treinamento", () => __awaiter(this, void 0, void 0, function* () {
            yield (0, generateTrainingFeatures_1.generateTrainingFeatures)();
            logger.info("Features para treinamento geradas com sucesso");
        }));
        yield metrics.measure("Geração de features para previsão", () => __awaiter(this, void 0, void 0, function* () {
            yield (0, generatePredictionFeatures_1.generatePredictionFeatures)();
            logger.info("Features para previsão geradas com sucesso");
        }));
        logger.info("Transferência e preparação de dados no Supabase concluída com sucesso");
    });
}
/**
 * Etapa 4: Treinamento do modelo e geração de previsões
 */
function trainAndPredict() {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info("Iniciando treinamento do modelo e geração de previsões");
        // Treinamento do modelo
        yield metrics.measure("Treinamento do modelo", () => __awaiter(this, void 0, void 0, function* () {
            yield (0, trainHorseData_v2_1.trainHorseData_v2)();
            logger.info("Treinamento do modelo concluído com sucesso");
        }));
        // Geração de previsões
        yield metrics.measure("Geração de previsões", () => __awaiter(this, void 0, void 0, function* () {
            yield (0, generatePredictions_1.generatePredictions)();
            logger.info("Previsões geradas com sucesso");
        }));
        // Inserção de previsões no banco de dados
        yield metrics.measure("Inserção de previsões no banco de dados", () => __awaiter(this, void 0, void 0, function* () {
            yield (0, populateHorseEntries_1.generateHorseEntries)();
            logger.info("Previsões inseridas no banco de dados com sucesso");
        }));
        logger.info("Treinamento do modelo e geração de previsões concluídos com sucesso");
    });
}
/**
 * Função principal do pipeline que executa todas as etapas em sequência
 */
const runPipeline = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        logger.info("Iniciando pipeline de atualização de dados de corridas");
        yield metrics.measure("Pipeline Completo", () => __awaiter(void 0, void 0, void 0, function* () {
            // Etapa 1: Atualização de dados no MongoDB
            yield updateMongoDBData();
            // Etapa 2: Processamento de dados no MongoDB
            yield processMongoDBData();
            // Etapa 3: Transferência e preparação de dados no Supabase
            yield transferToSupabase();
            // Etapa 4: Treinamento do modelo e geração de previsões
            yield trainAndPredict();
        }));
        logger.info("Pipeline de atualização concluído com sucesso");
        return {
            success: true,
            message: "Pipeline de atualização concluído com sucesso",
        };
    }
    catch (error) {
        // Tratamento de erros centralizado
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Erro no pipeline de atualização: ${errorMessage}`, error instanceof Error ? error : new Error(errorMessage));
        // Aqui você pode adicionar notificações, alertas ou outras ações em caso de falha
        return {
            success: false,
            error: errorMessage,
        };
    }
});
exports.runPipeline = runPipeline;
/**
 * Configuração do Node Cron para execução automática
 * Executa todos os dias às 22:00
 */
function setupCronJob() {
    try {
        // Importação dinâmica para evitar dependência em ambientes onde node-cron não está disponível
        const cron = require("node-cron");
        // Expressão cron: "0 22 * * *" significa "às 22:00 todos os dias"
        cron.schedule("0 22 * * *", () => __awaiter(this, void 0, void 0, function* () {
            logger.info("Iniciando execução agendada do pipeline de atualização");
            const result = yield (0, exports.runPipeline)();
            logger.info(`Resultado da execução agendada: ${result.success ? "Sucesso" : "Falha"}`);
            if (!result.success) {
                logger.error(`Falha na execução agendada: ${result.error}`);
                // Aqui você pode adicionar notificações de falha
            }
        }));
        logger.info("Agendamento do pipeline configurado para execução diária às 22:00");
        return true;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Erro ao configurar agendamento: ${errorMessage}`, error instanceof Error ? error : new Error(errorMessage));
        return false;
    }
}
/**
 * Para iniciar o serviço, você pode usar:
 *
 * import { setupCronJob } from './updatePipelineOtimizado';
 * setupCronJob();
 *
 * Ou para execução manual:
 *
 * import { runPipeline } from './updatePipelineOtimizado';
 * runPipeline().then(result => console.log(result));
 */
