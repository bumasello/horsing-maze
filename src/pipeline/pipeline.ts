/**
 * Pipeline automatizado para atualização de dados de corridas
 *
 * Este script executa uma sequência de funções para atualizar dados de corridas,
 * transferir dados entre MongoDB e Supabase, treinar modelos de ML e gerar previsões.
 *
 * Foi projetado para ser executado como um microsserviço agendado via Node Cron.
 */

import { supabase } from "..";
import horseStats from "../functions/mdb_functions/getHorseResults_Hr";
import raceCards from "../functions/mdb_functions/getRaceCard_Hr";
import raceDetails from "../functions/mdb_functions/getRaceDetail_Hr";
import updateRacecard_mdb from "../functions/mdb_functions/updateRaceCard_Hr";
import { checkHorseResultLength } from "../functions/spb_functions/entries/checkHorseResultLength";
import {
  generatePredictionFeatures_v4,
  generateTrainingFeatures_v4,
} from "../functions/spb_functions/features_v4/pipeline/feature-orchestrator";
import {
  updateLayBettingResults,
  updateRacecardsAndDetails,
} from "../functions/spb_functions/features_v4/pipeline/update_results";
import { populateEnrichedRaceDetail_spb } from "../functions/spb_functions/populate/populateEnrichedRaceDetail";
import { populateHorseStats_spb } from "../functions/spb_functions/populate/populateHorseStats_spb";
import { populateRacecardsEnriched_spb } from "../functions/spb_functions/populate/populateRaceCard_spb_enriched";
import { populateRaceDetail_spb } from "../functions/spb_functions/populate/populateRaceDetail_spb";
import { updateCleanRacecard } from "../functions/spb_functions/update/updateCleanRacecard";
import { generateLayBettingPicks } from "../functions/tensor_functions/tensor_v4/ml/claude-generate-picks";
import { generatePredictions_v4 } from "../functions/tensor_functions/tensor_v4/ml/claude-prediction-model";
import { trainLayBettingModel } from "../functions/tensor_functions/tensor_v4/ml/sonnet-claude-training";

/**
 * Interface para o objeto de configuração do pipeline
 */
interface PipelineConfig {
  batchProcessing: {
    batchSize: number;
    batchDelay: number;
    requestDelay: number;
  };
  retry: {
    maxRetries: number;
    initialWaitTime: number;
    backoffFactor: number;
  };
  dates: {
    daysToAdd: number;
  };
}

/**
 * Interface para o resultado do pipeline
 */
interface PipelineResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Interface para o objeto de race card
 */

/**
 * Interface para opções de processamento em lotes
 */
interface BatchProcessingOptions {
  batchSize?: number;
  batchDelay?: number;
  requestDelay?: number;
}

/**
 * Interface para opções de retry
 */
interface RetryOptions {
  maxRetries?: number;
  initialWaitTime?: number;
  backoffFactor?: number;
}

/**
 * Configurações centralizadas do pipeline
 */
const CONFIG: PipelineConfig = {
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
 * Interface para o sistema de logging
 */
interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: Error): void;
}

/**
 * Sistema de logging aprimorado
 */
const logger: Logger = {
  info: (message: string): void => {
    const timestamp = new Date().toISOString();
    console.info(`[INFO] [${timestamp}] ${message}`);
    // Aqui poderia ser adicionada integração com sistemas de log externos
  },
  warn: (message: string): void => {
    const timestamp = new Date().toISOString();
    console.warn(`[WARN] [${timestamp}] ${message}`);
  },
  error: (message: string, error?: Error): void => {
    const timestamp = new Date().toISOString();
    console.error(`[ERROR] [${timestamp}] ${message}`);
    if (error?.stack) {
      console.error(`[ERROR] [${timestamp}] Stack: ${error.stack}`);
    }
  },
};

/**
 * Interface para o sistema de métricas
 */
