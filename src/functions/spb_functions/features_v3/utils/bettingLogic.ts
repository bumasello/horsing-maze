import { supabase } from "../../../..";

/**
 * Converte odds fracionárias (ex: "5/1", "11/4") ou de texto ("Evens") para formato decimal.
 * @param oddString A odd em formato de string.
 * @returns A odd em formato decimal (ex: 6.0 para "5/1"), ou null se inválida.
 */
export const convertOddToDecimal = (
  oddString: string | null,
): number | null => {
  if (!oddString || oddString.trim() === "" || oddString.trim() === "0") {
    return null;
  }

  const trimmedOdd = oddString.trim().toLowerCase();

  // Tratar casos especiais de texto
  if (trimmedOdd === "evens" || trimmedOdd === "even") {
    return 2.0; // "Evens" significa 1/1, que é 2.0 em decimal
  }

  // Tentar converter como número decimal direto
  const decimalOdd = Number.parseFloat(trimmedOdd);
  if (!Number.isNaN(decimalOdd) && decimalOdd > 1) {
    return decimalOdd;
  }

  // Tentar converter odds fracionárias (ex: "5/1", "11/4")
  if (trimmedOdd.includes("/")) {
    const parts = trimmedOdd.split("/");
    if (parts.length === 2) {
      const numerator = Number.parseFloat(parts[0]);
      const denominator = Number.parseFloat(parts[1]);

      if (
        !Number.isNaN(numerator) &&
        !Number.isNaN(denominator) &&
        denominator > 0
      ) {
        const decimalResult = numerator / denominator + 1;
        return decimalResult > 1 ? decimalResult : null;
      }
    }
  }

  // Se chegou até aqui, a odd é inválida
  console.warn(`Odd inválida não pôde ser convertida: '${oddString}'`);
  return null;
};

/**
 * Busca e calcula a odd média decimal para um cavalo específico.
 * @param raceHorseId O ID do cavalo na corrida.
 * @returns A odd média em formato decimal, ou null se nenhuma odd válida for encontrada.
 */
export const getAverageOdd = async (
  raceHorseId: number,
): Promise<number | null> => {
  try {
    const { data, error } = await supabase
      .from("odds_hr")
      .select("odd")
      .eq("race_horse_id", raceHorseId);

    if (error) {
      console.error(`Erro ao buscar odds para cavalo ${raceHorseId}:`, error);
      return null;
    }

    if (!data || data.length === 0) {
      console.warn(`Nenhuma odd encontrada para o cavalo ${raceHorseId}.`);
      return null;
    }

    const decimalOdds = data
      .map((item) => convertOddToDecimal(item.odd || ""))
      .filter((o): o is number => o !== null);

    if (decimalOdds.length === 0) {
      console.warn(
        `Nenhuma odd VÁLIDA encontrada para o cavalo ${raceHorseId} após conversão.`,
      );
      return null;
    }

    const averageOdd =
      decimalOdds.reduce((sum, odd) => sum + odd, 0) / decimalOdds.length;
    return averageOdd;
  } catch (error) {
    console.error(
      `Erro inesperado ao calcular odd média para cavalo ${raceHorseId}:`,
      error,
    );
    return null;
  }
};

/**
 * Calcula o Índice de Valor Lay (IVL).
 * @param modelProbability A probabilidade de "não vencer" prevista pelo seu modelo (ex: 0.85).
 * @param averageMarketOdd A odd média decimal do mercado (ex: 7.0).
 * @returns O valor do IVL.
 */
export const calculateLayValueIndex = (
  modelProbability: number,
  averageMarketOdd: number,
): number => {
  if (averageMarketOdd <= 1 || modelProbability <= 0 || modelProbability > 1) {
    return 0; // Valores inválidos
  }

  // Probabilidade implícita do mercado de que o cavalo NÃO vai vencer.
  const marketProbToNotWin = 1 - 1 / averageMarketOdd;

  if (marketProbToNotWin <= 0) {
    return 0;
  }

  // Compara a previsão do modelo com a do mercado.
  const ivl = modelProbability / marketProbToNotWin;
  return ivl;
};
