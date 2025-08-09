import { supabase } from "../../../..";
import type { IRaceCard_Spb } from "../../../../models/modelSpb/raceCard_Spb";

// Definindo a interface para o retorno da função para maior clareza
export interface ITrainerFeatures {
  trainer_win_rate: number;
  trainer_course_win_rate: number;
  jockey_trainer_win_rate: number;
}

export const calculateTrainerFeatures = async (
  trainer: string | null,
  jockey: string | null, // Adicionado para a feature combinada
  race: IRaceCard_Spb | null,
): Promise<ITrainerFeatures> => {
  // Valores padrão
  const defaultValues: ITrainerFeatures = {
    trainer_win_rate: 0,
    trainer_course_win_rate: 0,
    jockey_trainer_win_rate: 0,
  };

  if (!trainer || !race) {
    return defaultValues;
  }

  try {
    // 1. Buscar todos os resultados históricos do treinador antes da data da corrida
    const { data: trainerResults, error: trainerError } = await supabase
      .from("horse_results_hr")
      .select("position, course, jockey") // Seleciona apenas as colunas necessárias
      .ilike("trainer", trainer)
      .lt("date", race.date);

    if (trainerError || !trainerResults || trainerResults.length === 0) {
      return defaultValues;
    }

    // Filtra posições válidas para evitar erros de cálculo
    const validResults = trainerResults.filter(
      (r) => r.position !== null && !Number.isNaN(r.position),
    );

    if (validResults.length === 0) {
      return defaultValues;
    }

    // 2. Calcular a taxa de vitórias geral do treinador (trainer_win_rate)
    const totalWins = validResults.filter((r) => r.position === 1).length;
    const trainer_win_rate = totalWins / validResults.length;

    // 3. Calcular a taxa de vitórias do treinador nesta pista (trainer_course_win_rate)
    const courseResults = validResults.filter((r) => r.course === race.course);
    let trainer_course_win_rate = 0;
    if (courseResults.length > 0) {
      const courseWins = courseResults.filter((r) => r.position === 1).length;
      trainer_course_win_rate = courseWins / courseResults.length;
    }

    // 4. Calcular a taxa de vitórias da combinação jóquei-treinador (jockey_trainer_win_rate)
    let jockey_trainer_win_rate = 0;
    if (jockey) {
      const comboResults = validResults.filter(
        (r) => r.jockey && r.jockey.toLowerCase() === jockey.toLowerCase(),
      );
      if (comboResults.length > 0) {
        const comboWins = comboResults.filter((r) => r.position === 1).length;
        jockey_trainer_win_rate = comboWins / comboResults.length;
      }
    }

    return {
      trainer_win_rate,
      trainer_course_win_rate,
      jockey_trainer_win_rate,
    };
  } catch (error) {
    console.error(`Erro ao calcular features do treinador ${trainer}:`, error);
    return defaultValues;
  }
};
