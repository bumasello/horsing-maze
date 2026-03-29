import { CONFIG } from "./config";
import { logger } from "./logger";

/**
 * Interface para opções de retry
 */
interface RetryOptions {
  maxRetries?: number;
  initialWaitTime?: number;
  backoffFactor?: number;
}

/**
 * Função utilitária para retry com backoff exponencial
 * @param fn - Função a ser executada com retry
 * @param options - Opções de configuração
 * @param label - Rótulo para identificação nos logs
 */
export async function withRetry<T>(
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

export async function withSupabaseRetry<T>(
  fn: () => PromiseLike<{ data: T | null; error: any }>,
  label: string,
  maxRetries = 3,
): Promise<T | null> {
  let attempts = 0;

  while (attempts < maxRetries) {
    const { data, error } = await fn();

    if (!error) return data;

    const is502 =
      typeof error?.message === "string" && error.message.includes("502");
    const isTimeout = error?.code === "57014";

    if (is502 || isTimeout) {
      attempts++;
      const wait = 5000 * attempts;
      console.warn(
        `! ${label}: ${is502 ? "502 Bad Gateway" : "Timeout"} — tentativa ${attempts}/${maxRetries}, aguardando ${wait / 1000}s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }

    // Erro diferente — não retenta
    console.error(`Error in ${label}:`, error);
    return null;
  }

  console.error(`❌ ${label}: falhou após ${maxRetries} tentativas`);
  return null;
}