interface Metrics {
  startTimes: Record<string, number>;
  start(label: string): void;
  end(label: string): number | undefined;
  measure<T>(label: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * Sistema de métricas para monitoramento de desempenho
 */
const metrics: Metrics = {
  startTimes: {},

  start: (label: string): void => {
    metrics.startTimes[label] = Date.now();
    logger.info(`Iniciando: ${label}`);
  },

  end: (label: string): number | undefined => {
    const startTime = metrics.startTimes[label];
    if (!startTime) {
      logger.warn(`Métrica não iniciada para: ${label}`);
      return undefined;
    }

    const duration = Date.now() - startTime;
    logger.info(
      `Concluído: ${label} - Duração: ${duration}ms (${(duration / 1000).toFixed(2)}s)`,
    );
    delete metrics.startTimes[label];
    return duration;
  },

  // Método auxiliar para envolver uma função com métricas
  async measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
    metrics.start(label);
    try {
      return await fn();
    } finally {
      metrics.end(label);
    }
  },
};

/**
 * Função utilitária para processamento em lotes
 * @param items - Itens a serem processados
 * @param processFn - Função de processamento para cada item
 * @param options - Opções de configuração
 */
async function processBatch<T>(
  items: T[],
  processFn: (item: T, index: number, array: T[]) => Promise<void>,
  options: BatchProcessingOptions = {},
): Promise<void> {
  const batchSize = options.batchSize || CONFIG.batchProcessing.batchSize;
  const batchDelay = options.batchDelay || CONFIG.batchProcessing.batchDelay;
  const requestDelay =
    options.requestDelay || CONFIG.batchProcessing.requestDelay;

  logger.info(
    `Iniciando processamento em lotes de ${items.length} itens (tamanho do lote: ${batchSize})`,
  );

  for (let i = 0; i < items.length; i++) {
    await processFn(items[i], i, items);

    if (i < items.length - 1) {
      // Espera normal entre requisições
      await new Promise<void>((resolve) => setTimeout(resolve, requestDelay));

      // Se estamos no final de um lote, faz uma pausa maior
      if ((i + 1) % batchSize === 0) {
        const currentBatch = Math.floor((i + 1) / batchSize);
        const totalBatches = Math.ceil(items.length / batchSize);
        logger.info(
          `Completado lote ${currentBatch} de ${totalBatches}. Pausando por ${batchDelay / 1000} segundos...`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, batchDelay));
      }
    }
  }

  logger.info(`Processamento em lotes concluído para ${items.length} itens`);
}

/**
 * Função utilitária para retry com backoff exponencial
 * @param fn - Função a ser executada com retry
 * @param options - Opções de configuração
 * @param label - Rótulo para identificação nos logs
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
  label = "operação",
): Promise<T> {
  const maxRetries = options.maxRetries || CONFIG.retry.maxRetries;
  let waitTime = options.initialWaitTime || CONFIG.retry.initialWaitTime;
  const backoffFactor = options.backoffFactor || CONFIG.retry.backoffFactor;

  let success = false;
  let retryCount = 0;
  let result: T;

  while (!success && retryCount < maxRetries) {
    try {
      result = await fn();

      success = true;
      return result;
    } catch (error) {
      retryCount++;
      logger.error(
        `Erro na ${label}, tentativa ${retryCount}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : new Error(String(error)),
      );

      if (retryCount < maxRetries) {
        logger.info(
          `Aguardando ${waitTime / 1000} segundos antes de tentar novamente...`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, waitTime));
        waitTime *= backoffFactor; // Backoff exponencial
      } else {
        logger.error(`Falha após ${maxRetries} tentativas para ${label}`);
        throw error; // Propaga o erro após esgotar as tentativas
      }
    }
  }

  // Esta linha nunca deve ser alcançada devido ao return dentro do try,
  // mas é necessária para satisfazer o TypeScript
  throw new Error("Falha inesperada no sistema de retry");
}

/**
 * Etapa 1: Atualização de dados no MongoDB
 */
async function updateMongoDBData(): Promise<void> {
  logger.info("Iniciando atualização de dados no MongoDB");

  await metrics.measure("Atualização de Race Card HR", async () => {
    await updateRacecard_mdb.updateRaceCard_Hr();
    logger.info("Atualização de Race Card HR concluída com sucesso");
  });

  await metrics.measure("Atualização de Racecards SPB", async () => {
    await updateRacecardsAndDetails();
    logger.info("Atualização de Racecards SPB concluída com sucesso");
  });

  await metrics.measure("Atualização de resultados dos picks", async () => {
    await updateLayBettingResults();
    logger.info("Resultados dos picks atualizados com sucesso");
  });

  logger.info("Atualização de dados no MongoDB concluída com sucesso");
}

/**
 * Etapa 2: Processamento de dados no MongoDB
 */
