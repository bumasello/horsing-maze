import { supabase } from "../../../..";

/**
 * Busca a data da última corrida de um cavalo diretamente via SQL
 * @param horseId ID do cavalo
 * @param currentDate Data da corrida atual (para garantir que só consideramos corridas anteriores)
 * @returns Data da última corrida ou null se não houver histórico
 */
export const fetchLastRaceDate = async (
  horseId: number,
  currentDate: string,
): Promise<string | null> => {
  try {
    // console.log(
    //   `\n[DEBUG] Iniciando busca de última corrida para cavalo ${horseId}`,
    // );
    // console.log(`[DEBUG] Data atual da corrida: ${currentDate}`);

    if (!horseId) {
      // console.log(
      //   `[ERRO] ID do cavalo inválido para busca de última corrida: ${horseId}`,
      // );
      return null;
    }

    // Primeiro, precisamos encontrar o stats_id do cavalo
    // console.log(
    //   `[DEBUG] Buscando stats_id para cavalo ${horseId} na tabela horse_stats_hr`,
    // );
    const { data: horseStats, error: statsError } = await supabase
      .from("horse_stats_hr")
      .select("id")
      .eq("id_horse", horseId)
      .single();

    if (statsError) {
      // console.log(
      //   `[ERRO] Erro ao buscar stats_id para cavalo ${horseId}: ${statsError.message}`,
      // );
      // console.log(`[ERRO] Detalhes: ${JSON.stringify(statsError)}`);
      return null;
    }

    if (!horseStats) {
      // console.log(`[AVISO] Cavalo ${horseId} não encontrado em horse_stats_hr`);
      return null;
    }

    // console.log(
    //   `[DEBUG] Stats_id encontrado para cavalo ${horseId}: ${horseStats.id}`,
    // );

    // Agora buscamos a data da última corrida usando SQL nativo para garantir formatação correta
    // console.log(
    //   `[DEBUG] Chamando função SQL get_last_race_date para stats_id ${horseStats.id}`,
    // );
    const { data: lastRaceData, error: lastRaceError } = await supabase.rpc(
      "get_last_race_date",
      {
        stats_id_param: horseStats.id,
        current_date_param: currentDate,
      },
    );

    if (lastRaceError) {
      // console.log(
      //   `[ERRO] Erro ao buscar última corrida para cavalo ${horseId} (stats_id ${horseStats.id}): ${lastRaceError.message}`,
      // );
      // console.log(`[ERRO] Detalhes: ${JSON.stringify(lastRaceError)}`);
      return null;
    }

    // console.log(
    //   `[DEBUG] Resultado da função SQL: ${JSON.stringify(lastRaceData)}`,
    // );

    if (!lastRaceData || lastRaceData.length === 0) {
      // console.log(
      //   `[AVISO] Nenhum resultado retornado da função SQL para cavalo ${horseId} (stats_id ${horseStats.id})`,
      // );
      return null;
    }

    if (!lastRaceData[0].max_date) {
      // console.log(
      //   `[AVISO] Função SQL retornou objeto sem max_date para cavalo ${horseId} (stats_id ${horseStats.id})`,
      // );
      return null;
    }

    // console.log(
    //   `[DEBUG] Data da última corrida encontrada para cavalo ${horseId}: ${lastRaceData[0].max_date}`,
    // );
    return lastRaceData[0].max_date;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // console.log(
    //   `[ERRO] Exceção ao buscar data da última corrida para cavalo ${horseId}: ${errorMessage}`,
    // );
    // console.log(
    //   `[ERRO] Stack trace: ${error instanceof Error ? error.stack : "Não disponível"}`,
    // );
    return null;
  }
};

/**
 * Calcula o número de dias entre duas datas
 * @param startDate Data inicial (formato YYYY-MM-DD)
 * @param endDate Data final (formato YYYY-MM-DD)
 * @returns Número de dias entre as datas ou 0 se houver erro
 */
export const calculateDaysBetween = (
  startDate: string | null,
  endDate: string | null,
): number => {
  try {
    // console.log(`[DEBUG] Calculando dias entre ${startDate} e ${endDate}`);

    if (!startDate || !endDate) {
      // console.log(
      //   `[AVISO] Datas inválidas para cálculo: startDate=${startDate}, endDate=${endDate}`,
      // );
      return 0;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Verificar se as datas são válidas
    if (Number.isNaN(start.getTime())) {
      // console.log(`[ERRO] Data inicial inválida: ${startDate}`);
      return 0;
    }

    if (Number.isNaN(end.getTime())) {
      // console.log(`[ERRO] Data final inválida: ${endDate}`);
      return 0;
    }

    // Calcular a diferença em dias
    const diffTime = end.getTime() - start.getTime();
    const daysDiff = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // console.log(`[DEBUG] Diferença calculada: ${daysDiff} dias`);

    // Garantir que o valor seja não-negativo
    const result = Math.max(0, daysDiff);
    // console.log(
    //   `[DEBUG] Resultado final (após garantir não-negativo): ${result} dias`,
    // );
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // console.log(`[ERRO] Erro ao calcular dias entre datas: ${errorMessage}`);
    // console.log(
    //   `[ERRO] Stack trace: ${error instanceof Error ? error.stack : "Não disponível"}`,
    // );
    return 0;
  }
};

/**
 * Verifica diretamente na tabela horse_results_hr se há corridas anteriores
 * Método alternativo que não depende da função SQL
 */
export const checkDirectHorseResults = async (
  horseId: number,
  currentDate: string,
): Promise<string | null> => {
  try {
    // console.log(
    //   `[DEBUG] Verificando diretamente horse_results_hr para cavalo ${horseId}`,
    // );

    // Converter a data atual para o formato DD/MM/YYYY esperado pela tabela
    const dateParts = currentDate.split("-");
    if (dateParts.length !== 3) {
      // console.log(`[ERRO] Formato de data inválido: ${currentDate}`);
      return null;
    }

    const formattedCurrentDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
    // console.log(`[DEBUG] Data atual formatada: ${formattedCurrentDate}`);

    // Buscar diretamente na tabela horse_results_hr
    const { data: results, error } = await supabase
      .from("horse_results_hr")
      .select("date")
      .eq("id_horse", horseId)
      .lt("date", formattedCurrentDate) // Assumindo que date está no formato DD/MM/YYYY
      .order("date", { ascending: false })
      .limit(1);

    if (error) {
      // console.log(
      //   `[ERRO] Erro ao buscar diretamente em horse_results_hr: ${error.message}`,
      // );
      return null;
    }

    if (!results || results.length === 0) {
      // console.log(
      //   `[AVISO] Nenhum resultado direto encontrado para cavalo ${horseId}`,
      // );
      return null;
    }

    // console.log(
    //   `[DEBUG] Resultado direto encontrado: ${JSON.stringify(results[0])}`,
    // );

    // Converter a data do formato DD/MM/YYYY para YYYY-MM-DD
    const resultDateParts = results[0].date.split("/");
    if (resultDateParts.length !== 3) {
      // console.log(
      //   `[ERRO] Formato de data inválido no resultado: ${results[0].date}`,
      // );
      return null;
    }

    const formattedResultDate = `${resultDateParts[2]}-${resultDateParts[1]}-${resultDateParts[0]}`;
    // console.log(`[DEBUG] Data do resultado formatada: ${formattedResultDate}`);

    return formattedResultDate;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // console.log(
    //   `[ERRO] Exceção ao verificar diretamente horse_results_hr: ${errorMessage}`,
    // );
    return null;
  }
};
