import { supabase } from "../../../..";
import type { IRaceHorse_Spb } from "../../../../models/modelSpb/raceHorse_Spb";

/**
 * Busca todos os registros históricos de um cavalo na tabela race_horses_hr.
 * Retorna um Map para acesso rápido, usando a data da corrida como chave.
 */
export const fetchEnrichedHistory = async (
  horseId: number | null,
): Promise<Map<string, IRaceHorse_Spb>> => {
  const enrichedHistoryMap = new Map<string, IRaceHorse_Spb>();
  if (!horseId) {
    return enrichedHistoryMap;
  }

  // Busca todos os registros para um cavalo específico
  const { data, error } = await supabase
    .from("race_horses_hr")
    .select("*, racecards_hr(date)") // Faz um join simples para pegar a data da corrida
    .eq("id_horse", horseId);

  if (error) {
    console.error(
      `Erro ao buscar histórico enriquecido para cavalo ${horseId}:`,
      error,
    );
    return enrichedHistoryMap; // Retorna o mapa vazio em caso de erro
  }

  // Popula o mapa com os dados, usando a data como chave
  if (data) {
    console.log(
      "##############################################################################################",
    );
    for (const record of data) {
      if (record.racecards_hr?.date) {
        console.log(record);
        enrichedHistoryMap.set(record.racecards_hr.date, record);
      }
    }
  }

  return enrichedHistoryMap;
};