async function processMongoDBData(): Promise<void> {
  logger.info("Iniciando processamento de dados no MongoDB");

  // Obtenção de race cards
  await metrics.measure("Obtenção de race cards", async () => {
    const date = new Date();
    date.setDate(date.getDate() + CONFIG.dates.daysToAdd);
    const formatted = date.toISOString().slice(0, 10);

    logger.info(`Obtendo race cards para a data: ${formatted}`);
    const stats = await raceCards.getRaceCardAndStore_Hr(formatted);
    logger.info(
      `Race cards obtidos e armazenados com sucesso. Recebidos: ${stats.recebidos}, Inseridos: ${stats.inseridos}`,
    );
  });

  // Obtenção de detalhes de race cards
  await metrics.measure("Obtenção de detalhes de race cards", async () => {
    const racecards = await raceCards.getUnfinishedRaceCard_Hr(false);
    logger.info(
      `Encontrados ${racecards.length} race cards não finalizados para processamento`,
    );

    if (racecards.length === 0) {
      logger.warn(
        "Nenhum race card não finalizado encontrado para processamento",
      );
      return;
    }

    await processBatch(racecards, async (rc, index, array) => {
      await withRetry(
        async () => {
          logger.info(
            `Processando detalhes para race card ${rc.id_race} (${index + 1}/${array.length})`,
          );
          await raceDetails.getRaceDetailAndStore_Hr(rc.id_race);
          logger.info(
            `Detalhes para race card ${rc.id_race} atualizados com sucesso`,
          );
        },
        {},
        `race card ${rc.id_race}`,
      );
    });

    logger.info(
      "Todos os detalhes de race cards foram processados com sucesso",
    );
  });

  // Obtenção de estatísticas de cavalos
  await metrics.measure("Obtenção de estatísticas de cavalos", async () => {
    const racecardsForStats = await raceCards.getUnfinishedRaceCard_Hr(true);

    if (!racecardsForStats || racecardsForStats.length === 0) {
      logger.warn(
        "Não foram encontradas corridas não iniciadas para obtenção de estatísticas de cavalos",
      );
      return;
    }

    logger.info(
      `Encontrados ${racecardsForStats.length} race cards não iniciados para processamento de estatísticas de cavalos`,
    );
    await horseStats.getHorseStatsAndStore_hr(racecardsForStats);
    logger.info("Estatísticas de cavalos obtidas e armazenadas com sucesso");
  });

  logger.info("Processamento de dados no MongoDB concluído com sucesso");
}

/**
 * Etapa 3: Transferência e preparação de dados no Supabase
 */
async function transferToSupabase(): Promise<void> {
  logger.info("Iniciando transferência e preparação de dados no Supabase");

  // Transferência de race cards
  await metrics.measure(
    "Transferência de race cards para Supabase",
    async () => {
      await populateRacecardsEnriched_spb();
      logger.info("Race cards transferidos para Supabase com sucesso");
    },
  );

  await metrics.measure(
    "Transferência de detalhes de corridas para Supabase",
    async () => {
      await populateRaceDetail_spb();
      logger.info(
        "Detalhes de corridas transferidos para Supabase com sucesso",
      );
    },
  );

  // Adicionado: popula horse_stats_hr antes do enriched detail,
  // pois checkHorseResultLength depende do result_count
  await metrics.measure(
    "Transferência de estatísticas de cavalos para Supabase",
    async () => {
      await populateHorseStats_spb();
      logger.info(
        "Estatísticas de cavalos transferidas para Supabase com sucesso",
      );
    },
  );

  await metrics.measure(
    "Transferência de detalhes históricos de corridas para Supabase",
    async () => {
      await populateEnrichedRaceDetail_spb();
      logger.info("Detalhes históricos transferidos para Supabase com sucesso");
    },
  );

  await metrics.measure(
    "Verificação de cavalos com resultados suficientes",
    async () => {
      await checkHorseResultLength();
      logger.info("Verificação de resultados de cavalos concluída com sucesso");
    },
  );

  await metrics.measure("Remoção de race cards não elegíveis", async () => {
    await updateCleanRacecard();
    logger.info("Race cards não elegíveis removidos com sucesso");
  });

  // Geração de features
  await metrics.measure("Geração de features para treinamento", async () => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 2);

    const trainingResult = await generateTrainingFeatures_v4(
      supabase,
      startDate,
      endDate,
      {
        mode: "training",
        batchSize: 50,
        saveToDatabase: true,
        minQualityScore: 0.7,
      },
    );

    logger.info(
      `Features para treinamento geradas com sucesso: ${trainingResult.racesProcessed} corridas, ${trainingResult.featuresGenerated} features`,
    );
  });

  await metrics.measure("Geração de features para previsão", async () => {
    const { data: upcomingRaces, error } = await supabase
      .schema("hml")
      .from("racecards_hr_enriched")
      .select("id_race")
      .eq("finished", 0)
      .eq("canceled", 0);

    if (error) throw error;

    if (!upcomingRaces || upcomingRaces.length === 0) {
      logger.info("Nenhuma corrida futura encontrada para previsão, pulando.");
      return;
    }

    const raceIds = upcomingRaces.map((r) => r.id_race);

    const predictionFeatures = await generatePredictionFeatures_v4(
      supabase,
      raceIds,
      {
        mode: "prediction",
        saveToDatabase: true,
        minQualityScore: 0.5,
      },
    );

    logger.info(
      `Features para previsão geradas com sucesso: ${raceIds.length} corridas, ${predictionFeatures.length} features`,
    );
  });

  logger.info(
    "Transferência e preparação de dados no Supabase concluída com sucesso",
  );
}

