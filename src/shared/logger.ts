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
export const logger: Logger = {
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
export const metrics: Metrics = {
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
