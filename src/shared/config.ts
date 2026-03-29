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
 * Configurações centralizadas do pipeline
 */
export const CONFIG: PipelineConfig = {
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
    daysToAdd: 0, // 0 = data atual, 1 = amanhã, etc.
  },
};