/**
 * Etapa 4: Treinamento do modelo e geração de previsões
 */
async function trainAndPredict(): Promise<void> {
  logger.info("Iniciando treinamento do modelo e geração de previsões");

  // Treinamento do modelo
  await metrics.measure("Treinamento do modelo", async () => {
    await trainLayBettingModel();
    logger.info("Treinamento do modelo concluído com sucesso");
  });

  // Geração de previsões
  await metrics.measure("Geração de previsões", async () => {
    await generatePredictions_v4();
    logger.info("Previsões geradas com sucesso");
  });

  // Inserção de previsões no banco de dados
  await metrics.measure("Inserção de previsões no banco de dados", async () => {
    await generateLayBettingPicks();
    logger.info("Previsões inseridas no banco de dados com sucesso");
  });

  logger.info(
    "Treinamento do modelo e geração de previsões concluídos com sucesso",
  );
}

/**
 * Função principal do pipeline que executa todas as etapas em sequência
 */
export const runPipeline = async (): Promise<PipelineResult> => {
  try {
    logger.info("Iniciando pipeline de atualização de dados de corridas");

    await metrics.measure("Pipeline Completo", async () => {
      // Etapa 1: Atualização de dados no MongoDB
      await updateMongoDBData();

      // Etapa 2: Processamento de dados no MongoDB
      await processMongoDBData();

      // Etapa 3: Transferência e preparação de dados no Supabase
      await transferToSupabase();

      // Etapa 4: Treinamento do modelo e geração de previsões
      await trainAndPredict();
    });

    logger.info("Pipeline de atualização concluído com sucesso");
    return {
      success: true,
      message: "Pipeline de atualização concluído com sucesso",
    };
  } catch (error) {
    // Tratamento de erros centralizado
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `Erro no pipeline de atualização: ${errorMessage}`,
      error instanceof Error ? error : new Error(errorMessage),
    );

    // Aqui você pode adicionar notificações, alertas ou outras ações em caso de falha

    return {
      success: false,
      error: errorMessage,
    };
  }
};

/**
 * Configuração do Node Cron para execução automática
 * Executa todos os dias às 22:00
 */
export function setupCronJob(): boolean {
  try {
    // Importação dinâmica para evitar dependência em ambientes onde node-cron não está disponível
    const cron = require("node-cron");

    // Expressão cron: "0 22 * * *" significa "às 22:00 todos os dias"
    cron.schedule("30 1 * * *", async () => {
      logger.info("Iniciando execução agendada do pipeline de atualização");
      const result = await runPipeline();
      logger.info(
        `Resultado da execução agendada: ${result.success ? "Sucesso" : "Falha"}`,
      );

      if (!result.success) {
        logger.error(`Falha na execução agendada: ${result.error}`);
        // Aqui você pode adicionar notificações de falha
      }
    });

    logger.info(
      "Agendamento do pipeline configurado para execução diária às 01:30",
    );
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `Erro ao configurar agendamento: ${errorMessage}`,
      error instanceof Error ? error : new Error(errorMessage),
    );
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
